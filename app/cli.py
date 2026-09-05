"""Command line entry points.

    python -m app.cli check                 # canary: 1 page per portal + field coverage
    python -m app.cli run --all             # run every saved search once
    python -m app.cli run --search <id>
"""

import argparse
import asyncio
import logging
import sys
import uuid

from app.locations import CATALOGUE
from app.models import SearchCriteria
from app.scrapers import PORTALS, scraper_for
from app.storage import load_searches

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

COVERAGE_ALERT = 0.5


async def check() -> int:
    """Scrape one page per portal and report field coverage.

    A portal that returns rows but with empty fields is the failure mode that silently
    poisons the dataset, so this is what a daily cron should alert on.
    """
    madrid = CATALOGUE["Madrid capital"]
    criteria = SearchCriteria(
        location_name="Madrid capital",
        location_slugs=madrid["slugs"],
        center=madrid["center"],
        max_pages=1,
    )
    exit_code = 0
    for portal in PORTALS:
        scraper = scraper_for(portal)(run_id=f"check-{uuid.uuid4().hex[:8]}")
        listings, result = await scraper.scrape(criteria)
        print(f"\n=== {portal} ===")
        print(f"status={result.status.value} fetcher={result.fetcher} listings={result.listings}")
        if result.error:
            print(f"error: {result.error}")
            exit_code = 1
            continue
        for field_name, ratio in sorted(result.field_coverage.items()):
            flag = "  <-- check parser" if ratio < COVERAGE_ALERT else ""
            print(f"  {field_name:<14} {ratio:>6.0%}{flag}")
            if ratio < COVERAGE_ALERT:
                exit_code = 1
        if listings:
            sample = listings[0]
            print(f"  sample: {sample.price} € | {sample.rooms} hab | {sample.surface_m2} m² | {sample.url}")
    return exit_code


async def run(search_id: str | None, run_all: bool) -> int:
    from app.jobs import job_manager

    searches = load_searches()
    if search_id:
        searches = [s for s in searches if s.id == search_id]
    elif run_all:
        searches = [s for s in searches if s.enabled]
    else:
        print("pass --all or --search <id>")
        return 2

    if not searches:
        print("no saved searches to run")
        return 1

    runs = [job_manager.launch(s.criteria, s.name, s.id) for s in searches]
    await asyncio.gather(*(job_manager.wait(r.id) for r in runs))
    for record in runs:
        live = job_manager.get(record.id)
        print(
            f"{live.search_name}: {live.status.value} | {live.total_listings} listings "
            f"| {live.new_listings} new | {live.price_drops} price drops"
        )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="house-radar")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="canary run: 1 page per portal, prints field coverage")
    run_parser = sub.add_parser("run", help="run saved searches once")
    run_parser.add_argument("--search", dest="search_id")
    run_parser.add_argument("--all", action="store_true")

    args = parser.parse_args()
    if args.command == "check":
        sys.exit(asyncio.run(check()))
    sys.exit(asyncio.run(run(args.search_id, args.all)))


if __name__ == "__main__":
    main()
