-- Activity log for the stats page: app opens (and where they came from),
-- hackathons opened, and stage changes. One row per event; small.
CREATE TABLE IF NOT EXISTS my_events (
    id           bigserial PRIMARY KEY,
    kind         text NOT NULL CHECK (kind IN ('open', 'view', 'stage')),
    hackathon_id uuid REFERENCES hackathons(id) ON DELETE CASCADE,
    -- open: email / push / home_screen / browser. stage: the new stage, or 'removed'.
    detail       text,
    at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS my_events_kind_at ON my_events (kind, at);

-- Stage history from before the log existed: when each hackathon was first
-- tracked, and its current stage when that's later than the first.
INSERT INTO my_events (kind, hackathon_id, detail, at)
SELECT 'stage', hackathon_id, CASE WHEN status = 'hidden' THEN 'hidden' ELSE 'saved' END, created_at
FROM my_hackathons
WHERE status IS NOT NULL;

INSERT INTO my_events (kind, hackathon_id, detail, at)
SELECT 'stage', hackathon_id, status, updated_at
FROM my_hackathons
WHERE status NOT IN ('saved', 'hidden') AND updated_at > created_at;
