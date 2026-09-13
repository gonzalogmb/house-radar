from app.config import get_settings
from app.scrapers.base import BaseScraper, Scraper
from app.scrapers.fotocasa import FotocasaScraper
from app.scrapers.idealista import IdealistaScraper
from app.scrapers.idealista_api import IdealistaApiScraper
from app.scrapers.pisos import PisosScraper
from app.scrapers.servihabitat import ServihabitatScraper

PORTALS = ("idealista", "fotocasa", "pisos", "servihabitat")


def scraper_for(portal: str) -> type[Scraper] | None:
    """Idealista has two backends: the official API when credentials exist, the HTML
    site otherwise (which will report the bot wall rather than pretend it worked)."""
    if portal == "idealista":
        return IdealistaApiScraper if get_settings().idealista_api_key else IdealistaScraper
    if portal == "fotocasa":
        return FotocasaScraper
    if portal == "pisos":
        return PisosScraper
    if portal == "servihabitat":
        return ServihabitatScraper
    return None


__all__ = [
    "PORTALS",
    "BaseScraper",
    "FotocasaScraper",
    "IdealistaApiScraper",
    "IdealistaScraper",
    "PisosScraper",
    "Scraper",
    "ServihabitatScraper",
    "scraper_for",
]
