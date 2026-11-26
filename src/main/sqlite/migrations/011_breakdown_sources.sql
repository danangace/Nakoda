-- Which spec document a ticket was broken down from (one document per parent ticket), and how many
-- subtasks that produced. Local memory only; nothing is written to Helix or to the document.
CREATE TABLE breakdown_sources (
  connector_id  TEXT NOT NULL,
  ticket_key    TEXT NOT NULL,
  doc_path      TEXT NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (connector_id, ticket_key)
);
