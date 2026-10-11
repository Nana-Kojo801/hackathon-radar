-- HackerEarth was added as a source and removed the same day: its API answers
-- 403 to GitHub Actions runners. Clear its run history (or the list page would
-- keep warning that it failed) and anything it stored.
DELETE FROM source_runs WHERE source = 'hackerearth';
DELETE FROM hackathons WHERE source = 'hackerearth';
