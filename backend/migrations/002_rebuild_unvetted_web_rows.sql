-- One-off: rows from the first web-discovery run were stored before web finds
-- could dedupe against each other. None had been AI-vetted yet, so drop them;
-- the next run re-emits them from the discovered_pages cache (no new
-- extraction calls) and the improved dedupe merges duplicates.
DELETE FROM hackathons WHERE source = 'web' AND enriched_at IS NULL;
