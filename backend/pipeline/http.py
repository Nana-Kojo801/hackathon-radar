"""A small polite HTTP client: identifies itself, waits between requests to
the same host, and checks robots.txt (fail-open if robots can't be read)."""

import logging
import threading
import time
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from app.config import USER_AGENT

log = logging.getLogger(__name__)

# Note: Devpost answers 403 to non-browser clients that send Accept: text/html,
# so keep the default Accept: */*.
HEADERS = {"User-Agent": USER_AGENT, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.8"}


class RobotsDisallowed(Exception):
    pass


class PoliteClient:
    def __init__(self, delay: float = 1.0, timeout: float = 20.0):
        self.delay = delay
        self.client = httpx.Client(
            headers=HEADERS, timeout=timeout, follow_redirects=True
        )
        self._last: dict[str, float] = {}
        self._robots: dict[str, RobotFileParser | None] = {}
        self._lock = threading.Lock()

    def _robots_for(self, url: str) -> RobotFileParser | None:
        parts = urlsplit(url)
        base = f"{parts.scheme}://{parts.netloc}"
        if base not in self._robots:
            rp: RobotFileParser | None = None
            try:
                r = self.client.get(base + "/robots.txt", timeout=8)
                if r.status_code == 200:
                    rp = RobotFileParser()
                    rp.parse(r.text.splitlines())
            except httpx.HTTPError:
                rp = None
            self._robots[base] = rp
        return self._robots[base]

    def allowed(self, url: str) -> bool:
        rp = self._robots_for(url)
        return rp is None or rp.can_fetch(USER_AGENT, url)

    @staticmethod
    def _site(url: str) -> str:
        # Throttle per site, so foo.devpost.com and bar.devpost.com share one delay.
        return ".".join(urlsplit(url).netloc.lower().split(".")[-2:])

    def _wait(self, site: str) -> None:
        with self._lock:
            last = self._last.get(site, 0.0)
            gap = time.monotonic() - last
            if gap < self.delay:
                time.sleep(self.delay - gap)
            self._last[site] = time.monotonic()

    def get(self, url: str, check_robots: bool = True, **kw) -> httpx.Response:
        if check_robots and not self.allowed(url):
            raise RobotsDisallowed(url)
        self._wait(self._site(url))
        r = self.client.get(url, **kw)
        r.raise_for_status()
        return r

    def post(self, url: str, check_robots: bool = True, **kw) -> httpx.Response:
        """For read-only JSON/GraphQL APIs that take their query in a POST body."""
        if check_robots and not self.allowed(url):
            raise RobotsDisallowed(url)
        self._wait(self._site(url))
        r = self.client.post(url, **kw)
        r.raise_for_status()
        return r

    def close(self) -> None:
        self.client.close()
