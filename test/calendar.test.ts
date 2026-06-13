import { describe, it, expect } from "vitest";
import { getCalendar } from "../src/calendar";

describe("calendar", () => {
  it("returns lunar date for a normal day", () => {
    const cal = getCalendar("2026-05-24");
    expect(cal.date).toBe("2026-05-24");
    expect(cal.weekday).toBe("周日");
    expect(cal.lunarDate).toBe("四月初八");
  });

  it("detects Spring Festival", () => {
    const cal = getCalendar("2026-02-17");
    expect(cal.festival).toBe("春节");
    expect(cal.lunarDate).toBe("正月初一");
  });

  it("detects Dragon Boat Festival", () => {
    const cal = getCalendar("2026-06-19");
    expect(cal.festival).toBe("端午节");
  });

  it("detects Mid-Autumn Festival", () => {
    const cal = getCalendar("2026-09-25");
    expect(cal.festival).toBe("中秋节");
  });

  it("detects Qingming Festival via solar term", () => {
    const cal = getCalendar("2026-04-05");
    expect(cal.festival).toBe("清明节");
  });

  it("returns undefined festival for normal day", () => {
    const cal = getCalendar("2026-05-24");
    expect(cal.festival).toBeUndefined();
  });
});
