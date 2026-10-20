-- Live progress of a pipeline run, for "Refresh now" in Settings: the step it's
-- on, and each finished step's numbers (written on the 'pipeline' row).
ALTER TABLE source_runs ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE source_runs ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}'::jsonb;
