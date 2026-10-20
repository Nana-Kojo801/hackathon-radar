import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


DATABASE_URL = os.getenv("DATABASE_URL", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
SEARCH_API_KEY = os.getenv("SEARCH_API_KEY", "")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
# Unlocks the personal /me endpoints (saved hackathons, notes, email settings).
PERSONAL_KEY = os.getenv("PERSONAL_KEY", "") or ADMIN_TOKEN
# Email notifications (app/notify.py), sent with Resend.
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
NOTIFY_EMAIL = os.getenv("NOTIFY_EMAIL", "")
NOTIFY_FROM = os.getenv("NOTIFY_FROM", "") or "Hackathon Radar <onboarding@resend.dev>"
# Push notifications (app/push.py). One base64url private key; the public key
# the browser needs is derived from it. Generate with: python -m app.push --generate-key
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "") or (f"mailto:{NOTIFY_EMAIL}" if NOTIFY_EMAIL else "mailto:hackathon-radar@example.com")
# Where links in emails and notifications point.
APP_URL = (os.getenv("APP_URL", "") or "https://hackathon-radar.nkabenyah.workers.dev").rstrip("/")
# "Refresh now" in Settings starts the GitHub Actions refresh (app/refresh.py): a fine-grained
# token for the repository with Actions read and write.
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "").strip()
GITHUB_REPO = os.getenv("GITHUB_REPO", "") or "nana-kojo801/hackathon-radar"
MAX_ENRICH_PER_RUN = _int("MAX_ENRICH_PER_RUN", 60)
MAX_DISCOVERY_PAGES = _int("MAX_DISCOVERY_PAGES", 12)
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

USER_AGENT = "HackathonRadar/1.0 (personal hackathon aggregator; +https://github.com/nana-kojo801/hackathon-radar)"
