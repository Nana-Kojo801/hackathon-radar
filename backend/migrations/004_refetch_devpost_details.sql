-- Devpost descriptions used to include the page sidebar (deadline, calendar
-- links, participant counts). Refetch them with the description-only parser.
-- Only the details step runs again; AI enrichment is keyed on content_hash and
-- is not repeated.
UPDATE hackathons SET details_fetched_at = NULL WHERE source = 'devpost';
