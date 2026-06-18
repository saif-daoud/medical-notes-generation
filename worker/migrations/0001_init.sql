CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  institution TEXT NOT NULL,
  latest_degree TEXT NOT NULL,
  years_experience INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  participant_uid TEXT NOT NULL,
  participant_email TEXT NOT NULL,
  comparison_id TEXT NOT NULL,
  sequence_index INTEGER NOT NULL,
  left_output_id TEXT NOT NULL,
  right_output_id TEXT NOT NULL,
  winner_choice TEXT NOT NULL CHECK (winner_choice IN ('left','right','tie')),
  selected_output_id TEXT,
  note TEXT,
  timestamp_utc TEXT NOT NULL,
  user_agent TEXT,
  page_url TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(participant_uid, comparison_id)
);

CREATE INDEX IF NOT EXISTS idx_responses_participant ON responses(participant_uid);
CREATE INDEX IF NOT EXISTS idx_responses_comparison ON responses(comparison_id);
CREATE INDEX IF NOT EXISTS idx_responses_selected_output ON responses(selected_output_id);
