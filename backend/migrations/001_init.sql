CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS hackathons (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source                text NOT NULL,
    source_url            text NOT NULL UNIQUE,
    alt_urls              text[] NOT NULL DEFAULT '{}',
    title                 text NOT NULL,
    title_key             text NOT NULL,
    organizer             text,
    description_raw       text,
    image_url             text,

    prize_text            text,
    prize_usd             numeric,
    prize_confidence      text,
    prize_notes           text,

    summary               text,
    format                text NOT NULL DEFAULT 'unknown',
    location_text         text,
    categories            text[] NOT NULL DEFAULT '{}',
    international_ok      boolean,
    student_only          boolean,

    start_date            timestamptz,
    end_date              timestamptz,
    registration_deadline timestamptz,
    dates_text            text,
    status                text NOT NULL DEFAULT 'upcoming',

    relevance_score       int,
    is_hidden             boolean NOT NULL DEFAULT false,

    content_hash          text NOT NULL,
    enriched_hash         text,
    enriched_at           timestamptz,
    enrichment_model      text,
    enrich_attempts       int NOT NULL DEFAULT 0,

    hints                 jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw_payload           jsonb,

    first_seen_at         timestamptz NOT NULL DEFAULT now(),
    last_seen_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hackathons_prize_idx      ON hackathons (prize_usd DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS hackathons_deadline_idx   ON hackathons (registration_deadline);
CREATE INDEX IF NOT EXISTS hackathons_status_idx     ON hackathons (status);
CREATE INDEX IF NOT EXISTS hackathons_categories_idx ON hackathons USING GIN (categories);
CREATE INDEX IF NOT EXISTS hackathons_title_key_idx  ON hackathons (title_key);
CREATE INDEX IF NOT EXISTS hackathons_alt_urls_idx   ON hackathons USING GIN (alt_urls);

CREATE TABLE IF NOT EXISTS source_runs (
    id          bigserial PRIMARY KEY,
    source      text NOT NULL,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    fetched     int NOT NULL DEFAULT 0,
    new         int NOT NULL DEFAULT 0,
    errors      int NOT NULL DEFAULT 0,
    error_text  text,
    tokens_used int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS source_runs_source_idx ON source_runs (source, started_at DESC);

-- Web discovery: remember which result pages were already sent to the AI
-- so an unchanged page is never extracted twice.
CREATE TABLE IF NOT EXISTS discovered_pages (
    url          text PRIMARY KEY,
    content_hash text NOT NULL,
    found        int NOT NULL DEFAULT 0,
    extracted_at timestamptz NOT NULL DEFAULT now()
);
