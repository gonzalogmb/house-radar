from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from app.models import Listing, SearchCriteria
from app.scrapers.base import BaseScraper, PageResult
from app.scrapers.idealista import NUMBER_RE, _to_float, _to_int  # shared "1.480.000€" parsing

BASE = "https://www.pisos.com"
OPERATION_SEGMENT = {"venta": "venta", "alquiler": "alquiler"}


class PisosScraper(BaseScraper):
    """pisos.com: plain server-rendered HTML, no bot wall found. Filters are path
    segments in a fixed order the server redirects any other order into — build them
    in that canonical order so we don't rely on the redirect."""

    portal = "pisos"
    unavailable_fields = frozenset({"published_at"})

    def build_url(self, criteria: SearchCriteria, page: int) -> str:
        slug = criteria.location_slugs[self.portal]
        operation = OPERATION_SEGMENT[criteria.operation]
        segments = [f"pisos-{slug}"]
        if criteria.min_rooms:
            segments.append(f"con-{criteria.min_rooms}-habitaciones")
        if criteria.min_surface:
            segments.append(f"desde-{criteria.min_surface}-m2")
        if criteria.min_price:
            segments.append(f"desde-{criteria.min_price}")
        if criteria.max_price:
            segments.append(f"hasta-{criteria.max_price}")
        if page > 1:
            segments.append(str(page))
        return f"{BASE}/{operation}/" + "/".join(segments) + "/"

    def parse_page(self, html: str) -> PageResult:
        soup = BeautifulSoup(html, "lxml")
        listings = [
            listing
            for article in soup.select(".ad-preview")
            if (listing := self._to_listing(article)) is not None
        ]
        return PageResult(listings=listings, total_reported=_total_reported(soup))

    def _to_listing(self, article: Tag) -> Listing | None:
        href = article.get("data-lnk-href")
        listing_id = article.get("id")
        title_el = article.select_one(".ad-preview__title")
        if not href or not listing_id or title_el is None:
            return None  # ads and promo cards carry no data-lnk-href

        chars = [tag.get_text(" ", strip=True) for tag in article.select(".ad-preview__char")]
        rooms = bathrooms = surface = floor = None
        for text in chars:
            lowered = text.lower()
            if "hab" in lowered:
                rooms = _to_int(text)
            elif "baño" in lowered:
                bathrooms = _to_int(text)
            elif "m²" in lowered:
                surface = _to_float(text)
            else:
                floor = text  # "Bajo", "3ª planta", "Entreplanta"...

        subtitle = article.select_one(".ad-preview__subtitle")
        city, district, neighborhood = _split_subtitle(subtitle.get_text(" ", strip=True) if subtitle else None)

        price = _to_float(_text(article, ".ad-preview__price"))
        drop = _to_float(_text(article, ".ad-preview__drop"))
        image = article.select_one(".carousel__main-photo--mosaic img, .carousel img")

        return Listing(
            portal=self.portal,
            listing_id=str(listing_id),
            url=urljoin(BASE, href),
            title=title_el.get_text(" ", strip=True),
            price=price,
            previous_price=(price + drop) if price is not None and drop is not None else None,
            surface_m2=surface,
            rooms=rooms,
            bathrooms=bathrooms,
            floor=floor,
            has_lift=None,
            is_exterior=None,
            city=city,
            district=district,
            neighborhood=neighborhood,
            description=_text(article, ".ad-preview__description"),
            thumbnail=image.get("src") or image.get("data-src") if image else None,
            is_new_construction="obra-nueva" in href or "obra_nueva" in href,
        )


def _text(node: Tag, selector: str) -> str | None:
    found = node.select_one(selector)
    return found.get_text(" ", strip=True) if found else None


def _split_subtitle(text: str | None) -> tuple[str | None, str | None, str | None]:
    """'Pueblo Nuevo (Distrito Ciudad Lineal. Madrid Capital)' -> barrio, distrito, ciudad."""
    if not text:
        return None, None, None
    neighborhood, _, rest = text.partition("(")
    parts = [p.strip() for p in rest.rstrip(")").split(".")]
    district = parts[0].removeprefix("Distrito ").strip() if parts else None
    city = parts[1].strip() if len(parts) > 1 else None
    return city, district, neighborhood.strip() or None


def _total_reported(soup: BeautifulSoup) -> int | None:
    spans = soup.select(".grid__title span")
    if len(spans) < 2:
        return None
    match = NUMBER_RE.search(spans[1].get_text(strip=True))
    return int(match.group().replace(".", "")) if match else None
