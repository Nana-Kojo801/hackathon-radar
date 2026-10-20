-- Push notifications to the installed app (Web Push). One row per device
-- that turned notifications on; a subscription the push service reports as
-- gone (404/410) is deleted when a send fails.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint     text PRIMARY KEY,
    p256dh       text NOT NULL,
    auth         text NOT NULL,
    user_agent   text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_sent_at timestamptz
);

-- What to push, and when not to. reminder_days is shared with the email reminders.
ALTER TABLE my_settings
    ADD COLUMN IF NOT EXISTS push_new_matches    boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS push_closing_soon   boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS push_big_prizes     boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS push_digest         boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS big_prize_min       numeric NOT NULL DEFAULT 100000,
    ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS quiet_start         smallint NOT NULL DEFAULT 22 CHECK (quiet_start BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS quiet_end           smallint NOT NULL DEFAULT 8 CHECK (quiet_end BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS timezone            text NOT NULL DEFAULT 'UTC',
    ADD COLUMN IF NOT EXISTS last_push_at        timestamptz,
    ADD COLUMN IF NOT EXISTS last_push_digest_at timestamptz;

-- When the "closing soon" push went out, separate from the email's reminded_at.
ALTER TABLE my_hackathons ADD COLUMN IF NOT EXISTS push_reminded_at timestamptz;
