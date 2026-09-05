"""Official idealista REST API (https://developers.idealista.com).

The public HTML site sits behind DataDome and answers 403 to any automated client, so
this is the supported way in. Request a key at idealista.com/labs/ and set
HR_IDEALISTA_API_KEY / HR_IDEALISTA_API_SECRET. The free tier is ~100 requests/month,
which is why max_pages matters a lot more here than on a scraped portal.
"""

import asyncio
import base64
import logging
from datetime import datetime, timezone

import httpx

from app.models import Listing, PortalResult, RunStatus, SearchCriteria
from app.scrapers.base import Scraper, field_coverage
from app.scrapers.fetchers import ScrapeError

logger = logging.getLogger(__name__)

TOKEN_URL = "https://api.idealista.com/oauth/token"
SEARCH_URL = "https://api.idealista.com/3.5/es/search"
MAX_ITEMS_PER_PAGE = 50
OPERATION = {"venta": "sale", "alquiler": "rent"}


class IdealistaApiScraper(Scraper):
    portal = "idealista"

    def supports(self, criteria: SearchCriteria) -> bool:
        return bool(criteria.center and self.settings.idealista_api_key)

    async def scrape(self, criteria: SearchCriteria) -> tuple[list[Listing], PortalResult]:
        result = PortalResult(portal=self.portal, status=RunStatus.running, fetcher="api")
        listings: list[Listing] = []
        max_pages = criteria.max_pages or self.settings.max_pages_per_run

        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout) as client:
                token = await self._get_token(client)
                for page in range(1, max_pages + 1):
                    await self.limiter.acquire()
                    payload = await self._search(client, token, criteria, page)
                    result.total_reported = payload.get("total")
                    elements = payload.get("elementList") or []
                    if not elements:
                        break
                    result.pages_fetched = page
                    listings.extend(self._to_listing(item) for item in elements)
                    if page >= (payload.get("totalPages") or page):
                        break
            result.status = RunStatus.done
        except (ScrapeError, httpx.HTTPError) as exc:
            result.status = RunStatus.failed
            result.error = str(exc)
            logger.error("idealista api failed: %s", exc)

        for listing in listings:
            listing.search_id = self.search_id
            listing.scraped_at = datetime.now(timezone.utc)
        result.listings = len(listings)
        result.field_coverage = field_coverage(listings)
        return listings, result

    async def _get_token(self, client: httpx.AsyncClient) -> str:
        credentials = f"{self.settings.idealista_api_key}:{self.settings.idealista_api_secret}"
        encoded = base64.b64encode(credentials.encode()).decode()
        response = await client.post(
            TOKEN_URL,
            headers={
                "Authorization": f"Basic {encoded}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials", "scope": "read"},
        )
        if response.status_code != 200:
            raise ScrapeError(f"idealista token request failed: HTTP {response.status_code}")
        return response.json()["access_token"]

    async def _search(
        self, client: httpx.AsyncClient, token: str, criteria: SearchCriteria, page: int
    ) -> dict:
        params: dict[str, str | int | float] = {
            "operation": OPERATION[criteria.operation],
            "propertyType": "homes",
            "center": criteria.center,
            "distance": criteria.radius_m,
            "maxItems": MAX_ITEMS_PER_PAGE,
            "numPage": page,
            "order": "publicationDate",
            "sort": "desc",
        }
        if criteria.min_price:
            params["minPrice"] = criteria.min_price
        if criteria.max_price:
            params["maxPrice"] = criteria.max_price
        if criteria.min_rooms:
            params["minRooms"] = criteria.min_rooms
        if criteria.min_surface:
            params["minSize"] = criteria.min_surface

        for attempt in range(self.settings.max_retries):
            response = await client.post(
                SEARCH_URL, headers={"Authorization": f"Bearer {token}"}, data=params
            )
            if response.status_code == 429:
                wait = self.settings.backoff_base * (2**attempt)
                logger.warning("idealista api rate limited, sleeping %.0fs", wait)
                await asyncio.sleep(wait)
                continue
            if response.status_code != 200:
                raise ScrapeError(f"idealista search failed: HTTP {response.status_code}")
            return response.json()
        raise ScrapeError("idealista api kept rate limiting the search")

    def _to_listing(self, item: dict) -> Listing:
        return Listing(
            portal=self.portal,
            listing_id=str(item.get("propertyCode")),
            url=item.get("url"),
            title=item.get("suggestedTexts", {}).get("title") or item.get("address"),
            price=item.get("price"),
            previous_price=item.get("priceInfo", {}).get("previousPrice"),
            surface_m2=item.get("size"),
            rooms=item.get("rooms"),
            bathrooms=item.get("bathrooms"),
            floor=item.get("floor"),
            has_lift=item.get("hasLift"),
            is_exterior=item.get("exterior"),
            city=item.get("municipality"),
            district=item.get("district"),
            neighborhood=item.get("neighborhood"),
            latitude=item.get("latitude"),
            longitude=item.get("longitude"),
            advertiser_type=item.get("contactInfo", {}).get("userType"),
            advertiser_name=item.get("contactInfo", {}).get("commercialName"),
            description=item.get("description"),
            thumbnail=item.get("thumbnail"),
            n_images=item.get("numPhotos"),
            is_new_construction=item.get("newDevelopment"),
        )
