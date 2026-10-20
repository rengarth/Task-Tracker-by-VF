import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { type State, type Item, uid } from "./model";
import { type Mutate } from "./App";
import { Icon } from "./InlineText";

export function ChecklistEditor({
  state,
  taskId,
  busy,
  mutate,
  onDirty,
  flushRef,
}: {
  state: State;
  taskId: string;
  busy: boolean;
  mutate: Mutate;
  onDirty: (v: boolean) => void;
  flushRef: MutableRefObject<() => Promise<boolean>>;
}) {
  const list = state.checklists.find((c) => c.taskId === taskId);
  const items = state.items
    .filter((i) => i.checklistId === list?.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [newText, setNewText] = useState(""),
    [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState<Item[]>([]),
    [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const dragging = useRef<string | null>(null),
    input = useRef<HTMLInputElement>(null),
    saving = useRef<Promise<boolean> | null>(null);
  const current = useRef({ drafts, items, newText, busy, mutate });
  current.current = { drafts, items, newText, busy, mutate };
  const edit = (id: string, text: string) => {
    const next = { ...current.current.drafts, [id]: text };
    current.current.drafts = next;
    setDrafts(next);
    setNotice("Есть изменения");
  };
  async function flush(): Promise<boolean> {
    if (saving.current) return saving.current;
    const changes = Object.entries(current.current.drafts);
    if (!changes.length) return true;
    if (current.current.busy) {
      setNotice("Дождитесь завершения операции и повторите сохранение");
      return false;
    }
    saving.current = (async () => {
      for (const [id, text] of changes) {
        const item = current.current.items.find((i) => i.id === id);
        if (!item) {
          setNotice(
            "Пункт изменён или удалён в другой вкладке. Обновите карточку.",
          );
          return false;
        }
        if (!text.trim()) {
          setNotice("Текст пункта не может быть пустым");
          return false;
        }
        setNotice("Сохранение…");
        if (
          !(await current.current.mutate("checklist-items/save", {
            ...item,
            text: text.trim(),
          }))
        ) {
          setNotice("Не сохранено. Повторите попытку.");
          return false;
        }
        const next = { ...current.current.drafts };
        if (next[id] === text) delete next[id];
        current.current.drafts = next;
        setDrafts(next);
      }
      setNotice("Сохранено");
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
      window.confirm("Новый пункт ещё не добавлен. Закрыть без него?")
    );
  };
  useEffect(() => {
    onDirty(Object.keys(drafts).length > 0 || !!newText.trim());
  }, [drafts, newText]);
  useEffect(() => {
    if (!Object.keys(drafts).length) return;
    const timer = setTimeout(() => void flush(), 5000);
    return () => clearTimeout(timer);
  }, [drafts]);
  async function action(path: string, data: unknown) {
    if (!(await flush())) return false;
    return current.current.mutate(path, data);
  }
  async function add() {
    const text = current.current.newText.trim();
    if (!list || !text || busy) return;
    if (
      await action("checklist-items/save", {
        id: uid(),
        checklistId: list.id,
        text,
        done: false,
        sortOrder: Math.max(0, ...items.map((i) => i.sortOrder)) + 1,
      })
    ) {
      setNewText("");
      current.current.newText = "";
      setNotice("Пункт добавлен");
      requestAnimationFrame(() => input.current?.focus());
    }
  }
  async function reorder(source: string, target: string, after: boolean) {
    if (!list || source === target) return;
    const ids = items.map((i) => i.id).filter((id) => id !== source);
    const at = ids.indexOf(target);
    if (at < 0) return;
    ids.splice(at + (after ? 1 : 0), 0, source);
    if (await action("checklist-items/reorder", { checklistId: list.id, ids }))
      setNotice("Порядок сохранён");
  }
  return (
    <section className="checklist-editor">
      <h3>Чек-лист</h3>
      {!list ? (
        <button
          disabled={busy}
          onClick={() =>
            void mutate("checklists/save", {
              id: uid(),
              taskId,
              title: "Чек-лист",
              sortOrder: 0,
            })
          }
        >
          ＋ Добавить чек-лист
        </button>
      ) : (
        <>
          <div className="check-progress">
            <progress
              value={items.filter((i) => i.done).length}
              max={Math.max(1, items.length)}
            />
            <small>
              {items.filter((i) => i.done).length} / {items.length}
            </small>
          </div>
          <p className="muted">
            Enter — сохранить · Escape — отменить правку · ⋮⋮ — изменить порядок
          </p>
          {items.map((item, index) => (
            <div
              key={item.id}
              className={`check-row ${item.done ? "is-done" : ""} ${drop?.id === item.id ? (drop.after ? "drop-after" : "drop-before") : ""}`}
              onDragOver={(e) => {
                if (!dragging.current) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDrop({
                  id: item.id,
                  after: e.clientY > r.top + r.height / 2,
                });
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragging.current;
                if (id) void reorder(id, item.id, drop?.after ?? false);
                setDrop(null);
                dragging.current = null;
              }}
            >
              <button
                className="grip"
                aria-label={`Переместить: ${item.text}`}
                title="Перетащите; с клавиатуры Alt+↑ / Alt+↓"
                draggable={!busy}
                disabled={busy}
                onDragStart={(e) => {
                  dragging.current = item.id;
                  e.dataTransfer.setData("text/plain", item.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragging.current = null;
                  setDrop(null);
                }}
                onKeyDown={(e) => {
                  if (
                    e.altKey &&
                    (e.key === "ArrowUp" || e.key === "ArrowDown")
                  ) {
                    e.preventDefault();
                    const other = items[index + (e.key === "ArrowUp" ? -1 : 1)];
                    if (other)
                      void reorder(item.id, other.id, e.key === "ArrowDown");
                  }
                }}
              >
                ⋮⋮
              </button>
              <input
                type="checkbox"
                aria-label={`Выполнен: ${item.text}`}
                checked={item.done}
                disabled={busy}
                onChange={(e) =>
                  void action("checklist-items/save", {
                    ...item,
                    text: current.current.drafts[item.id]?.trim() || item.text,
                    done: e.target.checked,
                  })
                }
              />
              <input
                className="check-text"
                aria-label={`Пункт ${index + 1}`}
                value={drafts[item.id] ?? item.text}
                disabled={busy}
                onChange={(e) => edit(item.id, e.target.value)}
                onBlur={() => void flush()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void flush();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    const next = { ...current.current.drafts };
                    delete next[item.id];
                    current.current.drafts = next;
                    setDrafts(next);
                    setNotice("Правка отменена");
                  }
                }}
              />
              <button
                className="icon-button danger"
                aria-label={`Удалить пункт: ${item.text}`}
                title="Удалить пункт"
                disabled={busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={async () => {
                  const text = current.current.drafts[item.id] ?? item.text;
                  if (await action("checklist-items/delete", { id: item.id })) {
                    setRemoved((r) => [...r, { ...item, text }]);
                    setNotice("Пункт удалён");
                  }
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
          <div className="check-add">
            <input
              ref={input}
              aria-label="Новый пункт"
              placeholder="Новый пункт…"
              value={newText}
              disabled={busy}
              onChange={(e) => {
                setNewText(e.target.value);
                current.current.newText = e.target.value;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setNewText("");
                  current.current.newText = "";
                }
              }}
            />
            <button
              disabled={busy || !newText.trim()}
              onClick={() => void add()}
            >
              Добавить
            </button>
          </div>
        </>
      )}
      <div className="check-feedback" role="status">
        {notice}
        {Object.keys(drafts).length > 0 && (
          <button disabled={busy} onClick={() => void flush()}>
            Повторить сохранение
          </button>
        )}
        {removed.length > 0 && (
          <button
            disabled={busy}
            onClick={async () => {
              const item = removed.at(-1)!;
              if (await action("checklist-items/save", item)) {
                setRemoved((r) => r.slice(0, -1));
                setNotice("Пункт восстановлен");
              }
            }}
          >
            Отменить удаление{removed.length > 1 ? ` (${removed.length})` : ""}
          </button>
        )}
      </div>
    </section>
  );
}
