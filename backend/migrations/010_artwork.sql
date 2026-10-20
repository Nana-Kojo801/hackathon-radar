-- Covers for listings that come without one (artwork step, pipeline/artwork.py):
-- the share image of the hackathon's own page, and the organizer's logo.
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS page_image_url text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS artwork_checked_at timestamptz;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS artwork_attempts int NOT NULL DEFAULT 0;

-- Organizer name -> official website, as the AI knows it (null: it didn't).
CREATE TABLE IF NOT EXISTS organizer_sites (
    name       text PRIMARY KEY,
    domain     text,
    checked_at timestamptz NOT NULL DEFAULT now()
);
