import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from app.models import Listing, SearchCriteria
from app.scrapers.base import BaseScraper, PageResult

BASE = "https://www.idealista.com"

# Idealista encodes filters as path segments, and rooms only in these buckets.
ROOM_BUCKETS = [
    (1, "de-un-dormitorio"),
    (2, "de-dos-dormitorios"),
    (3, "de-tres-dormitorios"),
    (4, "de-cuatro-cinco-habitaciones"),
]

NUMBER_RE = re.compile(r"[\d.,]+")


class IdealistaScraper(BaseScraper):
    """Server-rendered HTML, but every result page sits behind DataDome and answers 403
    to automated clients (headless and headful alike). Kept because the parser is correct
    and the portal may serve a given network fine; use the API scraper when it doesn't."""

    portal = "idealista"
    prefers_browser = True
    block_hint = (
        "Idealista sirve un muro anti-bot (DataDome) en las páginas de resultados. "
        "Configura HR_IDEALISTA_API_KEY/SECRET para usar su API oficial."
    )

    def build_url(self, criteria: SearchCriteria, page: int) -> str:
        slug = criteria.location_slugs[self.portal]
        path = f"/{criteria.operation}-viviendas/{slug}/"

        filters: list[str] = []
        if criteria.max_price:
            filters.append(f"precio-hasta_{criteria.max_price}")
        if criteria.min_price:
            filters.append(f"precio-desde_{criteria.min_price}")
        if criteria.min_rooms:
            filters += [slug_ for rooms, slug_ in ROOM_BUCKETS if rooms >= criteria.min_rooms]
        if criteria.min_surface:
            filters.append(f"metros-cuadrados-mas-de_{criteria.min_surface}")
        if filters:
            path += "con-" + ",".join(filters) + "/"
        if page > 1:
            path += f"pagina-{page}.htm"
        return f"{BASE}{path}?ordenado-por=fecha-publicacion-desc"

    def parse_page(self, html: str) -> PageResult:
        soup = BeautifulSoup(html, "lxml")
        listings = []
        for article in soup.select("article.item"):
            listing = self._to_listing(article)
            if listing is not None:
                listings.append(listing)
        return PageResult(listings=listings, total_reported=_total_reported(soup))

    def _to_listing(self, article: Tag) -> Listing | None:
        listing_id = article.get("data-element-id")
        link = article.select_one("a.item-link")
        if not listing_id or link is None or not link.get("href"):
            return None  # sponsored blocks and adverts carry neither

        details = [tag.get_text(" ", strip=True) for tag in article.select(".item-detail")]
        rooms = surface = floor = None
        for text in details:
            lowered = text.lower()
            if "hab" in lowered:
                rooms = _to_int(text)
            elif "m²" in lowered:
                surface = _to_float(text)
            elif "planta" in lowered or "bajo" in lowered or "entreplanta" in lowered:
                floor = text

        title = (link.get("title") or link.get_text(" ", strip=True)).strip()
        parts = [part.strip() for part in title.split(",")]
        agency = article.select_one(".hightop-agent-name") or article.select_one(".item-branding")
        picture = article.select_one("picture img, picture source")
        counter = article.select_one(".item-multimedia-pictures__counter span:last-child")

        return Listing(
            portal=self.portal,
            listing_id=str(listing_id),
            url=urljoin(BASE, link["href"]),
            title=title,
            price=_to_float(_text(article, ".item-price")),
            previous_price=_to_float(_text(article, ".pricedown_price")),
            surface_m2=surface,
            rooms=rooms,
            floor=floor,
            has_lift=("ascensor" in floor.lower()) if floor else None,
            is_exterior=("exterior" in floor.lower()) if floor else None,
            city=parts[-1] if len(parts) > 1 else None,
            neighborhood=parts[-2] if len(parts) > 2 else None,
            advertiser_type=(
                "professional" if article.get("data-is-professional-ad") == "true" else "private"
            ),
            advertiser_name=agency.get_text(" ", strip=True) if agency else None,
            description=_text(article, ".item-description"),
            thumbnail=(picture.get("src") or picture.get("srcset")) if picture else None,
            n_images=_to_int(counter.get_text(strip=True)) if counter else None,
            is_new_construction="/obra-nueva/" in link["href"],
        )


def _text(node: Tag, selector: str) -> str | None:
    found = node.select_one(selector)
    return found.get_text(" ", strip=True) if found else None


def _to_float(text: str | None) -> float | None:
    """'1.480.000€' -> 1480000.0, '212 m²' -> 212.0, '1.200 €/mes' -> 1200.0."""
    if not text:
        return None
    match = NUMBER_RE.search(text)
    if not match:
        return None
    cleaned = match.group().replace(".", "").replace(",", ".")
    try:
        return float(cleaned) or None
    except ValueError:
        return None


def _to_int(text: str | None) -> int | None:
    value = _to_float(text)
    return int(value) if value is not None else None


def _total_reported(soup: BeautifulSoup) -> int | None:
    heading = soup.select_one("#h1-container h1") or soup.select_one("h1")
    if heading is None:
        return None
    match = NUMBER_RE.search(heading.get_text(" ", strip=True))
    return int(match.group().replace(".", "")) if match else None
