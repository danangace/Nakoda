-- v1.3: "Handling expectation" now says where a fix starts from: defect development, defect staging or hotfix.
-- Only the seeded options are replaced; a workflow the user already edited is left alone.
UPDATE workflows
SET fields_json = REPLACE(
      REPLACE(fields_json, '"options": ["hotfix", "next-iteration", "others"]', '"options": ["defect development", "defect staging", "hotfix"]'),
      '"help": "How fast QA or the business needs it; not the same as severity"',
      '"help": "Where the fix starts from: development (origin/dev/tribe-2), staging (main) or a hotfix from the latest release tag"')
WHERE id = 'defect';

-- Old choices no longer exist; clear them so the ticket asks for the new one.
UPDATE tasks SET values_json = json_set(values_json, '$.handling', '') WHERE json_extract(values_json, '$.handling') IN ('next-iteration', 'others');
UPDATE workspaces SET values_json = json_set(values_json, '$.handling', '') WHERE json_extract(values_json, '$.handling') IN ('next-iteration', 'others');
