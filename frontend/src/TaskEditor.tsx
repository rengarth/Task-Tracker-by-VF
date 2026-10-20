import { CommentsEditor } from "./CommentsEditor";
import { useWindowDrag } from "./useWindowDrag";
import { ChecklistEditor } from "./ChecklistEditor";
import { DateInput, DeferredDateInput } from "./DateInput";
import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  State,
  Task,
  Entry,
  Series,
  statuses,
  priorities,
  dt,
  iso,
  overdue,
  fresh,
  descendants,
  hours,
  humanDuration,
  uid,
} from "./model";
import { Mutate } from "./App";
interface Props {
  active: boolean;
  layer: number;
  activate: () => void;
  task: Task;
  state: State;
  zone: string;
  now: number;
  busy: boolean;
  mutate: Mutate;
  open: (t: Task) => void;
  close: () => void;
  removed: (id: string) => void;
}
export function TaskEditor({
  task,
  active,
  layer,
  activate,
  state,
  zone,
  now,
  busy,
  mutate,
  open,
  close,
  removed,
}: Props) {
  const floating = useWindowDrag(layer);
  const [commentsDirty, setCommentsDirty] = useState(false);
  const flushComments = useRef<() => Promise<boolean>>(async () => true);
  const [checkDirty, setCheckDirty] = useState(false);
  const flushChecks = useRef<() => Promise<boolean>>(async () => true);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const failed = useRef("");
  const delay = useRef(5000);
  const latest = useRef({
    save: async () => true,
    exit: () => {},
    draft: task,
  });
  const [draft, setDraft] = useState(task),
    [baseline, setBaseline] = useState(JSON.stringify(task)),
    [selectedTemplateId, setSelectedTemplateId] = useState(""),
    [templateName, setTemplateName] = useState(""),
    [scope, setScope] = useState("ONE"),
    [message, setMessage] = useState("");
  const [entry, setEntry] = useState<Entry | null>(null),
    [minutes, setMinutes] = useState("30");
  const [series, setSeries] = useState<Series>(
    state.series.find((r) => r.id === task.seriesId) || {
      id: uid(),
      templateId: task.id,
      frequency: "DAILY",
      zone,
      weekdays: [1, 2, 3, 4, 5],
      count: 10,
      until: null,
    },
  );
  const form = useRef<HTMLFormElement>(null),
    live = useRef({ dirty: false, busy: false });
  const initialSeries = useRef(JSON.stringify(series));
  const exists = state.tasks.some((t) => t.id === draft.id),
    dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => {
    const saved = state.tasks.find((t) => t.id === task.id);
    if (!saved) return;
    const previous = JSON.parse(baseline) as Task;
    // Keep locally edited fields, but accept server changes such as parent expansion.
    setDraft((local) => Object.fromEntries(Object.entries(saved).map(([key, value]) =>
      [key, JSON.stringify(local[key as keyof Task]) === JSON.stringify(previous[key as keyof Task])
        ? value : local[key as keyof Task]])) as unknown as Task);
    setBaseline(JSON.stringify(saved));
  }, [state.revision]);
  const unsaved =
    dirty ||
    checkDirty ||
    commentsDirty ||
    entry !== null ||
    JSON.stringify(series) !== initialSeries.current;
  live.current = { dirty: unsaved, busy };
  const set = (key: keyof Task, value: unknown) => {
    delay.current = ["title", "description", "assignee"].includes(key)
      ? 5000
      : 0;
    failed.current = "";
    setDraft((d) => ({ ...d, [key]: value }));
  };
  async function exit() {
    if (busy) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && form.current?.contains(focused) && focused.dataset.commitOnBlur === "true") {
      focused.blur();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (
      !(await latest.current.save()) ||
      !(await flushChecks.current()) ||
      !(await flushComments.current())
    )
      return;
    if (
      (entry || JSON.stringify(series) !== initialSeries.current) &&
      !window.confirm(
        "Закрыть без отправки комментария / сохранения дополнительных полей?",
      )
    )
      return;
    close();
  }
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (live.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const key = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (!live.current.busy) latest.current.exit();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        form.current?.requestSubmit();
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("keydown", key);
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const outside = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest(".task-dialog")) return;
      latest.current.exit();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [active]);
  useEffect(() => {
    const element = form.current?.closest(".dialog");
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !element) return;
      const controls = Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      ).filter((e) => e.offsetParent !== null);
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    element?.addEventListener("keydown", trap as EventListener);
    return () => element?.removeEventListener("keydown", trap as EventListener);
  }, []);
  async function save(): Promise<boolean> {
    if (inFlight.current) return inFlight.current;
    const data = latest.current.draft;
    if (JSON.stringify(data) === baseline) return true;
    if (busy) return false;
    if (
      !data.title.trim() ||
      !data.assignee.trim() ||
      !!data.startAt !== !!data.endAt ||
      (data.startAt &&
        data.endAt &&
        Date.parse(data.endAt) <= Date.parse(data.startAt))
    ) {
      setMessage(
        "Не сохранено: заполните название, исполнителя и корректный интервал (либо оставьте обе даты пустыми).",
      );
      failed.current = JSON.stringify(data);
      return false;
    }
    setMessage("Сохранение…");
    inFlight.current = (async () => {
      const ok = await mutate(!exists && selectedTemplateId ? "tasks/from-template" : "tasks/save",
        !exists && selectedTemplateId ? { task: data, templateId: selectedTemplateId } : { task: data, scope });
      if (ok) {
        setBaseline(JSON.stringify(data));
        setMessage("Сохранено");
        failed.current = "";
      } else {
        failed.current = JSON.stringify(data);
        setMessage(
          "Изменения не сохранены. Повторите попытку или исправьте поля.",
        );
      }
      return ok;
    })();
    try {
      return await inFlight.current;
    } finally {
      inFlight.current = null;
    }
  }
  latest.current = {
    save,
    exit: () => {
      void exit();
    },
    draft,
  };
  useEffect(() => {
    if (!dirty || busy || failed.current === JSON.stringify(draft)) return;
    const timer = setTimeout(() => void latest.current.save(), delay.current);
    return () => clearTimeout(timer);
  }, [draft, baseline, busy]);
  async function extra(path: string, data: unknown) {
    if (!(await latest.current.save())) return false;
    return mutate(path, data);
  }
  async function navigate(t: Task) {
    if (busy || !(await latest.current.save())) return;
    open(t);
  }
  const ancestors: Task[] = [];
  let parent = state.tasks.find((t) => t.id === draft.parentId);
  while (parent) {
    ancestors.unshift(parent);
    parent = state.tasks.find((t) => t.id === parent!.parentId);
  }
  const kids = state.tasks
      .filter((t) => t.parentId === draft.id && !t.deletedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    lists = state.checklists
      .filter((c) => c.taskId === draft.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  const timeInput = (value: string | null) =>
    value ? dt(value, zone).toFormat("yyyy-MM-dd'T'HH:mm") : "";
  const fromInput = (value: string) =>
    value ? iso(DateTime.fromISO(value, { zone })) : null;
  const plan =
    draft.startAt && draft.endAt
      ? (Date.parse(draft.endAt) - Date.parse(draft.startAt)) / 3600000
      : 0;
  const taskAudit = state.audit
    .filter((event) => event.taskId === draft.id)
    .sort((a, b) => b.revision - a.revision || b.sequence - a.sequence);
  return (
    <div className="task-window-layer" style={{ zIndex: 20 + layer }}>
      <section
        className={`dialog task-dialog${active ? " active-window" : ""}`}
        onPointerDownCapture={activate}
        onFocusCapture={activate}
        ref={floating.ref}
        style={floating.style}
        role="dialog"
        aria-modal="false"
        aria-labelledby={`task-title-${task.id}`}
      >
        <div className="window-drag-handle" {...floating.handlers}>
          <span>⠿ Переместить окно</span>
          <button
            type="button"
            onClick={floating.reset}
            title="Вернуть окно в центр"
          >
            По центру
          </button>
        </div>
        <nav className="task-breadcrumbs" aria-label="Путь задачи">
          {ancestors.map((t) => (
            <span key={t.id}>
              <button disabled={busy} onClick={() => void navigate(t)}>
                {t.title}
              </button>
              <span aria-hidden="true"> / </span>
            </span>
          ))}
          <button
            aria-current="page"
            onClick={() =>
              form.current
                ?.closest(".dialog")
                ?.scrollTo({ top: 0, behavior: "smooth" })
            }
          >
            {draft.title || "Новая задача"}
          </button>
        </nav>
        <header className="task-header" {...floating.handlers}>
          <div className="task-heading">
            <div className="eyebrow">
              {draft.parentId ? "ПОДЗАДАЧА" : "КАРТОЧКА ЗАДАЧИ"}
            </div>
            <h2 id={`task-title-${task.id}`}>
              <input
                aria-label="Название"
                autoFocus
                required
                maxLength={500}
                value={draft.title}
                disabled={busy}
                placeholder="Название задачи"
                onChange={(e) => set("title", e.target.value)}
              />
            </h2>
          </div>
          <div className="header-fields">
            <label>
              Статус
              <select
                aria-label="Статус задачи"
                disabled={busy}
                value={draft.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {Object.entries(statuses).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Приоритет
              <select
                aria-label="Приоритет задачи"
                disabled={busy}
                value={draft.priority}
                onChange={(e) => set("priority", e.target.value)}
              >
                {Object.entries(priorities).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            {!exists && (
              <label className="task-template-choice">
                Шаблон задачи
                <select value={selectedTemplateId} onChange={(e) => {
                  const id = e.target.value;
                  setSelectedTemplateId(id);
                  const template = state.templates.find((t) => t.id === id);
                  if (template) {
                    delay.current = 0;
                    setDraft((current) => ({ ...current, title: template.title, description: template.description,
                      assignee: template.assignee, priority: template.priority }));
                  } else {
                    setDraft((current) => ({ ...current, title: "", description: "", assignee: "Я", priority: "NORMAL" }));
                  }
                }}>
                  <option value="">Стандартный · пустой</option>
                  {state.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </label>
            )}
            <div className="form-grid">
              <label>
                Начало
                <DeferredDateInput
                  type="datetime-local"
                  data-commit-on-blur="true"
                  value={timeInput(draft.startAt)}
                  onCommit={(value) => set("startAt", fromInput(value))}
                />
              </label>
              <label>
                Окончание
                <DeferredDateInput
                  type="datetime-local"
                  data-commit-on-blur="true"
                  value={timeInput(draft.endAt)}
                  onCommit={(value) => set("endAt", fromInput(value))}
                />
              </label>
            </div>
            <div className="inline">
              <small>
                Время в зоне {zone}. При переходе часов неоднозначное время
                выбирается библиотекой Luxon.
              </small>
            </div>
            <div className="form-grid">
              <label>
                Исполнитель
                <input
                  required
                  value={draft.assignee}
                  onChange={(e) => set("assignee", e.target.value)}
                />
              </label>
              <label>
                Родитель
                <select
                  value={draft.parentId || ""}
                  onChange={(e) => set("parentId", e.target.value || null)}
                >
                  <option value="">Нет — корневая задача</option>
                  {state.tasks
                    .filter(
                      (t) =>
                        !t.deletedAt &&
                        t.id !== draft.id &&
                        !descendants(state.tasks, draft.id).some(
                          (c) => c.id === t.id,
                        ),
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              Описание
              <textarea
                rows={10}
                className="task-description"
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
            {draft.seriesId && (
              <label>
                Изменение серии
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="ONE">Только этот экземпляр</option>
                  <option value="FUTURE">
                    Этот и будущие (кроме исключений)
                  </option>
                </select>
              </label>
            )}
            <div className="autosave-status" role="status">
              {busy
                ? "Сохранение…"
                : dirty
                  ? message.startsWith("Не сохранено") ||
                    message.startsWith("Изменения не")
                    ? message
                    : "Есть изменения · автосохранение через 5 секунд"
                  : exists
                    ? "Сохранено"
                    : "Введите название, чтобы создать задачу"}
              {dirty && failed.current && (
                <button type="button" onClick={() => void save()}>
                  Повторить сохранение
                </button>
              )}
            </div>
          </fieldset>
        </form>
        {exists && (
          <div className="task-details">
            <section>
              <h3>План и факт</h3>
              <div className="fact-grid">
                <span>
                  План <b>{humanDuration(plan)}</b>
                </span>
                <span>
                  Своё время <b>{humanDuration(hours(state, draft.id, now))}</b>
                </span>
                <span>
                  С потомками{" "}
                  <b>{humanDuration(hours(state, draft.id, now, true))}</b>
                </span>
              </div>
              <div className="editor-actions">
                <button
                  disabled={busy}
                  onClick={() => void extra("timers/start", { id: draft.id })}
                >
                  {state.timer.taskId === draft.id &&
                  state.timer.state === "PAUSED"
                    ? "Продолжить"
                    : "▶ Начать"}
                </button>
                {state.timer.taskId === draft.id &&
                  state.timer.state !== "STOPPED" && (
                    <>
                      <button
                        disabled={busy || state.timer.state === "PAUSED"}
                        onClick={() => void extra("timers/pause", {})}
                      >
                        Ⅱ Пауза
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void extra("timers/stop", {})}
                      >
                        ■ Стоп
                      </button>
                    </>
                  )}
                <button
                  onClick={() => {
                    setEntry({
                      id: uid(),
                      taskId: draft.id,
                      source: "MANUAL",
                      startAt: null,
                      endAt: null,
                      workDate: DateTime.now().setZone(zone).toISODate(),
                      seconds: 1800,
                    });
                    setMinutes("30");
                  }}
                >
                  ＋ Фактическое время
                </button>
              </div>
              {entry && (
                <div className="entry-form">
                  <label>
                    Способ ввода
                    <select
                      value={entry.startAt ? "INTERVAL" : "DURATION"}
                      onChange={(e) =>
                        setEntry({
                          ...entry,
                          startAt:
                            e.target.value === "INTERVAL"
                              ? iso(
                                  DateTime.now()
                                    .setZone(zone)
                                    .startOf("minute"),
                                )
                              : null,
                          endAt:
                            e.target.value === "INTERVAL"
                              ? iso(
                                  DateTime.now()
                                    .setZone(zone)
                                    .startOf("minute")
                                    .plus({ minutes: 30 }),
                                )
                              : null,
                          workDate: DateTime.now().setZone(zone).toISODate(),
                        })
                      }
                    >
                      <option value="DURATION">Длительность на дату</option>
                      <option value="INTERVAL">Интервал</option>
                    </select>
                  </label>
                  {entry.startAt ? (
                    <div className="form-grid">
                      <label>
                        С
                        <DateInput
                          type="datetime-local"
                          value={timeInput(entry.startAt)}
                          onChange={(e) =>
                            setEntry({
                              ...entry,
                              startAt: fromInput(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        По
                        <DateInput
                          type="datetime-local"
                          value={timeInput(entry.endAt)}
                          onChange={(e) =>
                            setEntry({
                              ...entry,
                              endAt: fromInput(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="form-grid">
                      <label>
                        Дата работы
                        <DateInput
                          type="date"
                          value={entry.workDate || ""}
                          onChange={(e) =>
                            setEntry({ ...entry, workDate: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Минут
                        <input
                          type="number"
                          min="0.0167"
                          step="any"
                          value={minutes}
                          onChange={(e) => setMinutes(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await extra("time-entries/save", {
                          ...entry,
                          seconds: Math.round(+minutes * 60),
                        })
                      )
                        setEntry(null);
                    }}
                  >
                    Записать время
                  </button>
                  <button onClick={() => setEntry(null)}>Отмена</button>
                </div>
              )}
              <p className="muted">
                Ручные записи учитываются отдельно, даже если их интервалы
                пересекаются.
              </p>
              {state.entries
                .filter((e) => e.taskId === draft.id)
                .sort((a, b) =>
                  (b.startAt || b.workDate || "").localeCompare(
                    a.startAt || a.workDate || "",
                  ),
                )
                .map((e) => (
                  <div className="list-line" key={e.id}>
                    <span>
                      {e.startAt
                        ? dt(e.startAt, zone).toFormat("dd.MM.yyyy HH:mm")
                        : e.workDate}{" "}
                      · {(e.seconds / 60).toFixed(1)} мин ·{" "}
                      {e.source === "TIMER" ? "Таймер" : "Вручную"}
                    </span>
                    <button
                      onClick={() => {
                        setEntry({ ...e });
                        setMinutes(String(e.seconds / 60));
                      }}
                    >
                      Изменить
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (confirm("Удалить запись фактического времени?"))
                          void extra("time-entries/delete", { id: e.id });
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                ))}
            </section>
            <section>
              <h3>
                Подзадачи{" "}
                <small>
                  {kids.filter((t) => t.status === "DONE").length}/{kids.length}
                </small>
              </h3>
              {kids.map((t) => (
                <details key={t.id}>
                  <summary>
                    {t.title} · {statuses[t.status]}
                  </summary>
                  <div className="list-line">
                    <span>
                      {t.startAt
                        ? `${dt(t.startAt, zone).toFormat("dd.MM HH:mm")} — ${dt(t.endAt!, zone).toFormat("dd.MM HH:mm")}`
                        : "Без даты"}
                    </span>
                    <button onClick={() => navigate(t)}>Открыть</button>
                  </div>
                  <details>
                    <summary>⋯ Чек-листы и потомки</summary>
                    {state.checklists
                      .filter((c) => c.taskId === t.id)
                      .map((c) => (
                        <p key={c.id}>
                          {c.title}:{" "}
                          {
                            state.items.filter(
                              (i) => i.checklistId === c.id && i.done,
                            ).length
                          }
                          /
                          {
                            state.items.filter((i) => i.checklistId === c.id)
                              .length
                          }
                        </p>
                      ))}
                    {state.tasks
                      .filter((x) => x.parentId === t.id && !x.deletedAt)
                      .map((x) => (
                        <button key={x.id} onClick={() => navigate(x)}>
                          {x.title}
                        </button>
                      ))}
                  </details>
                </details>
              ))}
              <button
                disabled={busy}
                onClick={() => navigate(fresh(null, null, draft.id))}
              >
                ＋ Подзадача
              </button>
            </section>
            <ChecklistEditor
              state={state}
              taskId={draft.id}
              busy={busy}
              mutate={extra}
              onDirty={setCheckDirty}
              flushRef={flushChecks}
            />
            <section className="task-template-save">
              <h3>Сохранить как шаблон</h3>
              <p className="muted">Название, описание, исполнителя, приоритет и пункты чек-листа можно будет использовать в новых задачах.</p>
              <div className="inline">
                <input aria-label="Название нового шаблона" placeholder="Название шаблона" maxLength={100} value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                <button disabled={busy || checkDirty || !templateName.trim()} onClick={async () => {
                  const checklistItems = lists.flatMap((list) => state.items.filter((item) => item.checklistId === list.id).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.text));
                  if (await extra("templates/save", { id: uid(), name: templateName.trim(), title: draft.title,
                    description: draft.description, assignee: draft.assignee, priority: draft.priority, checklistItems })) {
                    setTemplateName("");
                    setMessage("Шаблон создан");
                  }
                }}>Создать шаблон</button>
              </div>
            </section>
            <CommentsEditor
              comments={state.comments}
              taskId={draft.id}
              zone={zone}
              busy={busy}
              mutate={extra}
              onDirty={setCommentsDirty}
              flushRef={flushComments}
            />
            <section className="audit-section">
              <details className="audit-log">
                <summary>История изменений · {taskAudit.length}</summary>
                {taskAudit.length ? taskAudit.map((event) => (
                  <div className="audit-entry" key={event.id}>
                    <time dateTime={event.createdAt}>{dt(event.createdAt, zone).toFormat("dd.MM.yyyy HH:mm")}</time>
                    <div><strong>{event.action}</strong><p>{event.detail}</p></div>
                  </div>
                )) : <p className="muted">История появится после следующего изменения задачи.</p>}
              </details>
            </section>
            <section>
              <h3>Повторение</h3>
              {draft.seriesId && (
                <>
                  <p>
                    Экземпляр серии. Отдельные изменения и удаления сохраняются
                    как исключения.
                  </p>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (
                        confirm(
                          "Отключить серию? Уже созданные экземпляры останутся самостоятельными задачами.",
                        ) &&
                        (await extra("recurrences/delete", {
                          id: draft.seriesId,
                        }))
                      )
                        close();
                    }}
                  >
                    Отключить серию
                  </button>
                </>
              )}
              {
                <>
                  <div className="form-grid">
                    <label>
                      Частота
                      <select
                        value={series.frequency}
                        onChange={(e) =>
                          setSeries({ ...series, frequency: e.target.value })
                        }
                      >
                        <option value="DAILY">Ежедневно</option>
                        <option value="WEEKLY">Еженедельно</option>
                        <option value="WEEKDAYS">По дням недели</option>
                        <option value="MONTHLY">Ежемесячно</option>
                      </select>
                    </label>
                    <label>
                      Число экземпляров (включая текущий)
                      <input
                        type="number"
                        min={1}
                        max={366}
                        value={series.count}
                        onChange={(e) =>
                          setSeries({ ...series, count: +e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Не позднее даты (необязательно)
                      <DateInput
                        type="date"
                        value={series.until || ""}
                        onChange={(e) =>
                          setSeries({
                            ...series,
                            until: e.target.value || null,
                          })
                        }
                      />
                    </label>
                  </div>
                  {series.frequency === "WEEKDAYS" && (
                    <div className="inline">
                      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(
                        (v, i) => (
                          <label className="inline" key={v}>
                            <input
                              type="checkbox"
                              checked={series.weekdays.includes(i + 1)}
                              onChange={(e) =>
                                setSeries({
                                  ...series,
                                  weekdays: e.target.checked
                                    ? [...series.weekdays, i + 1]
                                    : series.weekdays.filter(
                                        (d) => d !== i + 1,
                                      ),
                                })
                              }
                            />
                            {v}
                          </label>
                        ),
                      )}
                    </div>
                  )}
                  <button
                    disabled={busy || !draft.startAt || !!draft.parentId}
                    onClick={async () => {
                      if (
                        (!draft.seriesId ||
                          confirm(
                            "Пересчитать все неизменённые экземпляры серии? Исключения сохранятся; лишние даты переместятся в корзину.",
                          )) &&
                        (await extra("recurrences/save", series))
                      )
                        close();
                    }}
                  >
                    {draft.seriesId
                      ? "Сохранить правило серии"
                      : "Создать серию"}
                  </button>
                  <p className="muted">
                    До 366 экземпляров. Повторяются основные поля и время
                    корневой задачи; её потомки, комментарии и факт не
                    копируются.
                  </p>
                </>
              }
            </section>
            <footer>
              <button
                disabled={busy}
                onClick={async () => {
                  if (await extra("tasks/clone", { id: draft.id })) close();
                }}
              >
                Дублировать
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (
                    confirm(
                      "Переместить задачу и всех потомков в корзину? Чек-листы, комментарии и время сохранятся для восстановления.",
                    ) &&
                    (await extra("tasks/delete", { id: draft.id, scope }))
                  ) {
                    removed(draft.id);
                    close();
                  }
                }}
              >
                В корзину{scope === "FUTURE" ? " (и будущие)" : ""}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  delay.current = 0;
                  failed.current = "";
                  setDraft((d) => ({ ...d, startAt: null, endAt: null }));
                }}
              >
                В бэклог
              </button>
              <button onClick={exit} disabled={busy}>
                Закрыть
              </button>
            </footer>
          </div>
        )}
        {message && message !== "Сохранено" && message !== "Сохранение…" && (
          <p className="editor-message" role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
