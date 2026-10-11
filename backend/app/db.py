import logging
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import config

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

_pool: ConnectionPool | None = None


def connect() -> psycopg.Connection:
    """A standalone connection (used by the pipeline)."""
    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg.connect(config.DATABASE_URL, row_factory=dict_row)


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        if not config.DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not set")
        # Neon's free tier suspends idle computes, so check connections before use.
        _pool = ConnectionPool(
            config.DATABASE_URL,
            min_size=0,
            max_size=5,
            kwargs={"row_factory": dict_row},
            check=ConnectionPool.check_connection,
            open=True,
        )
    return _pool


@contextmanager
def cursor():
    with pool().connection() as conn:
        with conn.cursor() as cur:
            yield cur


def migrate(conn: psycopg.Connection | None = None) -> list[str]:
    """Apply any migrations/*.sql files that haven't run yet, in name order."""
    own = conn is None
    conn = conn or connect()
    applied: list[str] = []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            cur.execute("SELECT name FROM schema_migrations")
            done = {r["name"] for r in cur.fetchall()}
            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if path.name in done:
                    continue
                log.info("applying migration %s", path.name)
                cur.execute(path.read_text())
                cur.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
                applied.append(path.name)
        conn.commit()
    finally:
        if own:
            conn.close()
    return applied


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("applied:", migrate() or "nothing new")
