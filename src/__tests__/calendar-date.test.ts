import { test, expect, describe } from "bun:test";
import { parseCalendarDate } from "../cli";

describe("parseCalendarDate", () => {
  test("YYYY-MM-DD string returns local midnight, not UTC midnight", () => {
    // The bug: new Date("2026-02-10") creates UTC midnight
    // which is Feb 9 7pm in EST. We need local midnight Feb 10.
    const result = parseCalendarDate("2026-02-10");

    // Should be Feb 10 in local timezone
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // 0-indexed, so 1 = February
    expect(result.getDate()).toBe(10);

    // Should be midnight local time
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  test("today returns local midnight", () => {
    const result = parseCalendarDate("today");
    const now = new Date();
    expect(result.getDate()).toBe(now.getDate());
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  test("tomorrow returns next day local midnight", () => {
    const result = parseCalendarDate("tomorrow");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(result.getDate()).toBe(tomorrow.getDate());
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  test("various YYYY-MM-DD strings all return correct local date", () => {
    // Test several dates to rule out off-by-one edge cases
    const cases = [
      { input: "2026-01-01", year: 2026, month: 0, day: 1 },
      { input: "2026-12-31", year: 2026, month: 11, day: 31 },
      { input: "2026-03-15", year: 2026, month: 2, day: 15 },
    ];

    for (const { input, year, month, day } of cases) {
      const result = parseCalendarDate(input);
      expect(result.getFullYear()).toBe(year);
      expect(result.getMonth()).toBe(month);
      expect(result.getDate()).toBe(day);
      expect(result.getHours()).toBe(0);
    }
  });

  test("full ISO datetime string still parses normally", () => {
    // A full ISO string with time/timezone should still work via Date constructor
    const result = parseCalendarDate("2026-02-10T14:30:00");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(10);
  });

  test("invalid date throws Error", () => {
    expect(() => parseCalendarDate("not-a-date")).toThrow("Invalid date: not-a-date");
  });
});
