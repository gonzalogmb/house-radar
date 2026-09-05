import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.config import get_settings
from app.models import Listing, PortalResult, RunStatus, SearchCriteria
from app.scrapers.fetchers import (
    BlockedError,
    BrowserFetcher,
    HttpFetcher,
    RateLimiter,
    ScrapeError,
    StructureChangedError,
)
from app.storage import save_debug_snapshot, save_raw_page

logger = logging.getLogger(__name__)

COVERAGE_FIELDS = ("title", "price", "surface_m2", "rooms", "url", "city", "published_at")


@dataclass
class PageResult:
    listings: list[Listing] = field(default_factory=list)
    total_reported: int | None = None


class Scraper(ABC):
    """What a source must offer: say whether it can run this search, and run it."""

    portal: str

    def __init__(self, run_id: str, search_id: str | None = None) -> None:
        self.settings = get_settings()
        self.run_id = run_id
        self.search_id = search_id
        self.limiter = RateLimiter(self.settings.delay_seconds, self.settings.delay_jitter)

    @abstractmethod
    def supports(self, criteria: SearchCriteria) -> bool: ...

    @abstractmethod
    async def scrape(self, criteria: SearchCriteria) -> tuple[list[Listing], PortalResult]: ...


class BaseScraper(Scraper):
    """Paginated HTML/JSON-in-HTML source: subclasses only build URLs and parse pages."""

    #: Portals whose bot wall rejects plain HTTP go straight to Playwright.
    prefers_browser: bool = False
    #: Appended to the error when the portal answers with a bot wall.
    block_hint: str = ""

    @abstractmethod
    def build_url(self, criteria: SearchCriteria, page: int) -> str: ...

    @abstractmethod
    def parse_page(self, html: str) -> PageResult: ...

    def supports(self, criteria: SearchCriteria) -> bool:
        return self.portal in criteria.location_slugs

    async def scrape(self, criteria: SearchCriteria) -> tuple[list[Listing], PortalResult]:
        result = PortalResult(portal=self.portal, status=RunStatus.running)
        fetcher = BrowserFetcher(self.limiter) if self.prefers_browser else HttpFetcher(self.limiter)
        listings: list[Listing] = []
        seen: set[str] = set()
        max_pages = criteria.max_pages or self.settings.max_pages_per_run

        try:
            for page in range(1, max_pages + 1):
                url = self.build_url(criteria, page)
                try:
                    html = await fetcher.fetch(url)
                except BlockedError:
                    if fetcher.name == "browser":
                        raise
                    logger.warning("%s blocked the HTTP client, falling back to browser", self.portal)
                    await fetcher.aclose()
                    fetcher = BrowserFetcher(self.limiter)
                    html = await fetcher.fetch(url)

                save_raw_page(self.portal, self.run_id, page, html)
                page_result = self.parse_page(html)

                if not page_result.listings:
                    if page == 1 and len(html) > 30_000:
                        path = save_debug_snapshot(self.portal, self.run_id, html)
                        raise StructureChangedError(
                            f"{self.portal}: page loaded ({len(html)} chars) but no listing parsed. "
                            f"Selectors likely changed. Snapshot: {path}"
                        )
                    break

                result.pages_fetched = page
                result.total_reported = page_result.total_reported or result.total_reported
                for listing in page_result.listings:
                    if listing.listing_id in seen:
                        continue
                    seen.add(listing.listing_id)
                    listing.search_id = self.search_id
                    listing.scraped_at = datetime.now(timezone.utc)
                    listings.append(listing)

                if result.total_reported and len(listings) >= result.total_reported:
                    break

            result.status = RunStatus.done
        except ScrapeError as exc:
            result.status = RunStatus.failed
            hint = f" {self.block_hint}" if isinstance(exc, BlockedError) and self.block_hint else ""
            result.error = f"{exc}{hint}"
            logger.error("%s scrape failed: %s", self.portal, exc)
        finally:
            await fetcher.aclose()

        result.fetcher = fetcher.name
        result.listings = len(listings)
        result.field_coverage = field_coverage(listings)
        return listings, result


def field_coverage(listings: list[Listing]) -> dict[str, float]:
    """Share of listings with each key field populated — catches silent partial breakage."""
    if not listings:
        return {}
    return {
        name: round(sum(getattr(item, name) is not None for item in listings) / len(listings), 3)
        for name in COVERAGE_FIELDS
    }
