import hashlib
import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.categories import CATEGORIES

from .types import RawListing

TRACKING_PARAMS = {
    "ref", "ref_src", "ref_url", "source", "fbclid", "gclid", "dclid", "msclkid",
    "mc_cid", "mc_eid", "igshid", "yclid", "_hsenc", "_hsmi", "trk", "si",
}

# Rough FX rates to USD. Good enough for sorting by prize; the AI also
# converts when it enriches. Update occasionally.
FX_TO_USD = {
    "USD": 1.0, "USDC": 1.0, "USDT": 1.0, "EUR": 1.08, "GBP": 1.27, "CAD": 0.73,
    "AUD": 0.66, "INR": 0.012, "SGD": 0.75, "JPY": 0.0067, "CHF": 1.13,
    "NGN": 0.00065, "KES": 0.0077, "GHS": 0.065, "ZAR": 0.055, "MXN": 0.055,
    "BRL": 0.18, "HKD": 0.128, "AED": 0.27, "PLN": 0.25, "SEK": 0.095,
}

# Currency markers as they appear in prize text, most specific first.
CURRENCY_MARKERS = [
    ("$CAD", "CAD"), ("CA$", "CAD"), ("C$", "CAD"), ("A$", "AUD"), ("AU$", "AUD"),
    ("S$", "SGD"), ("MEX$", "MXN"), ("HK$", "HKD"), ("R$", "BRL"), ("US$", "USD"),
    ("USDC", "USDC"), ("USDT", "USDT"), ("USD", "USD"), ("EUR", "EUR"), ("GBP", "GBP"),
    ("INR", "INR"), ("CAD", "CAD"), ("AUD", "AUD"), ("SGD", "SGD"), ("CHF", "CHF"),
    ("€", "EUR"), ("£", "GBP"), ("₹", "INR"), ("¥", "JPY"), ("₦", "NGN"), ("$", "USD"),
]

THEME_TO_CATEGORY = {
    "machine learning/ai": "AI/ML", "ai": "AI/ML", "artificial intelligence": "AI/ML",
    "machine learning": "AI/ML", "generative ai": "AI/ML", "llm": "AI/ML",
    "web": "web", "mobile": "mobile", "databases": "data", "data": "data",
    "data science": "data", "iot": "hardware/IoT", "hardware": "hardware/IoT",
    "robotic process automation": "software", "robotics": "robotics",
    "cybersecurity": "cybersecurity", "security": "cybersecurity",
    "blockchain": "web3/blockchain", "web3": "web3/blockchain", "crypto": "web3/blockchain",
    "defi": "web3/blockchain", "ethereum": "web3/blockchain",
    "gaming": "gaming", "games": "gaming", "health": "health", "healthcare": "health",
    "fintech": "fintech", "finance": "fintech", "e-commerce/retail": "fintech",
    "climate": "climate", "sustainability": "climate", "environment": "climate",
    "education": "education", "edtech": "education", "open ended": "open-ended",
    "no restrictions": "open-ended", "devops": "software", "serverless": "software",
    "enterprise": "software", "productivity": "software", "low/no code": "software",
    "communication": "networking", "networking": "networking", "ar/vr": "gaming",
    "quantum": "software", "design": "web", "social good": "open-ended",
}


@dataclass
class Normalized:
    raw: RawListing
    source_url: str
    title_key: str
    content_hash: str


def canonical_url(url: str) -> str:
    url = (url or "").strip()
    if url.startswith("//"):
        url = "https:" + url
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parts = urlsplit(url)
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if host.endswith(":443") or host.endswith(":80"):
        host = host.rsplit(":", 1)[0]
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=False)
        if not k.lower().startswith("utm_") and k.lower() not in TRACKING_PARAMS
    ]
    path = re.sub(r"/+$", "", parts.path)
    return urlunsplit(("https", host, path, urlencode(sorted(query)), ""))


_YEAR = re.compile(r"\b(19|20)\d{2}\b")
_FILLER = re.compile(r"\b(the|hackathon|hackathons|edition|annual)\b")


def title_key(title: str) -> str:
    t = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode().lower()
    t = _YEAR.sub(" ", t)
    t = _FILLER.sub(" ", t)
    return re.sub(r"[^a-z0-9]+", "", t)


def clean_text(text: str | None, limit: int | None = None) -> str | None:
    if not text:
        return None
    t = re.sub(r"[ \t\r\f\v]+", " ", str(text))
    t = re.sub(r"\n\s*\n+", "\n\n", t).strip()
    if limit and len(t) > limit:
        t = t[:limit].rsplit(" ", 1)[0] + "…"
    return t or None


def content_hash(r: RawListing) -> str:
    parts = [r.title, r.description, r.prize_text, r.dates_text]
    blob = "\x1f".join((p or "").strip() for p in parts)
    return hashlib.sha256(blob.encode()).hexdigest()


def parse_money(text: str | None) -> tuple[float | None, str | None]:
    """'$138,000' -> (138000, 'USD'); '₹ 50,000' -> (50000, 'INR'); '$CAD 5k' -> (5000, 'CAD')."""
    if not text:
        return None, None
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?\b", text)
    if not m:
        return None, None
    amount = float(m.group(1).replace(",", ""))
    if m.group(2):
        amount *= 1_000 if m.group(2).lower() == "k" else 1_000_000
    currency = None
    upper = text.upper()
    for marker, code in CURRENCY_MARKERS:
        if marker.upper() in upper:
            currency = code
            break
    return amount, currency


def to_usd(amount: float | None, currency: str | None) -> float | None:
    if amount is None or not currency or currency not in FX_TO_USD:
        return None
    return round(amount * FX_TO_USD[currency], 2)


def map_themes(themes: list[str]) -> list[str]:
    out: list[str] = []
    for t in themes:
        c = THEME_TO_CATEGORY.get((t or "").strip().lower())
        if c and c not in out:
            out.append(c)
    return [c for c in out if c in CATEGORIES]


def normalize(r: RawListing) -> Normalized:
    r.title = clean_text(r.title, 300) or "Untitled hackathon"
    r.organizer = clean_text(r.organizer, 200)
    r.description = clean_text(r.description, 8000)
    r.prize_text = clean_text(r.prize_text, 300)
    r.location_text = clean_text(r.location_text, 200)
    r.dates_text = clean_text(r.dates_text, 120)
    r.categories = [c for c in r.categories if c in CATEGORIES]
    if r.format not in ("online", "in_person", "hybrid"):
        r.format = None
    url = canonical_url(r.source_url)
    r.source_url = url
    return Normalized(raw=r, source_url=url, title_key=title_key(r.title), content_hash=content_hash(r))
