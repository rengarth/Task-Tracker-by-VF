-- Replacement imports can retain an entity ID while changing its parent.
-- Validate relationships at COMMIT, after every affected entity is upserted.
ALTER TABLE checklists ALTER CONSTRAINT checklists_task_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE checklist_items ALTER CONSTRAINT checklist_items_checklist_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE comments ALTER CONSTRAINT comments_task_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE time_entries ALTER CONSTRAINT time_entries_task_id_fkey DEFERRABLE INITIALLY DEFERRED;
