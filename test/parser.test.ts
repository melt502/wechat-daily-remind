import { describe, it, expect } from "vitest";
import { parse } from "../src/parser";

describe("parser", () => {
  it("parses help command", () => {
    expect(parse("帮助")).toEqual({ kind: "help" });
    expect(parse("help")).toEqual({ kind: "help" });
    expect(parse("？")).toEqual({ kind: "help" });
  });

  it("parses add command with date and time", () => {
    const result = parse("跟导师开会 下周三 14:00");
    expect(result.kind).toBe("add");
    if (result.kind === "add") {
      expect(result.payload.text).toBe("跟导师开会");
      expect(result.payload.occursAt).toMatch(/^\d{4}-\d{2}-\d{2}T14:00:00$/);
    }
  });

  it("parses add command with relative date", () => {
    const result = parse("明天下午3点买菜");
    if (result.kind === "add") {
      expect(result.payload.text).toBe("买菜");
      expect(result.payload.occursAt).toMatch(/T15:00:00$/);
    }
  });

  it("parses add command with repeat rule", () => {
    const result = parse("每周三晚上7点阅读小组");
    if (result.kind === "add") {
      expect(result.payload.text).toBe("阅读小组");
      expect(result.payload.repeat).toEqual({ type: "weekly", spec: "3" });
    }
  });

  it("parses list command", () => {
    const result = parse("列表");
    expect(result.kind).toBe("list");
  });

  it("parses delete command", () => {
    const result = parse("删除 1");
    expect(result.kind).toBe("delete");
    if (result.kind === "delete") {
      expect(result.payload.index).toBe(1);
    }
  });

  it("parses festival names", () => {
    const result = parse("端午 买粽子");
    if (result.kind === "add") {
      expect(result.payload.text).toBe("买粽子");
      expect(result.payload.occursAt).toBe("2026-06-19T00:00:00");
    }
  });

  it("defaults to add command for unknown input", () => {
    const result = parse("随便写点东西");
    expect(result.kind).toBe("add");
  });

  it("parses long mixed multi-segment input with shared date", () => {
    const result = parse(
      "2026-05-27(周三)8:30起床，9:30去图书馆学习，上午先改论文框架下午填写论文内容、看课，12:00芒果tv抢云包场，13:00腾讯抢云包场",
    );
    expect(result.kind).toBe("batch_add");
    if (result.kind === "batch_add") {
      const items = result.payload.items;
      expect(items).toHaveLength(5);
      expect(items[0]).toMatchObject({ text: "起床", occursAt: "2026-05-27T08:30:00" });
      expect(items[1]).toMatchObject({ text: "去图书馆学习", occursAt: "2026-05-27T09:30:00" });
      expect(items[3]).toMatchObject({ text: "芒果tv抢云包场", occursAt: "2026-05-27T12:00:00" });
      expect(items[4]).toMatchObject({ text: "腾讯抢云包场", occursAt: "2026-05-27T13:00:00" });
      for (const it of items) expect(it.text).not.toMatch(/^\(\)/);
    }
  });

  it("splits adjacent timed tasks even without punctuation", () => {
    const result = parse("2026-05-27 8:30起床 9:30去图书馆学习 12:00芒果tv抢云包场");
    expect(result.kind).toBe("batch_add");
    if (result.kind === "batch_add") {
      expect(result.payload.items).toEqual([
        { text: "起床", occursAt: "2026-05-27T08:30:00" },
        { text: "去图书馆学习", occursAt: "2026-05-27T09:30:00" },
        { text: "芒果tv抢云包场", occursAt: "2026-05-27T12:00:00" },
      ]);
    }
  });

  it("keeps punctuation-only continuation as one task", () => {
    const result = parse("明天下午3点买菜，顺便买牛奶");
    expect(result.kind).toBe("add");
    if (result.kind === "add") {
      expect(result.payload.text).toBe("买菜，顺便买牛奶");
      expect(result.payload.occursAt).toMatch(/T15:00:00$/);
    }
  });

  it("parses list ranges for student reminder views", () => {
    expect(parse("查看今天")).toEqual({ kind: "list", payload: { range: "today" } });
    expect(parse("查看明天")).toEqual({ kind: "list", payload: { range: "tomorrow" } });
    expect(parse("查看本周")).toEqual({ kind: "list", payload: { range: "week" } });
    expect(parse("查看全部")).toEqual({ kind: "list", payload: { range: "all" } });
    expect(parse("查看提醒")).toEqual({ kind: "list", payload: { range: "recent" } });
    expect(parse("最近提醒")).toEqual({ kind: "list", payload: { range: "recent" } });
  });

  it("parses update command shape", () => {
    const result = parse("修改第2条为下周五晚8点交论文");
    expect(result.kind).toBe("update");
    if (result.kind === "update") {
      expect(result.payload.index).toBe(2);
      expect(result.payload.next.text).toBe("交论文");
      expect(result.payload.next.occursAt).toMatch(/T20:00:00$/);
    }
  });

  it("adds ambiguity metadata for missing time", () => {
    const result = parse("提醒我交作业");
    expect(result.kind).toBe("add");
    if (result.kind === "add") {
      expect(result.payload.text).toBe("交作业");
      expect(result.payload.ambiguity).toContain("missing-time");
    }
  });
});
