import gzip
import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path
from threading import Lock

import pandas as pd

from app.config import get_settings
from app.models import Listing, RunRecord, SavedSearch

logger = logging.getLogger(__name__)

_file_lock = Lock()

LISTING_COLUMNS = [
    "portal",
    "listing_id",
    "url",
    "title",
    "price",
    "previous_price",
    "price_per_m2",
    "surface_m2",
    "rooms",
    "bathrooms",
    "floor",
    "has_lift",
    "is_exterior",
    "city",
    "district",
    "neighborhood",
    "postal_code",
    "latitude",
    "longitude",
    "advertiser_type",
    "advertiser_name",
    "description",
    "thumbnail",
    "n_images",
    "published_at",
    "is_new_construction",
    "search_id",
    "scraped_at",
]


def save_raw_page(portal: str, run_id: str, page: int, html: str) -> Path:
    """Keep the untouched payload: re-parsing beats re-scraping when a parser turns out wrong."""
    settings = get_settings()
    directory = settings.raw_dir / portal / date.today().isoformat()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{run_id}_p{page}.html.gz"
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write(html)
    return path


def save_debug_snapshot(portal: str, run_id: str, html: str) -> Path:
    settings = get_settings()
    path = settings.debug_dir / f"{portal}_{run_id}_{datetime.now():%Y%m%d%H%M%S}.html"
    path.write_text(html, encoding="utf-8")
    return path


def listings_to_frame(listings: list[Listing]) -> pd.DataFrame:
    rows = []
    for listing in listings:
        row = listing.model_dump()
        row["price_per_m2"] = listing.price_per_m2
        rows.append(row)
    frame = pd.DataFrame(rows, columns=LISTING_COLUMNS)
    for column in ("published_at", "scraped_at"):
        frame[column] = pd.to_datetime(frame[column], utc=True, errors="coerce")
    return frame


def save_listings(listings: list[Listing], run_id: str) -> list[Path]:
    settings = get_settings()
    if not listings:
        return []
    frame = listings_to_frame(listings)
    paths = []
    today = date.today().isoformat()
    for portal, chunk in frame.groupby("portal"):
        directory = settings.listings_dir / f"portal={portal}" / f"date={today}"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{run_id}.parquet"
        chunk.to_parquet(path, index=False)
        paths.append(path)
    return paths


def load_listings(
    portal: str | None = None,
    search_id: str | None = None,
    since: date | None = None,
    latest_only: bool = True,
) -> pd.DataFrame:
    settings = get_settings()
    pattern = f"portal={portal}/**/*.parquet" if portal else "**/*.parquet"
    files = sorted(settings.listings_dir.glob(pattern))
    if since:
        files = [f for f in files if _partition_date(f) is None or _partition_date(f) >= since]
    if not files:
        return pd.DataFrame(columns=LISTING_COLUMNS)

    frame = pd.concat((pd.read_parquet(f) for f in files), ignore_index=True)
    if search_id:
        frame = frame[frame["search_id"] == search_id]
    if latest_only and not frame.empty:
        frame = (
            frame.sort_values("scraped_at")
            .drop_duplicates(subset=["portal", "listing_id"], keep="last")
            .reset_index(drop=True)
        )
    return frame


def enrich_history(history: pd.DataFrame, search_id: str | None = None) -> pd.DataFrame:
    """Latest snapshot per listing plus what only the history can tell: when it first
    showed up and how the price moved since the previous run.

    Shared by the live app (`load_listings_enriched`, reading from data/listings/) and
    the static-export pipeline (which keeps its own accumulated history file) so both
    compute "new" and "price drop" the same way.
    """
    if history.empty:
        return history

    history = history.sort_values("scraped_at")
    keys = ["portal", "listing_id"]
    history["_rank"] = history.groupby(keys).cumcount(ascending=False)

    latest = history[history["_rank"] == 0].drop(columns="_rank")
    previous = history[history["_rank"] == 1][keys + ["price"]].rename(
        columns={"price": "previous_snapshot_price"}
    )
    aggregates = (
        history.groupby(keys)
        .agg(first_seen=("scraped_at", "min"), snapshots=("scraped_at", "count"))
        .reset_index()
    )

    frame = latest.merge(previous, on=keys, how="left").merge(aggregates, on=keys, how="left")
    frame["price_delta"] = frame["price"] - frame["previous_snapshot_price"]

    last_pass = frame["scraped_at"].max()
    frame["is_new"] = frame["first_seen"].dt.date == last_pass.date()

    if search_id:
        frame = frame[frame["search_id"] == search_id]
    return frame.reset_index(drop=True)


