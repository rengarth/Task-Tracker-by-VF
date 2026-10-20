import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { fresh, segments, overdue, hours, humanDuration, activityLevel, State } from "./model";
describe("calendar interval layout", () => {
  const day = DateTime.fromISO("2026-10-12", { zone: "UTC" });
  it("has proportional height, not fixed slots", () => {
    const t = fresh("2026-10-12T14:00:00Z", "2026-10-12T17:30:00Z");
    const s = segments([t], day)[0];
    expect((s.end - s.start) / 60000).toBe(210);
  });
  it("places intersecting blocks side by side", () => {
    const tasks = [
      fresh("2026-10-12T14:00:00Z", "2026-10-12T17:30:00Z"),
      fresh("2026-10-12T15:00:00Z", "2026-10-12T16:00:00Z"),
    ];
    const s = segments(tasks, day);
    expect(s.map((x) => x.column)).toEqual([0, 1]);
    expect(s.every((x) => x.columns === 2)).toBe(true);
  });
  it("does not treat touching boundaries as overlap", () => {
    const s = segments(
      [
        fresh("2026-10-12T14:00:00Z", "2026-10-12T15:00:00Z"),
        fresh("2026-10-12T15:00:00Z", "2026-10-12T16:00:00Z"),
      ],
      day,
    );
    expect(s.every((x) => x.columns === 1)).toBe(true);
  });
  it("splits midnight and keeps the same identity", () => {
    const t = fresh("2026-10-12T23:00:00Z", "2026-10-13T02:00:00Z");
    expect(
      (segments([t], day)[0].end - segments([t], day)[0].start) / 3600000,
    ).toBe(1);
    expect(segments([t], day.plus({ days: 1 }))[0].task.id).toBe(t.id);
  });
  it("uses elapsed time on the 25 hour day", () => {
    const d = DateTime.fromISO("2026-10-25", { zone: "Europe/Berlin" });
    const t = fresh(d.toISO(), d.plus({ days: 1 }).toISO());
    expect(
      (segments([t], d)[0].end - segments([t], d)[0].start) / 3600000,
    ).toBe(25);
  });
  it("updates overdue at the strict end boundary", () => {
    const t = fresh("2026-10-12T14:00:00Z", "2026-10-12T15:00:00Z");
    expect(overdue(t, Date.parse(t.endAt!))).toBe(false);
    expect(overdue(t, Date.parse(t.endAt!) + 1)).toBe(true);
    t.status = "DONE";
    expect(overdue(t, Date.now() + 1e12)).toBe(false);
  });
  it("rolls actual time up the tree exactly once", () => {
    const a = fresh(),
      b = fresh(null, null, a.id),
      c = fresh(null, null, b.id);
    const s = {
      tasks: [a, b, c],
      entries: [
        { taskId: a.id, seconds: 3600 },
        { taskId: b.id, seconds: 1800 },
        { taskId: c.id, seconds: 900 },
      ],
      timer: { state: "STOPPED" },
    } as State;
    expect(hours(s, a.id, 0, true)).toBe(1.75);
    expect(hours(s, a.id, 0, false)).toBe(1);
  });
  it("formats elapsed time in human units", () => {
    expect(humanDuration(5 / 3600)).toBe("5 сек");
    expect(humanDuration(65 / 3600)).toBe("1 мин 05 сек");
    expect(humanDuration(7384 / 3600)).toBe("2 ч 03 мин 04 сек");
  });
  it("colors yearly activity by actual hours at the requested boundaries", () => {
    expect([0, 0.0009, 0.001, 2.999, 3, 5.999, 6, 7.999, 8, 12].map(activityLevel))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});
