import json
from datetime import datetime, timezone
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from app.models import Listing, SearchCriteria
from app.scrapers.base import BaseScraper, PageResult
from app.scrapers.fetchers import StructureChangedError

BASE = "https://www.fotocasa.es"
OPERATION_SEGMENT = {"venta": "comprar", "alquiler": "alquiler"}


class FotocasaScraper(BaseScraper):
    """Fotocasa ships the whole result set as JSON inside the page, so we read that
    instead of the markup: it survives redesigns and carries more fields."""

    portal = "fotocasa"
    prefers_browser = False

    def build_url(self, criteria: SearchCriteria, page: int) -> str:
        slug = criteria.location_slugs[self.portal]
        operation = OPERATION_SEGMENT[criteria.operation]
        path = f"/es/{operation}/viviendas/{slug}/todas-las-zonas/l"
        if page > 1:
            path += f"/{page}"

        params: dict[str, str | int] = {"sortType": "publicationDate"}
        if criteria.min_price:
            params["minPrice"] = criteria.min_price
        if criteria.max_price:
            params["maxPrice"] = criteria.max_price
        if criteria.min_rooms:
            params["minRooms"] = criteria.min_rooms
        if criteria.min_surface:
            params["minSurface"] = criteria.min_surface
        return f"{BASE}{path}?{urlencode(params)}"

    def parse_page(self, html: str) -> PageResult:
        soup = BeautifulSoup(html, "lxml")
        tag = soup.find("script", id="__initial_props__")
        if tag is None or not tag.string:
            return PageResult()

        try:
            payload = json.loads(tag.string)
            result = payload["initialSearch"]["result"]
            raw_items = result["realEstates"]
        except (json.JSONDecodeError, KeyError) as exc:
            raise StructureChangedError(f"fotocasa payload shape changed: {exc}") from exc

        listings = [self._to_listing(item) for item in raw_items]
        return PageResult(
            listings=[item for item in listings if item is not None],
            total_reported=result.get("count"),
        )

    def _to_listing(self, item: dict) -> Listing | None:
        detail = (item.get("detail") or {}).get("es-ES")
        listing_id = item.get("id")
        if not detail or not listing_id:
            return None

        features = {f["key"]: f.get("value") for f in item.get("features") or []}
        address = item.get("address") or {}
        coordinates = item.get("coordinates") or {}
        multimedia = item.get("multimedia") or []
        dynamic = item.get("dynamicFeatures") or []

        return Listing(
            portal=self.portal,
            listing_id=str(listing_id),
            url=f"{BASE}{detail}",
            title=item.get("location"),
            price=_as_float(item.get("rawPrice")),
            previous_price=_as_float(item.get("reducedPrice")),
            surface_m2=_as_float(features.get("surface")),
            rooms=_as_int(features.get("rooms")),
            bathrooms=_as_int(features.get("bathrooms")),
            floor=str(features["floor"]) if features.get("floor") is not None else None,
            has_lift="elevator" in features,
            is_exterior="IS_EXTERIOR" in dynamic,
            city=address.get("city"),
            district=address.get("district"),
            neighborhood=address.get("neighborhood"),
            postal_code=address.get("zipCode"),
            latitude=coordinates.get("latitude"),
            longitude=coordinates.get("longitude"),
            advertiser_type=item.get("clientType"),
            advertiser_name=item.get("clientAlias"),
            description=(item.get("description") or "").strip() or None,
            thumbnail=_thumbnail(multimedia),
            n_images=len(multimedia) or None,
            published_at=_from_timestamp((item.get("date") or {}).get("timestamp")),
            is_new_construction=item.get("isNewConstruction"),
        )


def _thumbnail(multimedia: list[dict]) -> str | None:
    """`rule=original` is a 1440px 110 KB photo; the cards want the 320px 8 KB one."""
    if not multimedia:
        return None
    return multimedia[0]["src"].replace("rule=original", "rule=medium")


def _as_float(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number or None


def _as_int(value) -> int | None:
    number = _as_float(value)
    return int(number) if number is not None else None


def _from_timestamp(millis) -> datetime | None:
    if not millis:
        return None
    return datetime.fromtimestamp(millis / 1000, tz=timezone.utc)
