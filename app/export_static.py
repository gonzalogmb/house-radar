"""Builds the free, static demo: scrape once, write docs/data.json for GitHub Pages.

Run daily by .github/workflows/daily-scrape.yml. Unlike the live app, there is no
server between a visitor and the data — this script IS the backend, run offline in
CI. It keeps its own accumulated snapshot history (site/history.parquet, committed to
the repo) since a GitHub Actions runner is thrown away after every run; the live app's
data/ directory, by contrast, lives on disk between requests and is gitignored.

    python -m app.export_static
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app.models import Listing, PortalResult, SearchCriteria
from app.scrapers import scraper_for
from app.storage import (
    LISTING_COLUMNS,
    enrich_history,
    frame_to_records,
    listings_to_frame,
    neighborhood_facets,
    safe_float,
    safe_iso,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

SITE_DIR = Path(__file__).resolve().parent.parent / "site"
DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"
SEARCHES_FILE = SITE_DIR / "searches.json"
HISTORY_FILE = SITE_DIR / "history.parquet"
DATA_OUT = DOCS_DIR / "data.json"

COVERAGE_ALERT = 0.5


async def scrape_all(searches: list[dict]) -> tuple[list[Listing], list[PortalResult]]:
    run_id = f"static-{uuid.uuid4().hex[:8]}"
    listings: list[Listing] = []
    results: list[PortalResult] = []

    for search in searches:
        criteria = SearchCriteria.model_validate(search["criteria"])
        for portal in criteria.portals:
            scraper_cls = scraper_for(portal)
            if scraper_cls is None:
                continue
            scraper = scraper_cls(run_id=run_id)
            if not scraper.supports(criteria):
                logger.warning("%s: skipping %s, search lacks the data it needs", search["name"], portal)
                continue
            portal_listings, result = await scraper.scrape(criteria)
            logger.info(
                "%s/%s: %s listings, status=%s%s",
                search["name"],
                portal,
                result.listings,
                result.status.value,
                f", error={result.error}" if result.error else "",
            )
            listings.extend(portal_listings)
            results.append(result)

    return listings, results


def load_history() -> pd.DataFrame:
    if HISTORY_FILE.exists():
        return pd.read_parquet(HISTORY_FILE)
    return pd.DataFrame(columns=LISTING_COLUMNS)


def save_history(history: pd.DataFrame) -> None:
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    history.to_parquet(HISTORY_FILE, index=False)


def build_payload(enriched: pd.DataFrame, results: list[PortalResult]) -> dict:
    if enriched.empty:
        return {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total_listings": 0,
            "new_listings": 0,
            "price_drops": 0,
            "sareb_listings": 0,
            "by_portal": {},
            "median_price": None,
            "median_price_per_m2": None,
            "listings": [],
            "facets": {"neighborhoods": []},
            "portal_runs": [r.model_dump(mode="json") for r in results],
        }

    ordered = enriched.sort_values("first_seen", ascending=False)
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_listings": int(len(enriched)),
        "new_listings": int(enriched["is_new"].sum()),
        "price_drops": int((enriched["price_delta"] < 0).sum()),
        "sareb_listings": int(enriched["is_sareb"].sum()),
        "by_portal": enriched["portal"].value_counts().to_dict(),
        "median_price": safe_float(enriched["price"].median()),
        "median_price_per_m2": safe_float(enriched["price_per_m2"].median()),
        "last_scrape": safe_iso(enriched["scraped_at"].max()),
        "listings": frame_to_records(ordered),
        "facets": {"neighborhoods": neighborhood_facets(enriched)},
        "portal_runs": [r.model_dump(mode="json") for r in results],
    }


async def main() -> int:
    if not SEARCHES_FILE.exists():
        logger.error("missing %s", SEARCHES_FILE)
        return 1
    searches = json.loads(SEARCHES_FILE.read_text(encoding="utf-8"))

    only_search = os.environ.get("HR_ONLY_SEARCH", "").strip()
    if only_search:
        searches = [s for s in searches if s["name"] == only_search]
        if not searches:
            logger.error("HR_ONLY_SEARCH=%r matched no saved search", only_search)
            return 1

    listings, results = await scrape_all(searches)

    history = load_history()
    if listings:
        new_snapshot = listings_to_frame(listings)
        history = new_snapshot if history.empty else pd.concat([history, new_snapshot], ignore_index=True)
        history = history.drop_duplicates(subset=["portal", "listing_id", "scraped_at"], keep="last")
    save_history(history)

    enriched = enrich_history(history)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_OUT.write_text(json.dumps(build_payload(enriched, results), ensure_ascii=False), encoding="utf-8")
    logger.info("wrote %s (%d listings)", DATA_OUT, len(enriched))

    exit_code = 0
    for result in results:
        if result.error:
            exit_code = 1
        for field_name, ratio in result.field_coverage.items():
            if ratio < COVERAGE_ALERT:
                logger.warning("%s: %s coverage only %.0f%%", result.portal, field_name, ratio * 100)
                exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
