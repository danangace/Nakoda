-- A workspace's work state ("planning", "in review", "done", "dropped"), set by hand.
-- NULL = follow the ticket assigned to the workspace (its board column). Not the same as the live
-- chat status (working / waiting / ...), which is never stored.
ALTER TABLE workspaces ADD COLUMN lifecycle TEXT CHECK (lifecycle IN ('planning', 'in_progress', 'in_review', 'done', 'dropped'));
