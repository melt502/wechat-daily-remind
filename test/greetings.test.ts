import { describe, it, expect } from "vitest";
import { pick } from "../src/greetings";

describe("greetings", () => {
  it("returns generic greeting for reply slot", () => {
    const result = pick("reply", { isRainy: false, isWeekend: false, isClearLike: true });
    expect(["老板", "朋友", "亲爱的大人", "这位同学", "老铁"]).toContain(result);
  });

  it("returns rainy greeting for rainy morning", () => {
    const result = pick("morning", { isRainy: true, isWeekend: false, isClearLike: false });
    expect(["记得带伞", "下雨天别淋着了"]).toContain(result);
  });

  it("returns sunny greeting for sunny morning", () => {
    const result = pick("morning", { isRainy: false, isWeekend: false, isClearLike: true });
    expect(["元气老板早", "早上好呀，今天也是元气满满的一天"]).toContain(result);
  });

  it("never returns sunny greeting in rainy sign context", () => {
    for (let i = 0; i < 100; i++) {
      const result = pick("sign", { isRainy: true, isWeekend: false, isClearLike: false });
      expect(result).not.toMatch(/撒野|出去走走|好天气/);
    }
  });

  it("returns weekday greeting for weekday context", () => {
    const result = pick("sign", { isRainy: false, isWeekend: false, isClearLike: false });
    expect(result).toBe("搬砖快乐");
  });

  it("returns multiple greeting texts over repeated calls", () => {
    const results = new Set(
      Array.from({ length: 50 }, () =>
        pick("reply", { isRainy: false, isWeekend: false, isClearLike: true }),
      ),
    );
    expect(results.size).toBeGreaterThan(1);
  });
});
