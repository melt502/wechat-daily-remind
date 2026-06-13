import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "@upstash/redis";
import * as store from "../src/store";
import { runDaily, runPrePush, combineJobSummaries } from "../src/daily";
import { sendText } from "../src/pusher";

vi.mock("../src/weather", () => ({
  fetchWeather: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/pusher", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
}));

function createMockRedis(): Redis {
  const data = new Map<string, string>();
  return {
    get: async <T>(key: string): Promise<T | null> => {
      const val = data.get(key);
      if (val === undefined) return null;
      return JSON.parse(val) as T;
    },
    set: async (key: string, value: any): Promise<any> => {
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

function setShanghaiTime(dateTime: string): void {
  vi.setSystemTime(new Date(`${dateTime}+08:00`));
}

const env = {
  WX_APPID: "appid",
  WX_SECRET: "secret",
  QWEATHER_KEY: "qweather-key",
  QWEATHER_HOST: "qweather-host",
};

describe("daily jobs", () => {
  let redis: Redis;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(sendText).mockReset();
    vi.mocked(sendText).mockResolvedValue(undefined);
    redis = createMockRedis();
  });

  it("daily summary does not consume one-time reminders", async () => {
    setShanghaiTime("2026-05-25T07:05:00");
    const reminder = await store.addReminder(redis, "user1", {
      text: "下午开会",
      occursAt: "2026-05-25T14:00:00",
    });

    const summary = await runDaily(redis, env);

    expect(sendText).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({ eligibleUsers: 1, reminderCount: 1, sent: 1, failed: 0 });
    const reminders = await store.listReminders(redis, "user1");
    expect(reminders.find((r) => r.id === reminder.id)).toBeDefined();
  });

  it("pre-push still sends after the daily summary", async () => {
    setShanghaiTime("2026-05-25T07:05:00");
    await store.addReminder(redis, "user1", {
      text: "下午开会",
      occursAt: "2026-05-25T14:00:00",
    });
    await runDaily(redis, env);

    setShanghaiTime("2026-05-25T13:30:00");
    const summary = await runPrePush(redis, env);

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ candidateReminders: 1, sent: 1, failed: 0 });
    expect(vi.mocked(sendText).mock.calls[1][4]).toContain("下午开会");
    expect(await store.getPrePushedIds(redis, "user1", "2026-05-25")).toHaveLength(1);
    expect(await store.listReminders(redis, "user1")).toEqual([]);
  });

  it("pre-push deduplicates repeated cron invocations in the window", async () => {
    setShanghaiTime("2026-05-25T13:30:00");
    await store.addReminder(redis, "user1", {
      text: "下午开会",
      occursAt: "2026-05-25T14:00:00",
    });

    await runPrePush(redis, env);
    setShanghaiTime("2026-05-25T13:35:00");
    const summary = await runPrePush(redis, env);

    expect(sendText).toHaveBeenCalledOnce();
    expect(summary.skippedAlreadyPushed).toBe(0);
    expect(summary.candidateReminders).toBe(0);
  });

  it("repeat reminders survive daily summary and are marked after pre-push", async () => {
    setShanghaiTime("2026-05-25T07:05:00");
    const reminder = await store.addReminder(redis, "user1", {
      text: "每日站会",
      occursAt: "2026-05-25T14:00:00",
      repeat: { type: "daily", spec: "" },
    });

    await runDaily(redis, env);
    let reminders = await store.listReminders(redis, "user1");
    expect(reminders.find((r) => r.id === reminder.id)?.pushedDates).toEqual([]);

    setShanghaiTime("2026-05-25T13:30:00");
    await runPrePush(redis, env);

    reminders = await store.listReminders(redis, "user1");
    expect(reminders.find((r) => r.id === reminder.id)?.pushedDates).toContain("2026-05-25");
  });

  it("daily summary reports users skipped outside the push window", async () => {
    setShanghaiTime("2026-05-25T08:00:00");
    await store.addReminder(redis, "user1", {
      text: "下午开会",
      occursAt: "2026-05-25T14:00:00",
    });

    const summary = await runDaily(redis, env);

    expect(sendText).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ userCount: 1, skippedNotInWindow: 1, sent: 0, failed: 0 });
  });

  it("pre-push reports no-time and outside-window skips", async () => {
    setShanghaiTime("2026-05-25T13:30:00");
    await store.addReminder(redis, "user1", {
      text: "全天事项",
      occursAt: "2026-05-25T00:00:00",
    });
    await store.addReminder(redis, "user1", {
      text: "晚上开会",
      occursAt: "2026-05-25T20:00:00",
    });

    const summary = await runPrePush(redis, env);

    expect(summary).toMatchObject({ candidateReminders: 2, skippedNoTime: 1, skippedNotInWindow: 1, sent: 0 });
  });

  it("combines summaries with failure counts and actionable hints", async () => {
    setShanghaiTime("2026-05-25T13:30:00");
    await store.addReminder(redis, "user1", {
      text: "下午开会",
      occursAt: "2026-05-25T14:00:00",
    });
    vi.mocked(sendText).mockRejectedValueOnce(new Error("WeChat customer-service window expired for user1: 45015 response out of time limit"));

    const daily = await runDaily(redis, env);
    const prePush = await runPrePush(redis, env);
    const combined = combineJobSummaries(daily, prePush);

    expect(combined).toMatchObject({
      status: "failed",
      failed: 1,
      failureCounts: { "wechat-window-expired": 1 },
    });
    expect(combined.hints).toContain("WeChat customer-service window expired; long-term proactive reminders need a different push channel.");
  });
});