def load_listings_enriched(portal: str | None = None, search_id: str | None = None) -> pd.DataFrame:
    return enrich_history(load_listings(portal=portal, latest_only=False), search_id=search_id)


def price_history(portal: str, listing_id: str) -> pd.DataFrame:
    frame = load_listings(portal=portal, latest_only=False)
    if frame.empty:
        return frame
    subset = frame[frame["listing_id"] == listing_id]
    return subset.sort_values("scraped_at")[["scraped_at", "price"]]


def diff_against_history(listings: list[Listing]) -> tuple[set[str], list[dict]]:
    """New ids and price drops. Call before saving the batch, or it diffs against itself."""
    history = load_listings(latest_only=True)
    if history.empty:
        return {item.listing_id for item in listings}, []

    known = {(row.portal, row.listing_id): row.price for row in history.itertuples()}
    new_ids: set[str] = set()
    drops: list[dict] = []
    for item in listings:
        key = (item.portal, item.listing_id)
        if key not in known:
            new_ids.add(item.listing_id)
            continue
        old_price = known[key]
        if item.price and old_price and item.price < old_price:
            drops.append(
                {
                    "portal": item.portal,
                    "listing_id": item.listing_id,
                    "url": item.url,
                    "old_price": float(old_price),
                    "new_price": item.price,
                }
            )
    return new_ids, drops


def neighborhood_facets(frame: pd.DataFrame) -> list[dict]:
    """Neighbourhoods present in the data, with their district for grouping and a count."""
    known = frame[frame["neighborhood"].notna() & (frame["neighborhood"] != "")]
    if known.empty:
        return []
    grouped = (
        known.assign(group=known["district"].fillna(known["city"]).fillna("Otros"))
        .groupby(["group", "neighborhood"])
        .size()
        .reset_index(name="count")
        .sort_values(["group", "count"], ascending=[True, False])
    )
    return grouped.to_dict("records")


def frame_to_records(frame: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe list of dicts, with datetime columns as ISO strings."""
    frame = frame.copy()
    for column in frame.select_dtypes(include=["datetimetz", "datetime64[ns]"]).columns:
        frame[column] = frame[column].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return json.loads(frame.to_json(orient="records"))


def safe_float(value) -> float | None:
    return None if pd.isna(value) else round(float(value), 2)


def safe_iso(value) -> str | None:
    return None if pd.isna(value) else value.strftime("%Y-%m-%dT%H:%M:%SZ")


def _partition_date(path: Path) -> date | None:
    for part in path.parts:
        if part.startswith("date="):
            try:
                return date.fromisoformat(part.removeprefix("date="))
            except ValueError:
                return None
    return None


def _read_json(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logger.warning("corrupt json at %s, starting fresh", path)
        return []


def _write_json(path: Path, payload: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    tmp.replace(path)


def load_searches() -> list[SavedSearch]:
    return [SavedSearch.model_validate(row) for row in _read_json(get_settings().searches_file)]


def save_search(search: SavedSearch) -> SavedSearch:
    with _file_lock:
        searches = load_searches()
        searches = [s for s in searches if s.id != search.id]
        searches.append(search)
        _write_json(get_settings().searches_file, [s.model_dump(mode="json") for s in searches])
    return search


def delete_search(search_id: str) -> bool:
    with _file_lock:
        searches = load_searches()
        remaining = [s for s in searches if s.id != search_id]
        if len(remaining) == len(searches):
            return False
        _write_json(get_settings().searches_file, [s.model_dump(mode="json") for s in remaining])
    return True


def load_runs(limit: int = 50) -> list[RunRecord]:
    rows = _read_json(get_settings().runs_file)
    runs = [RunRecord.model_validate(row) for row in rows]
    return sorted(runs, key=lambda r: r.started_at, reverse=True)[:limit]


def save_run(run: RunRecord) -> None:
    with _file_lock:
        rows = _read_json(get_settings().runs_file)
        rows = [row for row in rows if row.get("id") != run.id]
        rows.append(run.model_dump(mode="json"))
        rows = sorted(rows, key=lambda r: r["started_at"], reverse=True)[:200]
        _write_json(get_settings().runs_file, rows)


def touch_search_run(search_id: str) -> None:
    with _file_lock:
        searches = load_searches()
        for search in searches:
            if search.id == search_id:
                search.last_run_at = datetime.now(timezone.utc)
        _write_json(get_settings().searches_file, [s.model_dump(mode="json") for s in searches])
