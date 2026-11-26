-- What Nakoda changed in Helix, and the answer. Never holds a token; a comment or a ticket title is kept as sent.
CREATE TABLE helix_writes (
  id            TEXT PRIMARY KEY,
  connector_id  TEXT NOT NULL,
  at            TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('status', 'comment', 'subtask')),
  ticket_key    TEXT NOT NULL,
  summary       TEXT NOT NULL,
  ok            INTEGER NOT NULL,
  error_code    TEXT
);
CREATE INDEX helix_writes_at ON helix_writes (at);
