-- YT Engagement Verdict — Neon/Postgres Schema
-- Table: video_verdicts
-- Created: 2026-08-09
-- Used by: v2.0 crowdsourced verdict backend (Cloudflare Workers + Neon)

CREATE TABLE video_verdicts (
    video_id       TEXT PRIMARY KEY,       -- YouTube video ID (from URL ?v= parameter)
    views          INTEGER,                -- view count at time of last report
    like_rate      FLOAT,                  -- likes / views
    comment_rate   FLOAT,                  -- comments / views
    sentiment      FLOAT,                  -- likes / (likes + dislikes), null if RYD unavailable
    verdict        TEXT,                   -- "botted", "garbage", "solid", "fire"
    score          INTEGER,               -- composite score (0–6)
    max_score      INTEGER,               -- max possible score (4 without RYD, 6 with)
    report_count   INTEGER DEFAULT 1,     -- number of installs that have reported this video
    last_seen      TIMESTAMP DEFAULT NOW() -- timestamp of most recent report
);

-- Notes:
-- Primary key index on video_id is auto-created by Postgres (BTREE)
-- Main operations:
--   INSERT ... ON CONFLICT (video_id) DO UPDATE  (upsert on new report)
--   SELECT * FROM video_verdicts WHERE video_id = $1  (fetch community data)
-- Future v2.0 additions:
--   - Standard deviation columns per signal (once enough data accumulated)
--   - Separate raw_reports table for per-report data vs aggregates
--   - channels table for channel-level aggregate scoring
