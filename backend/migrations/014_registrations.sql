-- How many people registered, as the platform reports it (Devpost and Unstop do), for "Most
-- popular" on Today. Devpost's full listing is already in raw_payload, so fill those now; Unstop's
-- arrive with the next refresh.
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS registrations integer;
UPDATE hackathons SET registrations = (raw_payload->>'registrations_count')::int
WHERE source = 'devpost' AND jsonb_typeof(raw_payload->'registrations_count') = 'number';
