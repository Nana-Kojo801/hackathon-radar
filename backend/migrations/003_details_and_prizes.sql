-- Long descriptions and per-prize breakdowns live in their own columns, filled by
-- the pipeline's detail step, so the short listing text can never overwrite them.
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS description_detail text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS prizes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS details_fetched_at timestamptz;
