-- Some tidied descriptions list prizes as raw fields ("Rank: 1", "Amount Text: $1,000"). Forget
-- their hash so the next refresh tidies them again, with the fix that rewrites such lists.
UPDATE hackathons SET about_hash = NULL, about_attempts = 0
WHERE about_md ~* '(^|\n)\s*(-\s*)?(Rank|Amount Text|Winners):';
