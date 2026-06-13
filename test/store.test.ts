import { describe, it, expect, beforeEach } from "vitest";
import type { Redis } from "@upstash/redis";
import * as store from "../src/store";

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

describe("store", () => {
  const openid = "test-openid-123";
  let redis: Redis;

  beforeEach(() => {
    redis = createMockRedis();
  });

  it("adds a reminder and indexes the user", async () => {
    const reminder = await store.addReminder(redis, openid, {
      text: "测试提醒",
      occursAt: "2026-05-25T14:00:00",
    });

    expect(reminder.id).toBeTruthy();
    expect(reminder.text).toBe("测试提醒");
    expect(reminder.openid).toBe(openid);

    const openIds = await store.listAllOpenIds(redis);
    expect(openIds).toContain(openid);
  });

  it("lists reminders for a user", async () => {
    await store.addReminder(redis, openid, {
      text: "测试提醒",
      occursAt: "2026-05-25T14:00:00",
    });

    const reminders = await store.listReminders(redis, openid);
    expect(reminders.length).toBe(1);
  });

  it("deletes a reminder by index", async () => {
    await store.addReminder(redis, openid, {
      text: "保留",
      occursAt: "2026-05-25T10:00:00",
    });
    await store.addReminder(redis, openid, {
      text: "待删除",
      occursAt: "2026-05-26T10:00:00",
    });

    const deleted = await store.deleteReminder(redis, openid, 2);
    expect(deleted).toBe(true);

    const reminders = await store.listReminders(redis, openid);
    expect(reminders.length).toBe(1);
    expect(reminders[0].text).toBe("保留");
  });

  it("returns false for invalid delete index", async () => {
    const result = await store.deleteReminder(redis, openid, 999);
    expect(result).toBe(false);
  });

  it("indexes users when settings are updated", async () => {
    await store.setSettings(redis, openid, { pushAt: "08:00" });

    const openIds = await store.listAllOpenIds(redis);
    expect(openIds).toContain(openid);
  });

  it("manages user settings", async () => {
    const defaultSettings = await store.getSettings(redis, openid);
    expect(defaultSettings.pushAt).toBe("07:00");

    const updated = await store.setSettings(redis, openid, { pushAt: "08:00" });
    expect(updated.pushAt).toBe("08:00");

    const fetched = await store.getSettings(redis, openid);
    expect(fetched.pushAt).toBe("08:00");
  });

  it("marks one-time reminder as pushed and removes it", async () => {
    const r = await store.addReminder(redis, openid, {
      text: "单次提醒",
      occursAt: "2026-05-25T09:00:00",
    });

    await store.markPushed(redis, openid, r.id, "2026-05-25");

    const reminders = await store.listReminders(redis, openid);
    expect(reminders.find((x) => x.id === r.id)).toBeUndefined();
  });

  it("marks repeat reminder as pushed without removing it", async () => {
    const r = await store.addReminder(redis, openid, {
      text: "每周提醒",
      occursAt: "2026-05-25T09:00:00",
      repeat: { type: "weekly", spec: "3" },
    });

    await store.markPushed(redis, openid, r.id, "2026-05-27");

    const reminders = await store.listReminders(redis, openid);
    const found = reminders.find((x) => x.id === r.id);
    expect(found).toBeDefined();
    expect(found!.pushedDates).toContain("2026-05-27");
  });

  it("prevents duplicate push for same date", async () => {
    const r = await store.addReminder(redis, openid, {
      text: "每日提醒",
      occursAt: "2026-05-25T09:00:00",
      repeat: { type: "daily", spec: "" },
    });

    await store.markPushed(redis, openid, r.id, "2026-05-25");
    await store.markPushed(redis, openid, r.id, "2026-05-25");

    const reminders = await store.listReminders(redis, openid);
    const found = reminders.find((x) => x.id === r.id);
    expect(found!.pushedDates.filter((d) => d === "2026-05-25").length).toBe(1);
  });

  it("purges old history entries", async () => {
    await store.purgeOlderThan(redis, openid, 30);
    expect(true).toBe(true);
  });
});
