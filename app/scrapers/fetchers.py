import asyncio
import logging
import random
import time

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class ScrapeError(Exception):
    pass


class BlockedError(ScrapeError):
    """The portal answered, but with a bot wall instead of content."""


class StructureChangedError(ScrapeError):
    """The page loaded fine but the parser no longer recognises it."""


BLOCK_MARKERS = (
    "captcha-delivery.com",
    "datadome",
    "access denied",
    "pardon our interruption",
    "request unsuccessful",
    "are you a robot",
)

USER_AGENTS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
)


def looks_blocked(html: str) -> bool:
    head = html[:4000].lower()
    return any(marker in head for marker in BLOCK_MARKERS)


class RateLimiter:
    """One shared pacer per portal: never two requests closer than delay + jitter."""

    def __init__(self, delay: float, jitter: float) -> None:
        self.delay = delay
        self.jitter = jitter
        self._lock = asyncio.Lock()
        self._last = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            wait_for = self._last + self.delay + random.uniform(0, self.jitter) - time.monotonic()
            if wait_for > 0:
                await asyncio.sleep(wait_for)
            self._last = time.monotonic()


class HttpFetcher:
    name = "http"

    def __init__(self, limiter: RateLimiter) -> None:
        self.settings = get_settings()
        self.limiter = limiter
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self.settings.request_timeout,
                follow_redirects=True,
                headers={
                    "User-Agent": random.choice(USER_AGENTS),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
                    "Upgrade-Insecure-Requests": "1",
                },
            )
        return self._client

    async def fetch(self, url: str) -> str:
        client = await self._get_client()
        last_error: Exception | None = None

        for attempt in range(self.settings.max_retries):
            await self.limiter.acquire()
            try:
                response = await client.get(url)
            except httpx.HTTPError as exc:
                last_error = exc
                logger.warning("network error on %s (attempt %s): %s", url, attempt + 1, exc)
                await self._backoff(attempt)
                continue

            if response.status_code in (403, 429) or response.status_code >= 500:
                last_error = ScrapeError(f"HTTP {response.status_code} for {url}")
                retry_after = _retry_after_seconds(response)
                logger.warning(
                    "HTTP %s on %s (attempt %s), retry_after=%s",
                    response.status_code,
                    url,
                    attempt + 1,
                    retry_after,
                )
                await self._backoff(attempt, retry_after)
                continue

            response.raise_for_status()
            if looks_blocked(response.text):
                raise BlockedError(f"bot wall served for {url}")
            return response.text

        if isinstance(last_error, ScrapeError) and "403" in str(last_error):
            raise BlockedError(str(last_error))
        raise ScrapeError(f"giving up on {url}: {last_error}")

    async def _backoff(self, attempt: int, retry_after: float | None = None) -> None:
        delay = retry_after if retry_after is not None else self.settings.backoff_base * (2**attempt)
        await asyncio.sleep(delay + random.uniform(0, 1.5))

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def _retry_after_seconds(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


class BrowserFetcher:
    """Playwright fallback for portals that reject plain HTTP clients."""

    name = "browser"

    def __init__(self, limiter: RateLimiter) -> None:
        self.settings = get_settings()
        self.limiter = limiter
        self._playwright = None
        self._browser = None
        self._context = None

    async def _get_context(self):
        if self._context is None:
            from playwright.async_api import async_playwright

            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self.settings.headless,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            self._context = await self._browser.new_context(
                locale="es-ES",
                timezone_id=self.settings.timezone,
                viewport={"width": 1440, "height": 900},
                user_agent=USER_AGENTS[0],
            )
            # navigator.webdriver is the cheapest tell; blank it before any page script runs.
            await self._context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
            )
        return self._context

    async def fetch(self, url: str) -> str:
        context = await self._get_context()
        last_error: Exception | None = None
        last_status = 0

        for attempt in range(self.settings.max_retries):
            await self.limiter.acquire()
            page = await context.new_page()
            try:
                response = await page.goto(
                    url, wait_until="domcontentloaded", timeout=self.settings.request_timeout * 1000
                )
                status = last_status = response.status if response else 0
                if status in (403, 429) or status >= 500:
                    last_error = ScrapeError(f"HTTP {status} for {url}")
                    await asyncio.sleep(self.settings.backoff_base * (2**attempt))
                    continue
                html = await page.content()
                if looks_blocked(html):
                    raise BlockedError(f"bot wall served for {url}")
                return html
            except BlockedError:
                raise
            except Exception as exc:  # noqa: BLE001 - playwright raises a wide family here
                last_error = exc
                logger.warning("browser error on %s (attempt %s): %s", url, attempt + 1, exc)
                await asyncio.sleep(self.settings.backoff_base * (2**attempt))
            finally:
                await page.close()

        if last_status in (403, 429):
            raise BlockedError(f"{url} answered HTTP {last_status} to the browser too")
        raise ScrapeError(f"giving up on {url}: {last_error}")

    async def aclose(self) -> None:
        for closer in (self._context, self._browser):
            if closer is not None:
                await closer.close()
        if self._playwright is not None:
            await self._playwright.stop()
        self._context = self._browser = self._playwright = None
