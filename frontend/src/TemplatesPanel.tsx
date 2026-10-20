import { useEffect, useState } from "react";
import { Mutate } from "./App";
import { priorities, TaskTemplate, uid } from "./model";

function empty(): TaskTemplate {
  return { id: uid(), name: "", title: "", description: "", assignee: "Я", priority: "NORMAL", checklistItems: [] };
}

export function TemplatesPanel({ templates, busy, mutate, close }: {
  templates: TaskTemplate[];
  busy: boolean;
  mutate: Mutate;
  close: () => void;
}) {
  const [draft, setDraft] = useState<TaskTemplate>(empty);
  const [items, setItems] = useState("");
  const [message, setMessage] = useState("");
  const select = (template?: TaskTemplate) => {
    const next = template ? { ...template } : empty();
    setDraft(next);
    setItems(next.checklistItems.join("\n"));
    setMessage("");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  const update = (field: keyof TaskTemplate, value: string) => setDraft((old) => ({ ...old, [field]: value }));
  const save = async () => {
    const next = { ...draft, name: draft.name.trim(), title: draft.title.trim(), assignee: draft.assignee.trim(), checklistItems: items.split("\n").map((x) => x.trim()).filter(Boolean) };
    if (!next.name || !next.title || !next.assignee) {
      setMessage("Заполните название шаблона, название задачи и исполнителя.");
      return;
    }
    if (await mutate("templates/save", next)) {
      setDraft(next);
      setItems(next.checklistItems.join("\n"));
      setMessage("Шаблон сохранён");
    } else setMessage("Не удалось сохранить шаблон");
  };
  const remove = async () => {
    if (!templates.some((t) => t.id === draft.id)) return;
    if (!window.confirm(`Удалить шаблон «${draft.name}»? Уже созданные задачи останутся без изменений.`)) return;
    if (await mutate("templates/delete", { id: draft.id })) select();
  };
  return (
    <div className="overlay templates-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className="dialog templates-dialog" role="dialog" aria-modal="true" aria-labelledby="templates-title">
        <header className="templates-heading"><div><div className="eyebrow">ПОВТОРЯЕМЫЕ ЗАДАЧИ</div><h2 id="templates-title">Шаблоны задач</h2></div><button onClick={close} aria-label="Закрыть шаблоны">Закрыть</button></header>
        <div className="templates-layout">
          <nav className="templates-list" aria-label="Список шаблонов">
            <button className={!templates.some((t) => t.id === draft.id) ? "selected" : ""} onClick={() => select()}>＋ Новый шаблон</button>
            {templates.map((t) => <button key={t.id} className={draft.id === t.id ? "selected" : ""} onClick={() => select(t)}>{t.name}</button>)}
          </nav>
          <div className="templates-fields">
            <label>Название шаблона<input maxLength={100} value={draft.name} onChange={(e) => update("name", e.target.value)} placeholder="Например, монтаж рилса" /></label>
            <label>Название создаваемой задачи<input maxLength={500} value={draft.title} onChange={(e) => update("title", e.target.value)} /></label>
            <div className="form-grid"><label>Исполнитель<input value={draft.assignee} onChange={(e) => update("assignee", e.target.value)} /></label><label>Приоритет<select value={draft.priority} onChange={(e) => update("priority", e.target.value)}>{Object.entries(priorities).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
            <label>Описание<textarea rows={4} value={draft.description} onChange={(e) => update("description", e.target.value)} /></label>
            <label>Чек-лист · один пункт на строку<textarea rows={6} value={items} onChange={(e) => setItems(e.target.value)} placeholder={"Подготовить материалы\nСмонтировать\nПроверить"} /></label>
            <p className="muted">При создании задачи копируются эти поля и пункты чек-листа. Даты, статус, комментарии и фактическое время начинаются заново.</p>
            {message && <p role="status">{message}</p>}
            <footer><button className="primary" disabled={busy} onClick={() => void save()}>Сохранить шаблон</button><button className="danger" disabled={busy || !templates.some((t) => t.id === draft.id)} onClick={() => void remove()}>Удалить</button></footer>
          </div>
        </div>
      </section>
    </div>
  );
}
