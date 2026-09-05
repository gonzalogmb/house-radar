import asyncio
import logging
import uuid
from datetime import datetime, timezone

from app.models import PortalResult, RunRecord, RunStatus, SearchCriteria
from app.scrapers import PORTALS, scraper_for
from app.storage import diff_against_history, save_listings, save_run, touch_search_run

logger = logging.getLogger(__name__)


class JobManager:
    """One scrape run per job. Portals run concurrently (different hosts), pages serially."""

    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def launch(
        self, criteria: SearchCriteria, search_name: str, search_id: str | None = None
    ) -> RunRecord:
        run = RunRecord(
            id=uuid.uuid4().hex[:12],
            search_id=search_id,
            search_name=search_name,
            criteria=criteria,
            status=RunStatus.pending,
            started_at=datetime.now(timezone.utc),
        )
        self._runs[run.id] = run
        save_run(run)
        self._tasks[run.id] = asyncio.create_task(self._execute(run))
        return run

    def get(self, run_id: str) -> RunRecord | None:
        return self._runs.get(run_id)

    async def wait(self, run_id: str) -> None:
        task = self._tasks.get(run_id)
        if task is not None:
            await task

    def active_count(self) -> int:
        return sum(1 for task in self._tasks.values() if not task.done())

    async def _execute(self, run: RunRecord) -> None:
        run.status = RunStatus.running
        save_run(run)
        portals = [p for p in run.criteria.portals if p in PORTALS]

        try:
            results = await asyncio.gather(
                *(self._scrape_portal(portal, run) for portal in portals),
                return_exceptions=True,
            )

            all_listings = []
            for portal, outcome in zip(portals, results):
                if isinstance(outcome, BaseException):
                    logger.exception("portal %s crashed", portal, exc_info=outcome)
                    run.portals.append(
                        PortalResult(portal=portal, status=RunStatus.failed, error=str(outcome))
                    )
                    continue
                listings, portal_result = outcome
                run.portals.append(portal_result)
                all_listings.extend(listings)

            new_ids, drops = diff_against_history(all_listings)
            save_listings(all_listings, run.id)

            run.total_listings = len(all_listings)
            run.new_listings = len(new_ids)
            run.price_drops = len(drops)
            run.status = (
                RunStatus.failed
                if run.portals and all(p.status == RunStatus.failed for p in run.portals)
                else RunStatus.done
            )
        except Exception as exc:  # noqa: BLE001 - a crashed run must still be recorded
            logger.exception("run %s failed", run.id)
            run.status = RunStatus.failed
            run.error = str(exc)
        finally:
            run.finished_at = datetime.now(timezone.utc)
            save_run(run)
            if run.search_id:
                touch_search_run(run.search_id)

    async def _scrape_portal(self, portal: str, run: RunRecord):
        scraper = scraper_for(portal)(run_id=run.id, search_id=run.search_id)
        if not scraper.supports(run.criteria):
            return [], PortalResult(
                portal=portal,
                status=RunStatus.failed,
                error=f"{portal}: this search lacks the location data that backend needs",
            )
        return await scraper.scrape(run.criteria)


job_manager = JobManager()
