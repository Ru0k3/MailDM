ALTER TABLE gmail_accounts ADD COLUMN reauth_required INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS summary_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  delivery_kind TEXT NOT NULL CHECK (delivery_kind IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'complete', 'failed')),
  summary_text TEXT,
  error_code TEXT,
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(user_id, local_date, delivery_kind)
);
