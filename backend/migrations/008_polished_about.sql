-- AI-tidied copy of each listing's description (Markdown) and, when the
-- platform gave no breakdown, the prizes the AI found in the text. Filled by
-- the pipeline's polish step; about_hash is the description it was made from,
-- so it's redone only when the description changes.
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS about_md text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS about_prizes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS about_hash text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS about_attempts int NOT NULL DEFAULT 0;
