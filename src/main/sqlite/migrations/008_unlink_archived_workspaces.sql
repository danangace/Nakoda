-- A ticket kept pointing at a workspace after it was archived, so it looked assigned and could not be assigned again.
UPDATE tasks SET workspace_id = NULL WHERE workspace_id IN (SELECT id FROM workspaces WHERE archived_at IS NOT NULL);
