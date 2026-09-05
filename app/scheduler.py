import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import get_settings
from app.jobs import job_manager
from app.storage import load_searches

logger = logging.getLogger(__name__)


async def run_all_saved_searches() -> None:
    searches = [s for s in load_searches() if s.enabled]
    logger.info("daily run: launching %s saved searches", len(searches))
    for search in searches:
        job_manager.launch(search.criteria, search.name, search.id)


def build_scheduler() -> AsyncIOScheduler | None:
    settings = get_settings()
    if settings.daily_run_hour < 0:
        logger.info("daily scheduler disabled (HR_DAILY_RUN_HOUR=-1)")
        return None

    scheduler = AsyncIOScheduler(timezone=settings.timezone)
    scheduler.add_job(
        run_all_saved_searches,
        CronTrigger(hour=settings.daily_run_hour, minute=0),
        id="daily-searches",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    return scheduler
