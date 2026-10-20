"""Web Push: notifications on the phone (or laptop) where the app is installed.

    python -m app.push --generate-key   # print a new VAPID private key

The server needs one secret, VAPID_PRIVATE_KEY (Render, for the subscribe and
test routes, and GitHub Actions, where app.notify sends the real ones). The
public key the browser subscribes with is derived from it, so the two can't
drift apart.

Routes:
- GET /push/key: the public key, or null when push isn't set up. Public.
- POST /me/push: save this device's subscription.
- DELETE /me/push: forget it (the app calls this when you turn notifications off).
- POST /me/push/test: send a test notification to every device.
"""

import argparse
import base64
import json
import logging
from dataclasses import asdict, dataclass, field
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import config, db
from .personal import require_key

log = logging.getLogger("push")


@dataclass
class Push:
    title: str
    body: str
    # A path in the app, e.g. /h/<id>; the service worker opens it on tap.
    url: str = "/"
    # Notifications with the same tag replace each other instead of piling up.
    tag: str = "radar"
    # Number for the app icon badge (saved hackathons closing this week); None leaves it.
    badge: int | None = None
    extra: dict = field(default_factory=dict)

    def payload(self) -> str:
        d = asdict(self)
        d.update(d.pop("extra"))
        return json.dumps(d)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


@lru_cache(maxsize=4)
def _public_key(private_key: str) -> str:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01

    vapid = Vapid01.from_string(private_key)
    raw = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return _b64(raw)


def public_key() -> str | None:
    if not config.VAPID_PRIVATE_KEY:
        return None
    try:
        return _public_key(config.VAPID_PRIVATE_KEY)
    except Exception:
        log.exception("VAPID_PRIVATE_KEY is not a valid key")
        return None


def generate_key() -> str:
    from py_vapid import Vapid01

    vapid = Vapid01()
    vapid.generate_keys()
    return _b64(vapid.private_key.private_numbers().private_value.to_bytes(32, "big"))


def subscriptions(cur) -> list[dict]:
    cur.execute("SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at")
    return cur.fetchall()


def send_to(subs: list[dict], push: Push, cur=None) -> int:
    """Send one notification to every device. Returns how many accepted it.

    Devices the push service says are gone (404/410) are deleted, using `cur`
    when given. Other failures are logged and left for the next send.
    """
    from pywebpush import WebPushException, webpush

    delivered = 0
    for s in subs:
        info = {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
        try:
            webpush(
                info,
                data=push.payload(),
                vapid_private_key=config.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": config.VAPID_SUBJECT},
                ttl=12 * 3600,
                headers={"Urgency": "normal", "Topic": push.tag[:32]},
                timeout=15,
            )
            delivered += 1
            if cur is not None:
                cur.execute("UPDATE push_subscriptions SET last_sent_at = now() WHERE endpoint = %s", (s["endpoint"],))
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410) and cur is not None:
                log.info("push: subscription gone (%s), removing", status)
                cur.execute("DELETE FROM push_subscriptions WHERE endpoint = %s", (s["endpoint"],))
            else:
                log.warning("push: send failed (%s): %s", status, str(e)[:200])
        except Exception as e:  # network trouble: try again next run
            log.warning("push: send failed: %s", str(e)[:200])
    return delivered


# ---------------------------------------------------------------- routes

public_router = APIRouter()
router = APIRouter(prefix="/me/push", dependencies=[Depends(require_key)])


@public_router.get("/push/key")
def get_key() -> dict:
    return {"key": public_key()}


class Keys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=10, max_length=100)


class Subscription(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000, pattern=r"^https://")
    keys: Keys
    user_agent: str = Field(default="", max_length=300)


class Unsubscribe(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)


@router.post("")
def subscribe(body: Subscription) -> dict:
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent) VALUES (%s, %s, %s, %s)
            ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
                user_agent = EXCLUDED.user_agent
            """,
            (body.endpoint, body.keys.p256dh, body.keys.auth, body.user_agent),
        )
        cur.execute("SELECT count(*)::int AS n FROM push_subscriptions")
        return {"ok": True, "devices": cur.fetchone()["n"]}


@router.delete("")
def unsubscribe(body: Unsubscribe) -> dict:
    with db.cursor() as cur:
        cur.execute("DELETE FROM push_subscriptions WHERE endpoint = %s", (body.endpoint,))
        cur.execute("SELECT count(*)::int AS n FROM push_subscriptions")
        return {"ok": True, "devices": cur.fetchone()["n"]}


@router.post("/test")
def test_push() -> dict:
    if not public_key():
        raise HTTPException(503, "push isn't set up: add VAPID_PRIVATE_KEY on the server")
    with db.cursor() as cur:
        subs = subscriptions(cur)
        if not subs:
            raise HTTPException(409, "no device has notifications turned on")
        n = send_to(subs, Push("It works", "Hackathon Radar can reach this device.", url="/settings/notifications", tag="test"), cur)
    if not n:
        raise HTTPException(502, "the push service didn't accept the notification")
    return {"ok": True, "delivered": n}


def main() -> None:
    ap = argparse.ArgumentParser(description="Web Push helpers")
    ap.add_argument("--generate-key", action="store_true", help="print a new VAPID private key")
    args = ap.parse_args()
    if args.generate_key:
        key = generate_key()
        print(f"VAPID_PRIVATE_KEY={key}")
        print(f"(public key: {_public_key(key)})")
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
