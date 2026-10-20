import { MultiFilter } from "./MultiFilter";
import { DateInput } from "./DateInput";
import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  State,
  Task,
  Result,
  Stats,
  statuses,
  priorities,
  dt,
  iso,
  overdue,
  fresh,
  segments,
  hours,
  humanDuration,
  activityLevel,
  descendants,
} from "./model";
import { TaskEditor } from "./TaskEditor";
import { TemplatesPanel } from "./TemplatesPanel";
import { uiScale } from "./uiScale";
type Pending = {
  path: string;
  data: unknown;
  revision: number;
  result: Result;
  resolve: (ok: boolean) => void;
};
export type Mutate = (path: string, data: unknown) => Promise<boolean>;
function MetricSummary({ stats, heading }: { stats: Stats | null; heading: string }) {
  return (
    <div className="metric-group">
      <h2>{heading}</h2>
      <section className="metrics" aria-label={heading}>
        <div><small>ПЛАН</small><strong>{stats?.plannedHours.toFixed(1) ?? "0.0"} <em>ч</em></strong></div>
        <div><small>ФАКТ</small><strong>{stats?.actualHours.toFixed(1) ?? "0.0"} <em>ч</em></strong></div>
        <div><small>ОТКЛОНЕНИЕ</small><strong>{stats?.deviation.toFixed(1) ?? "0.0"} <em>ч</em></strong></div>
        <div><small>ЗАВЕРШЕНО</small><strong>{stats?.done ?? 0} <em>/ {stats?.count ?? 0}</em></strong></div>
        <p>План — корневые задачи<br />Сводка без фильтров</p>
      </section>
    </div>
  );
}
export function App() {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending | null>(null);
  const [zone, setZone] = useState(
    localStorage.getItem("planner-zone") ||
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [date, setDate] = useState(DateTime.now().setZone(zone).toISODate()!),
    [view, setView] = useState("week"),
    [step, setStep] = useState(30),
    [now, setNow] = useState(Date.now());
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState<string[]>([]),
    [priority, setPriority] = useState<string[]>([]),
    [assignee, setAssignee] = useState(""),
    [onlyOverdue, setOnlyOverdue] = useState(false);
  const [editors, setEditors] = useState<Task[]>([]),
    [showTemplates, setShowTemplates] = useState(false),
    [stats, setStats] = useState<Stats | null>(null),
    [dailyStats, setDailyStats] = useState<Stats | null>(null),
    [from, setFrom] = useState(date),
    [to, setTo] = useState(
      DateTime.fromISO(date).plus({ days: 6 }).toISODate()!,
    );
  const [undo, setUndo] = useState<{ task?: Task; restore?: string } | null>(
      null,
    ),
    [notice, setNotice] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;
  const deciding = useRef(false);
  const [periodPage, setPeriodPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  useEffect(() => setPeriodPage(0), [from, to]);
  const lock = useRef(false),
    grid = useRef<HTMLDivElement>(null),
    drag = useRef<{ task: Task; offset: number } | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/state");
      if (!r.ok) throw Error("Сервер недоступен");
      setState(await r.json());
      setError("");
    } catch (e) {
      setError(
        "Не удалось загрузить данные. Проверьте backend и PostgreSQL. " +
          String(e),
      );
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const visible = () => {
      setNow(Date.now());
      if (!document.hidden && !lock.current) void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);
  useEffect(() => {
    let lastPing = 0;
    const activity = () => {
      if (document.hidden || Date.now() - lastPing < 60000) return;
      lastPing = Date.now();
      void fetch("/api/v1/activity", { method: "POST", keepalive: true }).catch(() => {});
    };
    document.addEventListener("pointerdown", activity);
    document.addEventListener("keydown", activity);
    return () => {
      document.removeEventListener("pointerdown", activity);
      document.removeEventListener("keydown", activity);
    };
  }, []);
  const chosen = DateTime.fromISO(date, { zone }),
    week = chosen.startOf("week"),
    days = Array.from({ length: 7 }, (_, i) => week.plus({ days: i }));
  const rangeFrom =
    view === "year"
      ? chosen.startOf("year").toISODate()!
      : view === "month"
        ? chosen.startOf("month").toISODate()!
        : view === "period"
          ? from
          : week.toISODate()!;
  const rangeTo =
    view === "year"
      ? chosen.endOf("year").toISODate()!
      : view === "month"
        ? chosen.endOf("month").toISODate()!
        : view === "period"
          ? to
          : week.plus({ days: 6 }).toISODate()!;
  useEffect(() => {
    let active = true;
    fetch(
      `/api/v1/stats?from=${rangeFrom}&to=${rangeTo}&zone=${encodeURIComponent(zone)}`,
    )
      .then(async (r) => {
        if (!r.ok) throw Error("Не удалось рассчитать сводку");
        return r.json();
      })
      .then((s) => {
        if (active) setStats(s);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [state?.revision, rangeFrom, rangeTo, zone, Math.floor(now / 60000)]);
  useEffect(() => {
    if (view !== "week") return;
    let active = true;
    setDailyStats(null);
    fetch(`/api/v1/stats?from=${date}&to=${date}&zone=${encodeURIComponent(zone)}`)
      .then(async (r) => {
        if (!r.ok) throw Error("Не удалось рассчитать сводку за день");
        return r.json() as Promise<Stats>;
      })
      .then((s) => { if (active) setDailyStats(s); })
      .catch((e) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [view, date, zone, state?.revision, Math.floor(now / 60000)]);
  useEffect(() => {
    if (grid.current && view === "week")
      grid.current.scrollTop = 8 * 60 * (30 / step);
  }, [view, step, !!state]);
  async function request(
    path: string,
    data: unknown,
    revision: number,
    confirm = false,
  ): Promise<{ ok: boolean; decision?: Result }> {
    const r = await fetch("/api/v1/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision, confirm, data }),
    });
    const body = await r.json();
    if (r.status === 409 && body.code === "CONFIRM_REQUIRED")
      return { ok: false, decision: body.details };
    if (!r.ok) {
      if (body.code === "STALE_REVISION") await load();
      throw Error(body.message || "Ошибка сохранения");
    }
    stateRef.current = body.state;
    setState(body.state);
    setNotice("Сохранено");
    return { ok: true };
  }
  const mutate: Mutate = async (path, data) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const revision = stateRef.current!.revision;
      const result = await request(path, data, revision);
      if (result.decision) {
        return await new Promise<boolean>((resolve) =>
          setPending({
            path,
            data,
            revision,
            result: result.decision!,
            resolve,
          }),
        );
      }
      return result.ok;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  async function decide(yes: boolean) {
    if (!pending || deciding.current) return;
    const p = pending;
    if (!yes) {
      setPending(null);
      p.resolve(false);
      return;
    }
    try {
      deciding.current = true;
      const r = await request(p.path, p.data, p.revision, true);
      setPending(null);
      p.resolve(r.ok);
    } catch (e) {
      setError(String(e));
      setPending(null);
      p.resolve(false);
    } finally {
      deciding.current = false;
    }
  }
  const open = (t: Task) => setEditors((windows) => [...windows.filter((w) => w.id !== t.id), windows.find((w) => w.id === t.id) || { ...t }]);
  const create = (start?: DateTime, end?: DateTime) =>
    open(fresh(start ? iso(start) : null, end ? iso(end) : null));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "n" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        ) &&
        !editors.length &&
        !pending
      ) {
        e.preventDefault();
        create();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [editors, pending]);
  const tasks = state?.tasks.filter((t) => !t.deletedAt) || [];
  const matches = (t: Task) =>
    (t.title + " " + t.description)
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (!status.length || status.includes(t.status)) &&
    (!priority.length || priority.includes(t.priority)) &&
    (!assignee || t.assignee.toLowerCase().includes(assignee.toLowerCase())) &&
    (!onlyOverdue || overdue(t, now));
  const filtered = tasks.filter(matches),
    roots = tasks.filter(
      (t) =>
        !t.parentId && (matches(t) || descendants(tasks, t.id).some(matches)),
    ),
    conflictIds = new Set<string>();
  const allRoots = tasks.filter(
    (t) => !t.parentId && t.startAt && t.status !== "CANCELED",
  );
  for (let i = 0; i < allRoots.length; i++)
    for (let j = i + 1; j < allRoots.length; j++) {
      const a = allRoots[i],
        b = allRoots[j];
      if (
        Date.parse(a.startAt!) < Date.parse(b.endAt!) &&
        Date.parse(b.startAt!) < Date.parse(a.endAt!)
      ) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  const stamp = (t: Task) =>
    t.startAt
      ? `${dt(t.startAt, zone).toFormat("dd.MM HH:mm")} – ${dt(t.endAt!, zone).toFormat("dd.MM HH:mm")}`
      : "Без даты";
  const title = (t: Task) => (
    <>
      {overdue(t, now) && (
        <span title="Просрочена" aria-label="Просрочена">
          !{" "}
        </span>
      )}
      {t.title}
    </>
  );
  const summary = (t: Task) => {
    const children = tasks.filter((x) => x.parentId === t.id),
      lists = state!.checklists.filter((c) => c.taskId === t.id),
      items = state!.items.filter((i) =>
        lists.some((c) => c.id === i.checklistId),
      );
    return `${children.length ? `↳ ${children.filter((x) => x.status === "DONE").length}/${children.length} ` : ""}${items.length ? `☑ ${items.filter((i) => i.done).length}/${items.length}` : ""}`;
  };
  const row = (t: Task) => (
    <button
      key={t.id}
      className={`task-row ${t.priority} ${t.status}`}
      onClick={() => open(t)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        drag.current = { task: t, offset: 0 };
      }}
    >
      <strong>{title(t)}</strong>
      <span className="status-visually-hidden">Статус: {statuses[t.status]}.</span>
      <small>
        {stamp(t)} · {summary(t)}
      </small>
    </button>
  );
  async function move(t: Task, start: DateTime, end: DateTime) {
    if (
      await mutate("schedule/save", {
        task: { ...t, startAt: iso(start), endAt: iso(end) },
      })
    )
      setUndo({ task: t });
  }
  function minuteAt(
    e: { clientY: number; currentTarget: HTMLElement },
    day: DateTime,
  ) {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.max(
      0,
      Math.min(
        day.plus({ days: 1 }).diff(day, "minutes").minutes - step,
        Math.round((e.clientY - rect.top) / uiScale() / (30 / step) / step) * step,
      ),
    );
    return day.plus({ minutes });
  }
  async function doUndo() {
    if (!undo) return;
    const ok = undo.task
      ? await mutate("schedule/save", { task: undo.task })
      : await mutate("tasks/restore", { id: undo.restore });
    if (ok) setUndo(null);
  }
  const navigate = (n: number) =>
    setDate(
      chosen
        .plus(
          view === "year"
            ? { years: n }
            : view === "month"
              ? { months: n }
              : { weeks: n },
        )
        .toISODate()!,
    );
  async function exportAnalysis() {
    setExporting(true);
    try {
      const r = await fetch(
        `/api/v1/analytics/export?from=${rangeFrom}&to=${rangeTo}&zone=${encodeURIComponent(zone)}`,
      );
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw Error(body?.message || "Не удалось выгрузить отчёт");
      }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `planner-analysis-${rangeFrom}-${rangeTo}.xlsx`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `Excel-отчёт: ${rangeFrom} — ${rangeTo}. План, факт и выполнение; без фильтров списка.`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }
  async function exportData() {
    try {
      const r = await fetch("/api/v1/backup/export");
      if (!r.ok) throw Error("Ошибка экспорта");
      const blob = new Blob([JSON.stringify(await r.json(), null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `planner-${DateTime.now().toFormat("yyyy-MM-dd-HHmm")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  }
  async function importData(file: File) {
    try {
      if (file.size > 20 * 1024 * 1024)
        throw Error("Максимальный размер 20 МБ");
      const imported = JSON.parse(await file.text());
      const mode = window.prompt(
        "Введите СЛИЯНИЕ (только новые ID) или ЗАМЕНА (заменит все данные). Сначала рекомендуется экспорт.",
      );
      if (!mode) return;
      if (!["СЛИЯНИЕ", "ЗАМЕНА"].includes(mode)) throw Error("Неверный режим");
      if (
        window.confirm(
          `Подтвердить ${mode.toLowerCase()} данных из ${file.name}?`,
        )
      )
        await mutate("backup/import", {
          state: imported,
          mode: mode === "ЗАМЕНА" ? "REPLACE" : "MERGE",
          confirmed: true,
        });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>П</span>
          <div>
            Планировщик<small>Личное пространство</small>
          </div>
        </div>
        <button className="primary" onClick={() => create()} disabled={!state}>
          ＋ Новая задача <kbd>N</kbd>
        </button>
        <button className="templates-open" onClick={() => setShowTemplates(true)} disabled={!state || editors.length > 0}>
          Шаблоны задач · {state?.templates.length ?? 0}
        </button>
        <nav>
          {[
            ["week", "Неделя"],
            ["month", "Месяц"],
            ["year", "Год"],
            ["period", "Период"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "selected" : ""}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <details open>
          <summary>
            Без даты <b>{filtered.filter((t) => !t.startAt).length}</b>
          </summary>
          <div className="side-list">
            {filtered.filter((t) => !t.startAt).map(row)}
            {!filtered.some((t) => !t.startAt) && (
              <p className="muted">Задачи без расписания появятся здесь.</p>
            )}
          </div>
        </details>
        <details>
          <summary>
            Просроченные <b>{filtered.filter((t) => overdue(t, now)).length}</b>
          </summary>
          <div className="side-list">
            {filtered.filter((t) => overdue(t, now)).map(row)}
          </div>
        </details>
        <details>
          <summary>Корзина</summary>
          {state?.tasks
            .filter(
              (t) =>
                t.deletedAt &&
                (!t.parentId ||
                  !state.tasks.find((p) => p.id === t.parentId)?.deletedAt),
            )
            .map((t) => (
              <div key={t.id} className="trash">
                <span>{t.title}</span>
                <button
                  disabled={busy}
                  onClick={() => void mutate("tasks/restore", { id: t.id })}
                >
                  Восстановить
                </button>
              </div>
            ))}
        </details>
        <div className="sidebar-bottom">
          <label>
            Часовой пояс
            <select
              value={zone}
              onChange={(e) => {
                setZone(e.target.value);
                localStorage.setItem("planner-zone", e.target.value);
              }}
            >
              {Array.from(
                new Set([zone, ...Intl.supportedValuesOf("timeZone")]),
              ).map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void exportAnalysis()}
            disabled={!state || exporting || busy}
            title={`План, факт и выполнение за ${rangeFrom} — ${rangeTo}. Все задачи периода, без фильтров списка.`}
          >
            {exporting ? "Готовлю отчёт…" : "Анализ · Excel"}
          </button>
          <small>
            Период отчёта: {rangeFrom} — {rangeTo}. Без фильтров списка.
          </small>
          <button onClick={() => void exportData()} disabled={!state}>
            Резервная копия · JSON
          </button>
          <label className="file-button">
            Импорт JSON
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy || !state}
              onChange={(e) => {
                if (e.target.files?.[0]) void importData(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">ВАШЕ ВРЕМЯ · ВАШИ ПЛАНЫ</div>
            <h1>
              {view === "week"
                ? `Моя неделя (${week.toFormat("dd.MM.yyyy")} - ${week.plus({ days: 6 }).toFormat("dd.MM.yyyy")})`
                : view === "month"
                  ? `Мой месяц (${chosen.setLocale("ru").toFormat("LLLL yyyy").replace(/^./, (letter) => letter.toUpperCase())})`
                  : view === "year"
                    ? `Мой год (${chosen.year})`
                    : `Обзор периода (${DateTime.fromISO(from).toFormat("dd.MM.yyyy")} - ${DateTime.fromISO(to).toFormat("dd.MM.yyyy")})`}
            </h1>
            <p>{zone}</p>
          </div>
          <div className="navigation">
            <button aria-label="Предыдущий период" onClick={() => navigate(-1)}>
              ←
            </button>
            <button
              onClick={() => setDate(DateTime.now().setZone(zone).toISODate()!)}
            >
              Сегодня
            </button>
            <button aria-label="Следующий период" onClick={() => navigate(1)}>
              →
            </button>
            <DateInput
              aria-label="Перейти к дате"
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
        </header>
        <div className="filters">
          <input
            type="search"
            aria-label="Поиск задач"
            placeholder="Поиск по названию и описанию"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <MultiFilter label="Статусы" allLabel="Все статусы" options={statuses} value={status} onChange={setStatus} />
          <MultiFilter label="Приоритеты" allLabel="Все приоритеты" options={priorities} value={priority} onChange={setPriority} />
          <input
            aria-label="Исполнитель"
            placeholder="Исполнитель"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          />
          <button
            type="button"
            className="overdue-filter"
            aria-pressed={onlyOverdue}
            onClick={() => setOnlyOverdue((selected) => !selected)}
          >
            Только просроченные
          </button>
          {view === "week" && (
            <select
              aria-label="Шаг сетки"
              value={step}
              onChange={(e) => setStep(+e.target.value)}
            >
              {[15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} мин
                </option>
              ))}
            </select>
          )}
        </div>
        <MetricSummary stats={stats} heading={view === "week" ? "За неделю" : "За выбранный период"} />
        {view === "week" && (
          <MetricSummary
            stats={dailyStats}
            heading={`За день · ${chosen.setLocale("ru").toFormat("d MMMM yyyy")}`}
          />
        )}
        <div className="feedback" aria-live="polite">
          {busy ? "Сохранение…" : notice}
          {undo && (
            <button onClick={() => void doUndo()} disabled={busy}>
              Отменить последнее изменение
            </button>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {state?.timer.state !== "STOPPED" && state?.timer.taskId && (
          <div className="timer-bar">
            <button
              onClick={() =>
                open(state.tasks.find((t) => t.id === state.timer.taskId)!)
              }
            >
              {state.timer.state === "RUNNING" ? "● Таймер" : "Ⅱ Пауза"} ·{" "}
              {state.tasks.find((t) => t.id === state.timer.taskId)?.title} ·{" "}
              <strong className="timer-value">
                {humanDuration(hours(state, state.timer.taskId, now))}
              </strong>
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void mutate(
                  state.timer.state === "RUNNING"
                    ? "timers/pause"
                    : "timers/resume",
                  { id: state.timer.taskId },
                )
              }
            >
              {state.timer.state === "RUNNING" ? "Пауза" : "Продолжить"}
            </button>
            <button
              disabled={busy}
              onClick={() => void mutate("timers/stop", {})}
            >
              Стоп
            </button>
          </div>
        )}
        {!state ? (
          <div className="empty">
            <h2>Подключение к планировщику</h2>
            <p>Ожидаем ответ локального сервера.</p>
            <button onClick={() => void load()}>Повторить</button>
          </div>
        ) : (
          <>
            {view === "week" && (
              <>
                <div className="calendar-scroll has-day-summary" ref={grid}>
                  <div className="week-head">
                    <div></div>
                    {days.map((day) => (
                      <div
                        key={day.toISO()}
                        className={
                          `${day.hasSame(DateTime.fromMillis(now, { zone }), "day") ? "today" : ""} ${day.hasSame(chosen, "day") ? "selected-day" : ""}`
                        }
                      >
                        <button
                          type="button"
                          aria-label={`Показать статистику за ${day.setLocale("ru").toFormat("d MMMM yyyy")}`}
                          aria-pressed={day.hasSame(chosen, "day")}
                          onClick={() => setDate(day.toISODate()!)}
                        >
                          <strong>{day.day}</strong>
                          <span>{day.setLocale("ru").toFormat("cccc")}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="week-body">
                    <div
                      className="time-axis"
                      style={{
                        height:
                          Math.max(
                            ...days.map(
                              (d) =>
                                d.plus({ days: 1 }).diff(d, "minutes").minutes,
                            ),
                          ) *
                          (30 / step),
                      }}
                    >
                      {Array.from({ length: 25 }, (_, h) => (
                        <span key={h} style={{ top: h * 60 * (30 / step) }}>
                          {String(h).padStart(2, "0")}:00
                        </span>
                      ))}
                    </div>
                    {days.map((day) => {
                      const minutes = day
                          .plus({ days: 1 })
                          .diff(day, "minutes").minutes,
                        scale = 30 / step;
                      return (
                        <div
                          key={day.toISO()}
                          className="day-column"
                          style={{
                            height: minutes * scale,
                            backgroundSize: `100% ${step * scale}px`,
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const t = tasks.find(
                              (t) =>
                                t.id === e.dataTransfer.getData("text/plain"),
                            );
                            if (t) {
                              const start = minuteAt(e, day).minus({
                                minutes: drag.current?.offset || 0,
                              });
                              void move(
                                t,
                                start,
                                start.plus({
                                  milliseconds: t.startAt
                                    ? Date.parse(t.endAt!) -
                                      Date.parse(t.startAt)
                                    : 3600000,
                                }),
                              );
                            }
                            drag.current = null;
                          }}
                          onPointerDown={(e) => {
                            if (e.target !== e.currentTarget || e.button !== 0)
                              return;
                            const start = minuteAt(e, day);
                            const element = e.currentTarget;
                            element.setPointerCapture(e.pointerId);
                            const up = (ev: PointerEvent) => {
                              element.removeEventListener("pointerup", up);
                              const finish = minuteAt(
                                { clientY: ev.clientY, currentTarget: element },
                                day,
                              );
                              create(
                                start < finish ? start : finish,
                                (start < finish ? finish : start).plus({
                                  minutes: step,
                                }),
                              );
                            };
                            element.addEventListener("pointerup", up, {
                              once: true,
                            });
                          }}
                        >
                          {minutes !== 1440 &&
                            Array.from(
                              { length: Math.ceil(minutes / 60) },
                              (_, h) => (
                                <small
                                  key={h}
                                  className="dst-tick"
                                  style={{ top: h * 60 * scale }}
                                  title={day
                                    .plus({ hours: h })
                                    .toFormat("HH:mm ZZZZ")}
                                >
                                  {day.plus({ hours: h }).toFormat("HH:mm ZZ")}
                                </small>
                              ),
                            )}
                          {day.hasSame(
                            DateTime.fromMillis(now, { zone }),
                            "day",
                          ) && (
                            <div
                              className="now-line"
                              style={{
                                top: ((now - day.toMillis()) / 60000) * scale,
                              }}
                              aria-label="Текущее время"
                            />
                          )}
                          {segments(roots, day).map((seg) => {
                            const t = seg.task;
                            return (
                              <div
                                key={t.id}
                                className={`calendar-task ${t.priority} ${t.status} ${conflictIds.has(t.id) ? "conflict" : ""}`}
                                style={{
                                  top:
                                    ((seg.start - day.toMillis()) / 60000) *
                                    scale,
                                  height: Math.max(
                                    4,
                                    ((seg.end - seg.start) / 60000) * scale,
                                  ),
                                  left: `calc(${(seg.column / seg.columns) * 100}% + 2px)`,
                                  width: `calc(${100 / seg.columns}% - 4px)`,
                                }}
                              >
                                <button
                                  className="task-main"
                                  title={`${t.title}\n${stamp(t)}\n${statuses[t.status]} · ${priorities[t.priority]}${conflictIds.has(t.id) ? " · Пересечение" : ""}`}
                                  onClick={() => open(t)}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData("text/plain", t.id);
                                    drag.current = {
                                      task: t,
                                      offset:
                                        (seg.start - Date.parse(t.startAt!)) /
                                        60000,
                                    };
                                  }}
                                >
                                  <strong>{title(t)}</strong>
                                  <span className="status-visually-hidden">Статус: {statuses[t.status]}.</span>
                                  <small>
                                    {dt(t.startAt!, zone).toFormat("HH:mm")}–
                                    {dt(t.endAt!, zone).toFormat("HH:mm")} ·{" "}
                                    {priorities[t.priority]}
                                  </small>
                                  <small>
                                    {summary(t)}{" "}
                                    {conflictIds.has(t.id)
                                      ? "⚠ Пересечение"
                                      : ""}
                                  </small>
                                  <span className="calendar-contents">
                                    {tasks
                                      .filter((c) => c.parentId === t.id)
                                      .sort((a, b) => a.sortOrder - b.sortOrder)
                                      .map((c) => (
                                        <span
                                          className="calendar-child"
                                          key={c.id}
                                          title={
                                            c.title + " · " + statuses[c.status]
                                          }
                                        >
                                          ↳ {c.title} · {statuses[c.status]}
                                        </span>
                                      ))}
                                    {state.checklists
                                      .filter((c) => c.taskId === t.id)
                                      .flatMap((c) =>
                                        state.items
                                          .filter((i) => i.checklistId === c.id)
                                          .sort(
                                            (a, b) => a.sortOrder - b.sortOrder,
                                          ),
                                      )
                                      .map((i) => (
                                        <span
                                          className="calendar-check"
                                          key={i.id}
                                          title={i.text}
                                        >
                                          {i.done ? "☑" : "☐"} {i.text}
                                        </span>
                                      ))}
                                  </span>
                                </button>
                                {seg.end === Date.parse(t.endAt!) && (
                                  <div
                                    className="resize"
                                    role="separator"
                                    aria-label="Изменить конец задачи; также доступно в карточке"
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      const y = e.clientY;
                                      const up = (ev: PointerEvent) => {
                                        window.removeEventListener(
                                          "pointerup",
                                          up,
                                        );
                                        const delta =
                                          Math.round(
                                            (ev.clientY - y) / uiScale() / scale / step,
                                          ) * step;
                                        const end = dt(t.endAt!, zone).plus({
                                          minutes: delta,
                                        });
                                        if (
                                          end.toMillis() >
                                          Date.parse(t.startAt!)
                                        )
                                          void move(
                                            t,
                                            dt(t.startAt!, zone),
                                            end,
                                          );
                                      };
                                      window.addEventListener("pointerup", up, {
                                        once: true,
                                      });
                                    }}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="hint">
                  Выделите интервал для создания · Перетащите блок для переноса
                  · Нижний край меняет длительность · Время также редактируется
                  в карточке
                </p>
              </>
            )}
            {view === "month" && (
              <div className="month-grid">
                {Array.from({ length: 42 }, (_, i) =>
                  chosen.startOf("month").startOf("week").plus({ days: i }),
                ).map((day) => {
                  const list = segments(roots, day).map((s) => s.task);
                  return (
                    <div
                      key={day.toISO()}
                      className={`month-day ${day.month !== chosen.month ? "outside" : ""}`}
                    >
                      <button
                        className="day-number"
                        onClick={() => {
                          setDate(day.toISODate()!);
                          setView("week");
                        }}
                      >
                        {day.setLocale("ru").toFormat("ccc, d")}
                      </button>
                      {list.slice(0, 3).map(row)}
                      {list.length > 3 && (
                        <details>
                          <summary>+ ещё {list.length - 3}</summary>
                          {list.slice(3).map(row)}
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {view === "year" && (
              <>
                <p className="hint">
                  Фактически отработанное время за день ·{" "}
                  <span className="heat-legend">
                    {[[0, "0"], [1, "0,001–3"], [2, "3–6"], [3, "6–8"], [4, "8+ ч"]].map(([level, text]) => (
                      <span key={level}><i className={`level-${level}`} />{text}</span>
                    ))}
                  </span>
                </p>
                <div className="year-grid">
                  {Array.from({ length: 12 }, (_, i) =>
                    chosen.startOf("year").plus({ months: i }),
                  ).map((month) => (
                    <section key={month.month}>
                      <h3>{month.setLocale("ru").toFormat("LLLL")}</h3>
                      <div className="heat-grid">
                        {["П", "В", "С", "Ч", "П", "С", "В"].map((d, i) => (
                          <small key={i}>{d}</small>
                        ))}
                        {Array.from({ length: month.weekday - 1 }, (_, i) => (
                          <i key={`blank${i}`} />
                        ))}
                        {Array.from({ length: month.daysInMonth! }, (_, i) =>
                          month.plus({ days: i }),
                        ).map((day) => {
                          const actualHours = stats?.actualByDay[day.toISODate()!] ?? 0;
                          return (
                            <button
                              key={day.day}
                              className={`heat level-${activityLevel(actualHours)}`}
                              title={`${day.toFormat("dd.MM.yyyy")}: ${actualHours > 0 ? humanDuration(actualHours) : "нет учтённого времени"}`}
                              onClick={() => {
                                setDate(day.toISODate()!);
                                setView("week");
                              }}
                            >
                              {day.day}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            )}
            {view === "period" && (
              <>
                <div className="filters">
                  <label>
                    С{" "}
                    <DateInput
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    По{" "}
                    <DateInput
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </div>
                <div className="period-list">
                  {Array.from(
                    {
                      length: Math.max(
                        0,
                        Math.min(
                          60,
                          Math.floor(
                            DateTime.fromISO(to).diff(
                              DateTime.fromISO(from),
                              "days",
                            ).days,
                          ) +
                            1 -
                            periodPage * 60,
                        ),
                      ),
                    },
                    (_, i) =>
                      dt(from, zone).plus({ days: i + periodPage * 60 }),
                  ).map((day) => {
                    const list = segments(filtered, day).map((s) => s.task);
                    return (
                      list.length > 0 && (
                        <section key={day.toISO()}>
                          <h3>
                            {day.setLocale("ru").toFormat("cccc, d MMMM")}{" "}
                            <small>
                              План{" "}
                              {(
                                stats?.planByDay[day.toISODate()!] || 0
                              ).toFixed(2)}{" "}
                              ч · Факт{" "}
                              {(
                                stats?.actualByDay[day.toISODate()!] || 0
                              ).toFixed(2)}{" "}
                              ч
                            </small>
                          </h3>
                          {list.map(row)}
                        </section>
                      )
                    );
                  })}
                  <p className="muted">
                    Страница {periodPage + 1}, до 60 дней на странице. Сводка
                    рассчитана за весь период. Задачи без даты — в боковой
                    панели.
                  </p>
                  <div className="inline">
                    <button
                      disabled={periodPage === 0}
                      onClick={() => setPeriodPage((p) => p - 1)}
                    >
                      Предыдущие 60 дней
                    </button>
                    <button
                      disabled={
                        dt(from, zone).plus({ days: (periodPage + 1) * 60 }) >
                        dt(to, zone)
                      }
                      onClick={() => setPeriodPage((p) => p + 1)}
                    >
                      Следующие 60 дней
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>
      {state && editors.map((editor, index) => (
        <TaskEditor
          key={editor.id}
          task={editor}
          active={index === editors.length - 1 && !pending}
          layer={index}
          activate={() => open(editor)}
          state={state}
          zone={zone}
          now={now}
          busy={busy}
          mutate={mutate}
          open={open}
          close={() => setEditors((windows) => windows.filter((w) => w.id !== editor.id))}
          removed={(id) => setUndo({ restore: id })}
        />
      ))}
      {state && showTemplates && (
        <TemplatesPanel templates={state.templates} busy={busy} mutate={mutate} close={() => setShowTemplates(false)} />
      )}
      {pending && (
        <div className="overlay decision">
          <section
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="decision-title"
          >
            <h2 id="decision-title">Проверьте изменения</h2>
            {pending.result.expanded.map((t) => (
              <p key={t.id}>
                Родитель «{t.title}» расширится: <b>{stamp(t)}</b>. Дочерние
                интервалы должны помещаться внутри него.
              </p>
            ))}
            {pending.result.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
            {pending.result.conflicts.length > 0 && (
              <>
                <p>
                  Интервалы пересекаются. Можно сохранить с пересечением или
                  отменить операцию.
                </p>
                {pending.result.conflicts.map((c, i) => (
                  <div className="conflict-detail" key={i}>
                    {[c.first, c.second].map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          void decide(false);
                          const existing = state?.tasks.find(
                            (x) => x.id === t.id,
                          );
                          if (existing) open(existing);
                        }}
                      >
                        {t.title}
                        <small>{stamp(t)}</small>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            )}
            <footer>
              <button autoFocus onClick={() => void decide(false)}>
                Отмена
              </button>
              <button className="primary" onClick={() => void decide(true)}>
                Подтвердить сохранение
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
