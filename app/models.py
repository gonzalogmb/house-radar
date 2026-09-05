from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

Operation = Literal["venta", "alquiler"]


class SearchCriteria(BaseModel):
    """Portal-agnostic search. Slugs differ per portal, so they travel together."""

    location_name: str = Field(..., description="Human label, e.g. 'Madrid capital'")
    location_slugs: dict[str, str] = Field(
        ..., description="Portal id -> location slug used in that portal's URLs"
    )
    center: str | None = Field(
        None, description="'lat,lon' — used by the idealista API, which has no slugs"
    )
    radius_m: int = 8000
    operation: Operation = "venta"
    portals: list[str] = Field(default_factory=lambda: ["idealista", "fotocasa"])
    min_price: int | None = None
    max_price: int | None = None
    min_rooms: int | None = None
    min_surface: int | None = None
    max_pages: int | None = None


class SavedSearch(BaseModel):
    id: str
    name: str
    criteria: SearchCriteria
    enabled: bool = True
    created_at: datetime
    last_run_at: datetime | None = None


class Listing(BaseModel):
    portal: str
    listing_id: str
    url: str
    title: str | None = None
    price: float | None = None
    previous_price: float | None = None
    surface_m2: float | None = None
    rooms: int | None = None
    bathrooms: int | None = None
    floor: str | None = None
    has_lift: bool | None = None
    is_exterior: bool | None = None
    city: str | None = None
    district: str | None = None
    neighborhood: str | None = None
    postal_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    advertiser_type: str | None = None
    advertiser_name: str | None = None
    description: str | None = None
    thumbnail: str | None = None
    n_images: int | None = None
    published_at: datetime | None = None
    is_new_construction: bool | None = None

    # Provenance
    search_id: str | None = None
    scraped_at: datetime | None = None

    @property
    def price_per_m2(self) -> float | None:
        if self.price and self.surface_m2:
            return round(self.price / self.surface_m2, 2)
        return None


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


class PortalResult(BaseModel):
    portal: str
    status: RunStatus
    pages_fetched: int = 0
    listings: int = 0
    total_reported: int | None = None
    fetcher: str | None = None
    error: str | None = None
    field_coverage: dict[str, float] = Field(default_factory=dict)


class RunRecord(BaseModel):
    id: str
    search_id: str | None
    search_name: str
    criteria: SearchCriteria
    status: RunStatus = RunStatus.pending
    started_at: datetime
    finished_at: datetime | None = None
    portals: list[PortalResult] = Field(default_factory=list)
    total_listings: int = 0
    new_listings: int = 0
    price_drops: int = 0
    error: str | None = None
