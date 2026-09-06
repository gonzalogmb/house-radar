import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import get_settings
from app.jobs import job_manager
from app.locations import CATALOGUE
from app.models import RunRecord, SavedSearch, SearchCriteria
from app.scheduler import build_scheduler
from app.scrapers import PORTALS, scraper_for
from app.storage import (
    delete_search,
    load_listings_enriched,
    load_runs,
    load_searches,
    price_history,
    save_search,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = build_scheduler()
    if scheduler:
        scheduler.start()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title="House Radar", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


class SearchPayload(BaseModel):
    name: str
    criteria: SearchCriteria


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/meta")
async def meta() -> dict:
    settings = get_settings()
    return {
        "portals": list(PORTALS),
        "backends": {portal: scraper_for(portal).__name__ for portal in PORTALS},
        "locations": CATALOGUE,
        "daily_run_hour": settings.daily_run_hour,
        "max_pages_per_run": settings.max_pages_per_run,
        "delay_seconds": settings.delay_seconds,
        "active_runs": job_manager.active_count(),
    }


@app.get("/api/searches")
async def list_searches() -> list[SavedSearch]:
    return load_searches()


@app.post("/api/searches")
async def create_search(payload: SearchPayload) -> SavedSearch:
    search = SavedSearch(
        id=uuid.uuid4().hex[:12],
        name=payload.name,
        criteria=payload.criteria,
        created_at=datetime.now(timezone.utc),
    )
    return save_search(search)


@app.delete("/api/searches/{search_id}")
async def remove_search(search_id: str) -> dict:
    if not delete_search(search_id):
        raise HTTPException(404, "search not found")
    return {"deleted": search_id}


@app.post("/api/searches/{search_id}/run")
async def run_search(search_id: str) -> RunRecord:
    search = next((s for s in load_searches() if s.id == search_id), None)
    if search is None:
        raise HTTPException(404, "search not found")
    return job_manager.launch(search.criteria, search.name, search.id)


@app.post("/api/runs")
async def run_adhoc(payload: SearchPayload) -> RunRecord:
    return job_manager.launch(payload.criteria, payload.name)


@app.get("/api/runs")
async def list_runs(limit: int = 30) -> list[RunRecord]:
    return load_runs(limit)


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> RunRecord:
    live = job_manager.get(run_id)
    if live is not None:
        return live
    stored = next((r for r in load_runs(200) if r.id == run_id), None)
    if stored is None:
        raise HTTPException(404, "run not found")
    return stored


@app.get("/api/listings")
async def list_listings(
    portal: str | None = None,
    search_id: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_rooms: int | None = None,
    min_surface: float | None = None,
    only_new: bool = False,
    only_drops: bool = False,
    order_by: str = Query(
        "first_seen", pattern="^(price|price_per_m2|surface_m2|scraped_at|published_at|first_seen)$"
    ),
    ascending: bool = False,
    limit: int = 200,
) -> dict:
    frame = load_listings_enriched(portal=portal, search_id=search_id)
    if frame.empty:
        return {"total": 0, "matched": 0, "items": []}

    total = len(frame)
    if min_price is not None:
        frame = frame[frame["price"] >= min_price]
    if max_price is not None:
        frame = frame[frame["price"] <= max_price]
    if min_rooms is not None:
        frame = frame[frame["rooms"] >= min_rooms]
    if min_surface is not None:
        frame = frame[frame["surface_m2"] >= min_surface]
    if only_new:
        frame = frame[frame["is_new"]]
    if only_drops:
        frame = frame[frame["price_delta"] < 0]

    matched = len(frame)
    frame = frame.sort_values(order_by, ascending=ascending, na_position="last").head(limit)
    return {"total": total, "matched": matched, "items": _to_records(frame)}


@app.get("/api/listings/{portal}/{listing_id}/history")
async def listing_history(portal: str, listing_id: str) -> dict:
    frame = price_history(portal, listing_id)
    return {"points": _to_records(frame)}


@app.get("/api/stats")
async def stats() -> dict:
    frame = load_listings_enriched()
    if frame.empty:
        return {"total_listings": 0, "by_portal": {}, "new_listings": 0, "price_drops": 0}
    return {
        "total_listings": int(len(frame)),
        "by_portal": frame["portal"].value_counts().to_dict(),
        "new_listings": int(frame["is_new"].sum()),
        "price_drops": int((frame["price_delta"] < 0).sum()),
        "median_price": _safe_float(frame["price"].median()),
        "median_price_per_m2": _safe_float(frame["price_per_m2"].median()),
        "last_scrape": _safe_iso(frame["scraped_at"].max()),
    }


def _to_records(frame: pd.DataFrame) -> list[dict]:
    frame = frame.copy()
    for column in frame.select_dtypes(include=["datetimetz", "datetime64[ns]"]).columns:
        frame[column] = frame[column].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return json.loads(frame.to_json(orient="records"))


def _safe_float(value) -> float | None:
    return None if pd.isna(value) else round(float(value), 2)


def _safe_iso(value) -> str | None:
    return None if pd.isna(value) else value.strftime("%Y-%m-%dT%H:%M:%SZ")
