import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { type Comment, dt, uid } from "./model";
import { type Mutate } from "./App";
import { Icon } from "./InlineText";

export function CommentsEditor({
  comments,
  taskId,
  zone,
  busy,
  mutate,
  onDirty,
  flushRef,
}: {
  comments: Comment[];
  taskId: string;
  zone: string;
  busy: boolean;
  mutate: Mutate;
  onDirty: (dirty: boolean) => void;
  flushRef: MutableRefObject<() => Promise<boolean>>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [editing, setEditing] = useState<string | null>(null),
    [newText, setNewText] = useState(""),
    [message, setMessage] = useState("");
  const current = useRef({ comments, drafts, newText, mutate, busy });
  current.current = { comments, drafts, newText, mutate, busy };
  const saving = useRef<Promise<boolean> | null>(null);
  const update = (id: string, text: string) => {
    const next = { ...current.current.drafts, [id]: text };
    current.current.drafts = next;
    setDrafts(next);
    setMessage("Есть изменения · автосохранение через 5 секунд");
  };
  async function flush(): Promise<boolean> {
    if (saving.current) return saving.current;
    if (!Object.keys(current.current.drafts).length) return true;
    if (current.current.busy) {
      setMessage("Дождитесь завершения операции и повторите сохранение");
      return false;
    }
    saving.current = (async () => {
      for (const [id, text] of Object.entries(current.current.drafts)) {
        if (!text.trim()) {
          setMessage("Комментарий не может быть пустым");
          return false;
        }
        const original = current.current.comments.find((c) => c.id === id);
        if (!original) {
          setMessage(
            "Комментарий удалён в другой вкладке. Скопируйте текст перед обновлением.",
          );
          return false;
        }
        setMessage("Сохранение…");
        if (
          !(await current.current.mutate("comments/save", {
            ...original,
            text: text.trim(),
          }))
        ) {
          setMessage("Не сохранено. Повторите попытку.");
          return false;
        }
        const next = { ...current.current.drafts };
        if (next[id] === text) delete next[id];
        current.current.drafts = next;
        setDrafts(next);
      }
      setMessage("Сохранено");
      return true;
    })();
    try {
      return await saving.current;
    } finally {
      saving.current = null;
    }
  }
  flushRef.current = async () => {
    if (!(await flush())) return false;
    return (
      !current.current.newText.trim() ||
      window.confirm(
        "Новый комментарий ещё не отправлен. Закрыть без отправки?",
      )
    );
  };
  useEffect(
    () => onDirty(!!newText.trim() || Object.keys(drafts).length > 0),
    [drafts, newText],
  );
  useEffect(() => {
    if (!Object.keys(drafts).length) return;
    const timer = setTimeout(() => void flush(), 5000);
    return () => clearTimeout(timer);
  }, [drafts]);
  return (
    <section className="comments-editor">
      <h3>Комментарии</h3>
      {comments
        .filter((c) => c.taskId === taskId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((c) => (
          <article className="comment" key={c.id}>
            <header className="comment-header">
              <small>
                {dt(c.createdAt, zone).toFormat("dd.MM.yyyy HH:mm")}
                {c.updatedAt !== c.createdAt ? " · изменён" : ""}
              </small>
              <div className="comment-actions">
                <button
                  className="icon-button"
                  title="Редактировать комментарий"
                  aria-label="Редактировать комментарий"
                  disabled={busy}
                  onClick={async () => {
                    if (await flush()) setEditing(c.id);
                  }}
                >
                  <Icon name="edit" />
                </button>
                <button
                  className="icon-button danger"
                  title="Удалить комментарий"
                  aria-label="Удалить комментарий"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm("Удалить комментарий?")) return;
                    if (!(await flush())) return;
                    if (await mutate("comments/delete", { id: c.id })) {
                      if (editing === c.id) setEditing(null);
                      setMessage("Комментарий удалён");
                    }
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    <path d="m5 5 14 14M19 5 5 19" />
                  </svg>
                </button>
              </div>
            </header>
            {editing === c.id ? (
              <>
                <textarea
                  className="comment-input"
                  aria-label="Редактирование комментария"
                  autoFocus
                  disabled={busy}
                  value={drafts[c.id] ?? c.text}
                  onChange={(e) => update(c.id, e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      void flush();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      const next = { ...current.current.drafts };
                      delete next[c.id];
                      current.current.drafts = next;
                      setDrafts(next);
                      setEditing(null);
                      setMessage("Правка отменена");
                    }
                  }}
                />
                <button
                  className="comment-finish"
                  disabled={busy}
                  onClick={async () => {
                    if (await flush()) setEditing(null);
                  }}
                >
                  Готово
                </button>
              </>
            ) : (
              <p>{c.text}</p>
            )}
          </article>
        ))}
      <label>
        Новый комментарий
        <textarea
          className="comment-input"
          rows={3}
          value={newText}
          onChange={(e) => {
            setNewText(e.target.value);
            current.current.newText = e.target.value;
          }}
          disabled={busy}
        />
      </label>
      <button
        disabled={busy || !newText.trim()}
        onClick={async () => {
          if (!(await flush())) return;
          const text = current.current.newText;
          if (await mutate("comments/save", { id: uid(), taskId, text })) {
            setNewText("");
            current.current.newText = "";
            setMessage("Комментарий добавлен");
          }
        }}
      >
        Добавить
      </button>
      <div role="status" className="comment-feedback">
        {message}
        {Object.keys(drafts).length > 0 && !busy && (
          <button onClick={() => void flush()}>Сохранить сейчас</button>
        )}
      </div>
    </section>
  );
}
