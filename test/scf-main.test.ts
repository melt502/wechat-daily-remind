import { beforeEach, describe, expect, it, vi } from "vitest";

const dailySummary = {
  phase: "daily" as const,
  dateStr: "2026-05-25",
  userCount: 1,
  eligibleUsers: 1,
  skippedNotInWindow: 0,
  skippedAlreadyPushed: 0,
  reminderCount: 1,
  sent: 1,
  failed: 0,
  failures: [],
};

const prePushSummary = {
  phase: "prePush" as const,
  dateStr: "2026-05-25",
  userCount: 1,
  candidateReminders: 1,
  skippedNoTime: 0,
  skippedNotInWindow: 0,
  skippedAlreadyPushed: 0,
  sent: 1,
  failed: 0,
  failures: [],
};

const runDaily = vi.fn();
const runPrePush = vi.fn();

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../src/daily", () => ({
  runDaily,
  runPrePush,
  combineJobSummaries: vi.fn((daily, prePush) => ({
    ranAt: "2026-05-24T23:30:00.000Z",
    dateStr: daily.dateStr,
    status: "ok",
    userCount: Math.max(daily.userCount, prePush.userCount),
    sent: daily.sent + prePush.sent,
    failed: daily.failed + prePush.failed,
    failureCounts: {
      "wechat-window-expired": 0,
      "wechat-token": 0,
      "wechat-send": 0,
      runtime: 0,
    },
    hints: [],
    failures: [...daily.failures, ...prePush.failures],
    daily,
    prePush,
  })),
}));

describe("SCF scheduled jobs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    runDaily.mockResolvedValue(dailySummary);
    runPrePush.mockResolvedValue(prePushSummary);
    process.env.UPSTASH_REDIS_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_TOKEN = "token";
    process.env.WX_APPID = "appid";
    process.env.WX_SECRET = "secret";
    process.env.QWEATHER_KEY = "weather";
  });

  it("returns a JSON summary from /cron", async () => {
    const { main_handler } = await import("../scf-main");

    const response = await main_handler({
      httpMethod: "GET",
      path: "/cron",
      headers: { host: "example.com" },
    }, {});

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.summary).toMatchObject({
      dateStr: "2026-05-25",
      status: "ok",
      userCount: 1,
      sent: 2,
      failed: 0,
      failureCounts: { "wechat-window-expired": 0 },
      hints: [],
    });
  });

  it("logs the summary for Timer events", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { main_handler } = await import("../scf-main");

    await expect(main_handler({ Type: "Timer" }, {})).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith("[timer] summary", expect.stringContaining("\"sent\":2"));
  });
});
