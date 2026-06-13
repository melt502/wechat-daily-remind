import { describe, it, expect } from "vitest";
import { formatHelp, formatAddReply, formatDailyPush } from "../src/formatter";

describe("formatter", () => {
  it("formatHelp returns expected content", () => {
    const help = formatHelp();
    expect(help).toContain("添加提醒");
    expect(help).toContain("查看列表");
    expect(help).toContain("删除");
  });

  it("formatAddReply includes greeting and details", () => {
    const result = formatAddReply("老板", "跟导师开会", "2026-06-03", "周三", "14:00");
    expect(result).toContain("老板");
    expect(result).toContain("2026-06-03");
    expect(result).toContain("周三");
    expect(result).toContain("14:00");
    expect(result).toContain("跟导师开会");
  });

  it("formatDailyPush handles empty reminders", () => {
    const push = formatDailyPush({
      greeting: "老板",
      signature: "又是美好的一天",
      calendar: { date: "2026-05-24", weekday: "周日", lunarDate: "四月初八" },
      weather: undefined,
      reminders: [],
      lunch: { location: "东一食堂", meal: "水煮肉片", comment: "好吃" },
      dinner: { location: "广八路", meal: "烤鱼", comment: "不错" },
    });
    expect(push).toContain("闲人");
    expect(push).not.toContain("undefined");
    expect(push).not.toContain("NaN");
  });

  it("formatDailyPush omits weather section when weather is undefined", () => {
    const push = formatDailyPush({
      greeting: "老板",
      signature: "好心情",
      calendar: { date: "2026-05-24", weekday: "周日", lunarDate: "四月初八" },
      weather: undefined,
      reminders: [{ id: "1", openid: "test", text: "开会", occursAt: "2026-05-24T14:00:00", createdAt: "", pushedDates: [] }],
      lunch: { location: "东一食堂", meal: "水煮肉片", comment: "好吃" },
      dinner: { location: "广八路", meal: "烤鱼", comment: "不错" },
    });
    expect(push).not.toContain("℃");
    expect(push).not.toContain("降水");
  });

  it("formatDailyPush includes weather section when provided", () => {
    const push = formatDailyPush({
      greeting: "老板",
      signature: "好心情",
      calendar: { date: "2026-05-24", weekday: "周日", lunarDate: "四月初八" },
      weather: { text: "多云", tempMax: 28, tempMin: 20, precipProb: 10, willRain: false, isClearLike: true, needUmbrella: false },
      reminders: [],
      lunch: { location: "东一食堂", meal: "水煮肉片", comment: "好吃" },
      dinner: { location: "广八路", meal: "烤鱼", comment: "不错" },
    });
    expect(push).toContain("多云");
    expect(push).toContain("28℃");
    expect(push).toContain("降水");
  });

  it("formatDailyPush includes umbrella suggestion when needed", () => {
    const push = formatDailyPush({
      greeting: "老板",
      signature: "好心情",
      calendar: { date: "2026-05-24", weekday: "周日", lunarDate: "四月初八" },
      weather: { text: "大雨", tempMax: 22, tempMin: 18, precipProb: 80, willRain: true, isClearLike: false, needUmbrella: true },
      reminders: [],
      lunch: { location: "东一食堂", meal: "水煮肉片", comment: "好吃" },
      dinner: { location: "广八路", meal: "烤鱼", comment: "不错" },
    });
    expect(push).toContain("带伞");
  });
});
