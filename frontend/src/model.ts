import { DateTime } from "luxon";
export interface Task {
  id: string;
  parentId: string | null;
  seriesId: string | null;
  title: string;
  description: string;
  assignee: string;
  priority: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  sortOrder: number;
  exception: boolean;
  occurrenceDate: string | null;
}
export interface Checklist {
  id: string;
  taskId: string;
  title: string;
  sortOrder: number;
}
export interface Item {
  id: string;
  checklistId: string;
  text: string;
  done: boolean;
  sortOrder: number;
}
export interface Comment {
  id: string;
  taskId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}
export interface Entry {
  id: string;
  taskId: string;
  source: string;
  startAt: string | null;
  endAt: string | null;
  workDate: string | null;
  seconds: number;
}
export interface Series {
  id: string;
  templateId: string;
  frequency: string;
  zone: string;
  weekdays: number[];
  count: number;
  until: string | null;
}
export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  assignee: string;
  priority: string;
  checklistItems: string[];
}
export interface AuditEntry {
  id: string;
  taskId: string;
  createdAt: string;
  revision: number;
  sequence: number;
  action: string;
  detail: string;
}
export interface State {
  schemaVersion: number;
  revision: number;
  tasks: Task[];
  checklists: Checklist[];
  items: Item[];
  comments: Comment[];
  entries: Entry[];
  series: Series[];
  templates: TaskTemplate[];
  audit: AuditEntry[];
  timer: { taskId: string | null; startedAt: string | null; state: string };
}
export interface Conflict {
  first: Task;
  second: Task;
}
export interface Result {
  state: State;
  conflicts: Conflict[];
  expanded: Task[];
  warnings: string[];
  saved: boolean;
}
export interface Stats {
  plannedHours: number;
  actualHours: number;
  deviation: number;
  count: number;
  done: number;
  planByDay: Record<string, number>;
  actualByDay: Record<string, number>;
}
export const statuses: Record<string, string> = {
  PLANNED: "Запланирована",
  IN_PROGRESS: "В работе",
  DONE: "Выполнена",
  CANCELED: "Отменена",
};
export const priorities: Record<string, string> = {
  LOW: "Низкий",
  NORMAL: "Обычный",
  HIGH: "Высокий",
  CRITICAL: "Критический",
};
export const uid = () => crypto.randomUUID();
export const dt = (v: string, zone: string) => DateTime.fromISO(v, { zone });
export const iso = (v: DateTime) => v.toUTC().toISO()!;
export const overdue = (t: Task, now: number) =>
  !!t.endAt &&
  Date.parse(t.endAt) < now &&
  !["DONE", "CANCELED"].includes(t.status);
export function fresh(
  startAt: string | null = null,
  endAt: string | null = null,
  parentId: string | null = null,
): Task {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: "",
    description: "",
    assignee: "Я",
    priority: "NORMAL",
    status: "PLANNED",
    startAt,
    endAt,
    parentId,
    seriesId: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    exception: false,
    occurrenceDate: null,
  };
}
export function descendants(tasks: Task[], id: string): Task[] {
  const children = tasks.filter((t) => t.parentId === id && !t.deletedAt);
  return children.flatMap((t) => [t, ...descendants(tasks, t.id)]);
}
export function hours(
  state: State,
  id: string,
  now: number,
  total = false,
): number {
  const ids = new Set([
    id,
    ...(total ? descendants(state.tasks, id).map((t) => t.id) : []),
  ]);
  let seconds = state.entries
    .filter((e) => ids.has(e.taskId))
    .reduce((sum, e) => sum + e.seconds, 0);
  if (
    state.timer.state === "RUNNING" &&
    state.timer.taskId &&
    ids.has(state.timer.taskId)
  )
    seconds += Math.max(0, (now - Date.parse(state.timer.startedAt!)) / 1000);
  return seconds / 3600;
}

export function humanDuration(hoursValue: number): string {
  const totalSeconds = Math.max(0, Math.floor(hoursValue * 3600));
  const hoursPart = Math.floor(totalSeconds / 3600);
  const minutesPart = Math.floor((totalSeconds % 3600) / 60);
  const secondsPart = totalSeconds % 60;
  if (hoursPart > 0)
    return `${hoursPart} ч ${String(minutesPart).padStart(2, "0")} мин ${String(secondsPart).padStart(2, "0")} сек`;
  if (minutesPart > 0)
    return `${minutesPart} мин ${String(secondsPart).padStart(2, "0")} сек`;
  return `${secondsPart} сек`;
}

export function activityLevel(actualHours: number): 0 | 1 | 2 | 3 | 4 {
  if (actualHours < 0.001) return 0;
  if (actualHours < 3) return 1;
  if (actualHours < 6) return 2;
  if (actualHours < 8) return 3;
  return 4;
}
export interface Segment {
  task: Task;
  start: number;
  end: number;
  column: number;
  columns: number;
}
// Interval graph colouring, independently for each connected overlap group.
export function segments(tasks: Task[], day: DateTime): Segment[] {
  const end = day.plus({ days: 1 }).toMillis();
  const result: Segment[] = tasks
    .filter(
      (t) =>
        t.startAt &&
        t.endAt &&
        Date.parse(t.startAt) < end &&
        Date.parse(t.endAt) > day.toMillis(),
    )
    .map((task) => ({
      task,
      start: Math.max(Date.parse(task.startAt!), day.toMillis()),
      end: Math.min(Date.parse(task.endAt!), end),
      column: 0,
      columns: 1,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: Segment[] = [];
  let groupEnd = -Infinity;
  const finish = () => {
    const ends: number[] = [];
    for (const seg of group) {
      let col = ends.findIndex((e) => e <= seg.start);
      if (col < 0) col = ends.length;
      seg.column = col;
      ends[col] = seg.end;
    }
    group.forEach((s) => (s.columns = ends.length));
    group = [];
  };
  for (const seg of result) {
    if (seg.start >= groupEnd) {
      finish();
      groupEnd = seg.end;
    }
    group.push(seg);
    groupEnd = Math.max(groupEnd, seg.end);
  }
  finish();
  return result;
}
