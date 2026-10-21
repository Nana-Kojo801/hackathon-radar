-- Hackathons you added yourself (app/add.py). Stored as web finds, but shown before the AI has
-- vetted them (you already confirmed them), never dropped by it, and never sent to you as alerts.
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS added_by_user boolean NOT NULL DEFAULT false;
