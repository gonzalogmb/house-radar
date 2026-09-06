from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="HR_", extra="ignore")

    data_dir: Path = Path("data")

    # Politeness: one request every delay_seconds (+ up to jitter) per portal.
    delay_seconds: float = 5.0
    delay_jitter: float = 3.0
    max_retries: int = 4
    backoff_base: float = 4.0
    request_timeout: float = 30.0

    max_pages_per_run: int = 5
    headless: bool = True

    # Official idealista API (idealista.com/labs). Without it the idealista portal is
    # unavailable: its public site answers 403 to every automated client.
    idealista_api_key: str | None = None
    idealista_api_secret: str | None = None

    # When true, anyone hitting the public deployment can browse listings/runs but
    # cannot create, run, or delete searches — the internal daily scheduler still
    # does that. admin_token reopens those endpoints for whoever holds the secret
    # (sent as the X-Admin-Token header), so the owner can still manage searches
    # remotely without redeploying. Leaving admin_token unset while public_demo is
    # true locks those endpoints for everyone, owner included but for shell access.
    public_demo: bool = False
    admin_token: str | None = None

    # Hour of day (0-23) for the daily run of every saved search. -1 disables it.
    daily_run_hour: int = 7
    timezone: str = "Europe/Madrid"

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def listings_dir(self) -> Path:
        return self.data_dir / "listings"

    @property
    def debug_dir(self) -> Path:
        return self.data_dir / "debug"

    @property
    def searches_file(self) -> Path:
        return self.data_dir / "searches.json"

    @property
    def runs_file(self) -> Path:
        return self.data_dir / "runs.json"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    for directory in (settings.raw_dir, settings.listings_dir, settings.debug_dir):
        directory.mkdir(parents=True, exist_ok=True)
    return settings
