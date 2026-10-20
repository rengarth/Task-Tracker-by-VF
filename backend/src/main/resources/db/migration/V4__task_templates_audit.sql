CREATE TABLE task_templates (id uuid PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE task_audit (id uuid PRIMARY KEY, task_id uuid NOT NULL, created_at timestamptz NOT NULL, data jsonb NOT NULL);
CREATE INDEX task_audit_task_time_idx ON task_audit(task_id, created_at DESC);

INSERT INTO task_templates(id, data) VALUES
('5fd3130c-915d-4e9c-a4c0-563459a47f05', '{"id":"5fd3130c-915d-4e9c-a4c0-563459a47f05","name":"Монтаж рилса","title":"Монтаж рилса","description":"","assignee":"Я","priority":"NORMAL","checklistItems":["Собрать исходные материалы","Отобрать фрагменты","Смонтировать ролик","Добавить субтитры и звук","Проверить и экспортировать"]}'::jsonb),
('94a3991e-70aa-4ab6-83f6-f156f858dd1e', '{"id":"94a3991e-70aa-4ab6-83f6-f156f858dd1e","name":"Монтаж подкаста","title":"Монтаж подкаста","description":"","assignee":"Я","priority":"NORMAL","checklistItems":["Подготовить исходные записи","Очистить звук и выровнять громкость","Вырезать паузы и ошибки","Добавить заставку и финал","Прослушать и экспортировать"]}'::jsonb);
