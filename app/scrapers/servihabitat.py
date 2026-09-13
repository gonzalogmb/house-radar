from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from app.models import Listing, SearchCriteria
from app.scrapers.base import BaseScraper, PageResult
from app.scrapers.idealista import _to_float  # shared "1.480.000€"/"60m²" parsing

BASE = "https://servihabitat.com"


class ServihabitatScraper(BaseScraper):
    """Servihabitat's own property site — one of the servicers Sareb delegates sales
    to (see app/advertiser_tags.py); every listing here counts as Sareb-related, so
    advertiser_name is hardcoded rather than guessed. Plain server-rendered HTML, no
    bot wall, unlike idealista.

    Two quirks worth knowing before touching this parser:
    - The clean URL only takes a province-wide slug (`/es/venta/vivienda/madrid`) —
      no municipio-level narrowing was found, so results cover the whole province,
      not just the capital.
    - There's no plain-link or query-param pagination: the rest of a province's
      listings load through an internal AJAX token this scraper doesn't replicate,
      so each run captures only the first page (~20-30 results). The real total is
      still recorded via PortalResult.total_reported so under-coverage is visible
      rather than silently assumed to be everything.
    Price/room/surface filters aren't accepted by the clean URL either (every guess
    at a query param was ignored), so they're applied here client-side instead of
    server-side like the other portals.
    """

    portal = "servihabitat"
    # published_at: never shown in the list view. rooms: only ~40-50% of cards report
    # it at all (the rest read "0", treated as unknown above) — that's the portal's
    # own data sparsity, not a parser regression, so it's excluded here rather than
    # permanently tripping the coverage alert.
    unavailable_fields = frozenset({"published_at", "rooms"})

    def build_url(self, criteria: SearchCriteria, page: int) -> str:
        # parse_page gets neither criteria nor the page number, so both are stashed
        # here — build_url() always runs immediately before parse_page() for the same
        # page, per BaseScraper.scrape()'s loop.
        self._criteria = criteria
        self._page = page
        slug = criteria.location_slugs[self.portal]
        return f"{BASE}/es/venta/vivienda/{slug}"

    def parse_page(self, html: str) -> PageResult:
        # No real pagination (see class docstring) — every page is the same URL, so
        # from page 2 on this would just re-parse page 1's own listings again. Report
        # nothing instead, so BaseScraper.scrape()'s "page loaded, zero listings"
        # check stops the loop after one wasted extra fetch rather than max_pages.
        if self._page > 1:
            return PageResult(listings=[])

        soup = BeautifulSoup(html, "lxml")
        container = soup.select_one(".product-list")
        total_reported = _int(container.get("data-total")) if container else None

        listings = [
            listing
            for card in soup.select(".list-product-buscador")
            if (listing := self._to_listing(card)) is not None and self._matches(listing)
        ]
        return PageResult(listings=listings, total_reported=total_reported)

    def _matches(self, listing: Listing) -> bool:
        """The clean URL can't filter by price/rooms/surface, so do it here instead."""
        criteria = self._criteria
        if criteria.min_price and (listing.price is None or listing.price < criteria.min_price):
            return False
        if criteria.max_price and (listing.price is None or listing.price > criteria.max_price):
            return False
        if criteria.min_rooms and (listing.rooms is None or listing.rooms < criteria.min_rooms):
            return False
        if criteria.min_surface and (listing.surface_m2 is None or listing.surface_m2 < criteria.min_surface):
            return False
        return True

    def _to_listing(self, card: Tag) -> Listing | None:
        listing_id = card.get("data-id")
        link = card.select_one("a.features")
        if not listing_id or link is None or not link.get("href"):
            return None  # a handful of promo/campaign cards carry no plain detail link

        gtm = {span.get("gtm"): span.get("gtm-value") for span in card.select("span[gtm]")}
        extra = (gtm.get("product-extra") or "").lower()
        state = (gtm.get("product-state") or "").lower()
        image = card.select_one("img.img-car")

        return Listing(
            portal=self.portal,
            listing_id=str(listing_id),
            url=urljoin(BASE, link["href"]),
            title=_text(card, ".features-address"),
            price=_to_float(_text(card, "#price")),
            surface_m2=_to_float(_text(card, "#superficie")),
            # "0" means the card just didn't report a room/bath count, not a real
            # studio — real values here are small clean integers, no thousands-dot
            # ambiguity, so parsed directly rather than through _to_float.
            rooms=_gtm_int(gtm.get("product-room-num")),
            bathrooms=_gtm_int(gtm.get("product-bath-num")),
            has_lift=True if "lift" in extra else None,
            city=_titleish(gtm.get("location-province")),
            district=_titleish(gtm.get("location-area")),
            neighborhood=_titleish(gtm.get("location-town")),
            advertiser_type="servicer",
            advertiser_name="Servihabitat",
            thumbnail=image.get("src") if image else None,
            n_images=_int(gtm.get("product-number-images")),
            is_new_construction="obra nueva" in state,
        )


def _text(node: Tag, selector: str) -> str | None:
    found = node.select_one(selector)
    if found is None:
        return None
    # get_text(" ") only inserts a space *between* tags — the address heading has raw
    # "\n    " runs inside a single text node (from the template's own indentation),
    # so those need collapsing too.
    return " ".join(found.get_text(" ", strip=True).split()) or None


def _titleish(value: str | None) -> str | None:
    return value.title() if value else None


def _int(value: str | None) -> int | None:
    return int(value) if value and value.isdigit() else None


def _gtm_int(value: str | None) -> int | None:
    number = _int(value)
    return number or None
