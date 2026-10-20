-- Merge lists deterministically, preserving item IDs, text, completion and list/item order.
CREATE TEMP TABLE checklist_merge ON COMMIT DROP AS
SELECT id, task_id, first_value(id) OVER (PARTITION BY task_id ORDER BY (data->>'sortOrder')::integer, id) AS keep_id,
       row_number() OVER (PARTITION BY task_id ORDER BY (data->>'sortOrder')::integer, id) AS list_order
FROM checklists;
WITH ordered AS (
 SELECT i.id, m.keep_id, row_number() OVER (PARTITION BY m.task_id ORDER BY m.list_order,(i.data->>'sortOrder')::integer,i.id)-1 AS position
 FROM checklist_items i JOIN checklist_merge m ON m.id=i.checklist_id
)
UPDATE checklist_items i SET checklist_id=o.keep_id,
 data=jsonb_set(jsonb_set(i.data,'{checklistId}',to_jsonb(o.keep_id::text)),'{sortOrder}',to_jsonb(o.position))
FROM ordered o WHERE i.id=o.id;
DELETE FROM checklists c USING checklist_merge m WHERE c.id=m.id AND m.id<>m.keep_id;
UPDATE checklists SET data=jsonb_set(data,'{title}',to_jsonb('Чек-лист'::text));
ALTER TABLE checklists ADD CONSTRAINT one_checklist_per_task UNIQUE(task_id) DEFERRABLE INITIALLY DEFERRED;
UPDATE planner_meta SET revision=revision+1 WHERE id=1;
