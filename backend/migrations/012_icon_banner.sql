-- Two kinds of artwork per listing: a square icon (the platform's logo or
-- thumbnail) and a wide banner (the platform's cover, or the header photo on
-- its page). page_image_url / logo_url from the artwork step fill in when the
-- platform gives neither.
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS icon_url text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS banner_url text;

-- The artwork step now also looks for banners for listings that have an image
-- (often a square logo), so let it take another look at those it skipped.
UPDATE hackathons SET artwork_checked_at = NULL, artwork_attempts = 0
WHERE page_image_url IS NULL AND status IN ('open', 'upcoming');
