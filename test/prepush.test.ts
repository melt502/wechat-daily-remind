import { describe, it, expect } from "vitest";
import type { Redis } from "@upstash/redis";
import { formatPrePush } from "../src/formatter";
import { markPrePushed, getPrePushedIds } from "../src/store";
import type { Reminder } from "../src/types";

function createMockRedis(): Redis {
  const data = new Map<string, string>();
  return {
    get: async <T>(key: string): Promise<T | null> => {
      const val = data.get(key);
      if (val === undefined) return null;
      return JSON.parse(val) as T;
    },
    set: async (key: string, value: any, opts?: any): Promise<any> => {
      data.set(key, typeof value === "string" ? value : JSON.stringify(value));
      return "OK";
    },
    del: async (...keys: string[]): Promise<number> => {
      let count = 0;
      for (const key of keys) {
        if (data.delete(key)) count++;
      }
      return count;
    },
  } as unknown as Redis;
}

describe("pre-push", () => {
  it("formatPrePush shows correct message", () => {
    const reminder: Reminder = {
      id: "test",
      openid: "test",
      text: "跟导师开会",
      occursAt: "2026-05-25T14:00:00",
      createdAt: "",
      pushedDates: [],
    };
    const msg = formatPrePush(reminder);
    expect(msg).toContain("⏰");
    expect(msg).toContain("14:00");
    expect(msg).toContain("跟导师开会");
    expect(msg).toContain("30分钟");
  });

  it("markPrePushed prevents duplicate pre-push", async () => {
    const redis = createMockRedis();

    await markPrePushed(redis, "user1", "2026-05-25", "reminder-1");
    await markPrePushed(redis, "user1", "2026-05-25", "reminder-1");

    const ids = await getPrePushedIds(redis, "user1", "2026-05-25");
    expect(ids).toEqual(["reminder-1"]);
  });

  it("formatPrePush handles reminder without time", () => {
    const reminder: Reminder = {
      id: "test",
      openid: "test",
      text: "交作业",
      occursAt: "2026-05-25T00:00:00",
      createdAt: "",
      pushedDates: [],
    };
    const msg = formatPrePush(reminder);
    expect(msg).toContain("今天");
    expect(msg).toContain("交作业");
  });
});
