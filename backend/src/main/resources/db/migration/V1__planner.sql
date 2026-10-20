CREATE TABLE planner_meta (id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL DEFAULT 0, timer jsonb NOT NULL DEFAULT '{"state":"STOPPED"}');
INSERT INTO planner_meta(id) VALUES (1);
CREATE TABLE tasks (
 id uuid PRIMARY KEY, parent_id uuid REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
 start_at timestamptz, end_at timestamptz, status text NOT NULL,
 data jsonb NOT NULL,
 CHECK ((start_at IS NULL AND end_at IS NULL) OR (start_at IS NOT NULL AND end_at > start_at)),
 CHECK (status IN ('PLANNED','IN_PROGRESS','DONE','CANCELED')),
 CHECK (length(trim(data->>'title')) > 0)
);
CREATE INDEX tasks_start_idx ON tasks(start_at);
CREATE INDEX tasks_end_idx ON tasks(end_at);
CREATE INDEX tasks_parent_idx ON tasks(parent_id);
CREATE INDEX tasks_status_idx ON tasks(status);
CREATE TABLE recurrences (id uuid PRIMARY KEY, template_id uuid NOT NULL REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED, data jsonb NOT NULL);
CREATE TABLE checklists (id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), data jsonb NOT NULL);
CREATE INDEX checklists_task_idx ON checklists(task_id);
CREATE TABLE checklist_items (id uuid PRIMARY KEY, checklist_id uuid NOT NULL REFERENCES checklists(id), data jsonb NOT NULL);
CREATE TABLE comments (id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), data jsonb NOT NULL);
CREATE INDEX comments_task_idx ON comments(task_id);
CREATE TABLE time_entries (id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), data jsonb NOT NULL, CHECK ((data->>'seconds')::bigint > 0));
CREATE INDEX time_entries_task_idx ON time_entries(task_id);
