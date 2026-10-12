-- Personal tracking: the app is used by one person, so there are no users.
-- Everything here is reached only through the key-protected /me endpoints.

-- One row per hackathon you've touched: its stage, your note, or both.
-- status NULL means "just a note"; 'hidden' means "not interested".
CREATE TABLE IF NOT EXISTS my_hackathons (
    hackathon_id uuid PRIMARY KEY REFERENCES hackathons(id) ON DELETE CASCADE,
    status       text CHECK (status IN ('saved', 'registered', 'submitted', 'won', 'not_placed', 'hidden')),
    note         text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    -- When the "closing soon" email went out for this hackathon.
    reminded_at  timestamptz
);

-- A single row of settings for the email alerts, reminders and digest.
CREATE TABLE IF NOT EXISTS my_settings (
    id                       smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    alerts_enabled           boolean NOT NULL DEFAULT true,
    alert_min_prize          numeric NOT NULL DEFAULT 5000,
    alert_categories         text[] NOT NULL DEFAULT '{}',
    alert_formats            text[] NOT NULL DEFAULT '{}',
    alert_international_only boolean NOT NULL DEFAULT false,
    alert_skip_student_only  boolean NOT NULL DEFAULT false,
    reminders_enabled        boolean NOT NULL DEFAULT true,
    reminder_days            int NOT NULL DEFAULT 2 CHECK (reminder_days BETWEEN 1 AND 14),
    digest_enabled           boolean NOT NULL DEFAULT true,
    last_alert_at            timestamptz,
    last_digest_at           timestamptz,
    updated_at               timestamptz NOT NULL DEFAULT now()
);
INSERT INTO my_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
