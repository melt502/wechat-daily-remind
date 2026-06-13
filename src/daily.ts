import { Redis } from "@upstash/redis";
import type { Reminder } from "./types";
import * as store from "./store";
import { fetchWeather } from "./weather";
import { getCalendar } from "./calendar";
import { pickLunch, pickDinner } from "./meals";
import { pick } from "./greetings";
import { formatDailyPush, formatPrePush } from "./formatter";
import { sendText } from "./pusher";

const DAILY_PUSH_WINDOW_MINUTES = 20;
const PRE_PUSH_LEAD_MINUTES = 30;
const PRE_PUSH_WINDOW_MINUTES = 20;

export type JobPhase = "daily" | "prePush";
export type FailureKind = "wechat-window-expired" | "wechat-token" | "wechat-send" | "runtime";

export type JobFailure = {
  phase: JobPhase;
  openid: string;
  reminderId?: string;
  kind: FailureKind;
  code?: number;
  message: string;
};

export type DailyJobSummary = {
  phase: "daily";
  dateStr: string;
  userCount: number;
  eligibleUsers: number;
  skippedNotInWindow: number;
  skippedAlreadyPushed: number;
  reminderCount: number;
  sent: number;
  failed: number;
  failures: JobFailure[];
};

export type PrePushJobSummary = {
  phase: "prePush";
  dateStr: string;
  userCount: number;
  candidateReminders: number;
  skippedNoTime: number;
  skippedNotInWindow: number;
  skippedAlreadyPushed: number;
  sent: number;
  failed: number;
  failures: JobFailure[];
};

export type JobRunStatus = "ok" | "warning" | "failed";

export type JobRunSummary = {
  ranAt: string;
  dateStr: string;
  status: JobRunStatus;
  userCount: number;
  sent: number;
  failed: number;
  failureCounts: Record<FailureKind, number>;
  hints: string[];
  failures: JobFailure[];
  daily: DailyJobSummary;
  prePush: PrePushJobSummary;
};

function getShanghaiNow(): { dateStr: string; totalMinutes: number } {
  const now = Date.now();
  const sh = new Date(now + 8 * 3600 * 1000);
  const y = sh.getUTCFullYear();
  const m = String(sh.getUTCMonth() + 1).padStart(2, "0");
  const d = String(sh.getUTCDate()).padStart(2, "0");
  const hour = sh.getUTCHours();
  const minute = sh.getUTCMinutes();
  return {
    dateStr: `${y}-${m}-${d}`,
    totalMinutes: hour * 60 + minute,
  };
}

function parseOccursMinutes(occursAt: string): number {
  const h = parseInt(occursAt.slice(11, 13), 10);
  const m = parseInt(occursAt.slice(14, 16), 10);
  return h * 60 + m;
}

function parseClockMinutes(clock: string): number {
  const m = clock.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 7 * 60;
  return +m[1] * 60 + +m[2];
}

function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

function dailyPushKey(openid: string, dateStr: string): string {
  return `user:${openid}:daily-push:${dateStr}`;
}

async function hasDailyPushed(redis: Redis, openid: string, dateStr: string): Promise<boolean> {
  return (await redis.get(dailyPushKey(openid, dateStr))) !== null;
}

async function markDailyPushed(redis: Redis, openid: string, dateStr: string): Promise<void> {
  await redis.set(dailyPushKey(openid, dateStr), "1", { ex: 36 * 3600 });
}

function classifyFailure(phase: JobPhase, openid: string, err: unknown, reminderId?: string): JobFailure {
  const message = err instanceof Error ? err.message : String(err);
  const codeMatch = message.match(/\b(\d{5})\b/);
  const code = codeMatch ? Number(codeMatch[1]) : undefined;
  let kind: FailureKind = "runtime";

  if (code === 45015) {
    kind = "wechat-window-expired";
  } else if (code === 40001 || code === 42001) {
    kind = "wechat-token";
  } else if (message.includes("WeChat")) {
    kind = "wechat-send";
  }

  return { phase, openid, ...(reminderId ? { reminderId } : {}), kind, ...(code ? { code } : {}), message };
}

function expandRepeatReminders(
  reminders: Reminder[],
  dateStr: string,
  options: { includePushed?: boolean } = {},
): Reminder[] {
  const d = new Date(dateStr + "T00:00:00");
  const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
  const dayOfMonth = d.getDate();
  const includePushed = options.includePushed ?? false;

  const expanded: Reminder[] = [];

  for (const r of reminders) {
    if (!r.repeat) {
      if (r.occursAt.slice(0, 10) === dateStr) {
        if (includePushed || !r.pushedDates.includes(dateStr)) {
          expanded.push(r);
        }
      }
      continue;
    }

    if (!includePushed && r.pushedDates.includes(dateStr)) continue;

    const { type, spec } = r.repeat;
    let matched = false;

    if (type === "weekly") {
      const specDay = parseInt(spec, 10);
      if (dayOfWeek === specDay) matched = true;
    } else if (type === "monthly") {
      const specDay = parseInt(spec, 10);
      if (dayOfMonth === specDay) matched = true;
    } else if (type === "daily") {
      matched = true;
    }

    if (matched) {
      const time = r.occursAt.slice(11);
      expanded.push({ ...r, occursAt: `${dateStr}T${time}` });
    }
  }

  return expanded;
}

export async function runDaily(
  redis: Redis,
  env: { WX_APPID: string; WX_SECRET: string; QWEATHER_KEY: string; QWEATHER_HOST: string },
): Promise<DailyJobSummary> {
  const { dateStr, totalMinutes: nowMinutes } = getShanghaiNow();
  const openIds = await store.listAllOpenIds(redis);
  const summary: DailyJobSummary = {
    phase: "daily",
    dateStr,
    userCount: openIds.length,
    eligibleUsers: 0,
    skippedNotInWindow: 0,
    skippedAlreadyPushed: 0,
    reminderCount: 0,
    sent: 0,
    failed: 0,
    failures: [],
  };

  const weather = await fetchWeather(redis, env.QWEATHER_KEY, env.QWEATHER_HOST, dateStr).catch((err) => {
    console.log("Weather fetch error:", err instanceof Error ? err.message : String(err));
    return undefined;
  });
  const calendar = getCalendar(dateStr);

  for (const openid of openIds) {
    try {
      const settings = await store.getSettings(redis, openid);
      await store.purgeExpiredOneTimeReminders(redis, openid, `${dateStr}T${String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:${String(nowMinutes % 60).padStart(2, "0")}:00`);
      const pushMinutes = parseClockMinutes(settings.pushAt);
      if (nowMinutes < pushMinutes || nowMinutes > pushMinutes + DAILY_PUSH_WINDOW_MINUTES) {
        summary.skippedNotInWindow += 1;
        continue;
      }
      if (await hasDailyPushed(redis, openid, dateStr)) {
        summary.skippedAlreadyPushed += 1;
        continue;
      }

      summary.eligibleUsers += 1;
      const allReminders = await store.listReminders(redis, openid);
      const todayReminders = expandRepeatReminders(allReminders, dateStr, { includePushed: true });
      summary.reminderCount += todayReminders.length;

      const isClearLike = weather?.isClearLike ?? false;
      const context = {
        isRainy: weather?.willRain ?? false,
        isWeekend: isWeekend(dateStr),
        isClearLike,
      };

      const greeting = pick("morning", context);
      const signature = pick("sign", context);
      const lunch = pickLunch(dateStr, isClearLike);
      const dinner = pickDinner(dateStr, isClearLike);

      const message = formatDailyPush({
        greeting,
        signature,
        calendar,
        weather,
        reminders: todayReminders,
        lunch,
        dinner,
      });

      await sendText(redis, env.WX_APPID, env.WX_SECRET, openid, message);
      summary.sent += 1;
      await markDailyPushed(redis, openid, dateStr);

      await store.purgeOlderThan(redis, openid, 30);
    } catch (err) {
      const failure = classifyFailure("daily", openid, err);
      summary.failed += 1;
      summary.failures.push(failure);
      console.log(`Daily push error for ${openid}:`, failure);
    }
  }

  return summary;
}

export async function runPrePush(
  redis: Redis,
  env: { WX_APPID: string; WX_SECRET: string },
): Promise<PrePushJobSummary> {
  const { dateStr, totalMinutes: nowMinutes } = getShanghaiNow();
  const openIds = await store.listAllOpenIds(redis);
  const summary: PrePushJobSummary = {
    phase: "prePush",
    dateStr,
    userCount: openIds.length,
    candidateReminders: 0,
    skippedNoTime: 0,
    skippedNotInWindow: 0,
    skippedAlreadyPushed: 0,
    sent: 0,
    failed: 0,
    failures: [],
  };

  for (const openid of openIds) {
    try {
      await store.purgeExpiredOneTimeReminders(redis, openid, `${dateStr}T${String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:${String(nowMinutes % 60).padStart(2, "0")}:00`);
      const allReminders = await store.listReminders(redis, openid);
      const todayReminders = expandRepeatReminders(allReminders, dateStr);
      const alreadyPrePushed = await store.getPrePushedIds(redis, openid, dateStr);
      summary.candidateReminders += todayReminders.length;

      for (const r of todayReminders) {
        const reminderMinutes = parseOccursMinutes(r.occursAt);

        if (reminderMinutes === 0) {
          summary.skippedNoTime += 1;
          continue;
        }

        const targetMinutes = reminderMinutes - PRE_PUSH_LEAD_MINUTES;
        if (nowMinutes < targetMinutes || nowMinutes >= targetMinutes + PRE_PUSH_WINDOW_MINUTES) {
          summary.skippedNotInWindow += 1;
          continue;
        }

        if (alreadyPrePushed.includes(r.id)) {
          summary.skippedAlreadyPushed += 1;
          continue;
        }

        try {
          const message = formatPrePush(r);
          await sendText(redis, env.WX_APPID, env.WX_SECRET, openid, message);
          summary.sent += 1;
          await store.markPrePushed(redis, openid, dateStr, r.id);
          await store.markPushed(redis, openid, r.id, dateStr);
        } catch (err) {
          const failure = classifyFailure("prePush", openid, err, r.id);
          summary.failed += 1;
          summary.failures.push(failure);
          console.log(`Pre-push error for ${openid}:`, failure);
        }
      }
    } catch (err) {
      const failure = classifyFailure("prePush", openid, err);
      summary.failed += 1;
      summary.failures.push(failure);
      console.log(`Pre-push error for ${openid}:`, failure);
    }
  }

  return summary;
}

function emptyFailureCounts(): Record<FailureKind, number> {
  return {
    "wechat-window-expired": 0,
    "wechat-token": 0,
    "wechat-send": 0,
    runtime: 0,
  };
}

function countFailures(failures: JobFailure[]): Record<FailureKind, number> {
  const counts = emptyFailureCounts();
  for (const failure of failures) {
    counts[failure.kind] += 1;
  }
  return counts;
}

function buildHints(
  daily: DailyJobSummary,
  prePush: PrePushJobSummary,
  failureCounts: Record<FailureKind, number>,
): string[] {
  const hints: string[] = [];

  if (Math.max(daily.userCount, prePush.userCount) === 0) {
    hints.push("Redis users:index is empty; confirm users have interacted through the same SCF deployment and Redis instance.");
  }
  if (daily.userCount > 0 && daily.eligibleUsers === 0 && daily.skippedNotInWindow === daily.userCount) {
    hints.push("Daily push ran outside every user's push window; check SCF timer frequency and timezone.");
  }
  if (prePush.candidateReminders > 0 && prePush.sent === 0 && prePush.failed === 0) {
    hints.push("Pre-push found reminders but none were inside the 30-minute send window.");
  }
  if (failureCounts["wechat-window-expired"] > 0) {
    hints.push("WeChat customer-service window expired; long-term proactive reminders need a different push channel.");
  }
  if (failureCounts["wechat-token"] > 0) {
    hints.push("WeChat access token errors remain after retry; verify WX_APPID and WX_SECRET.");
  }
  if (failureCounts.runtime > 0) {
    hints.push("Runtime failures occurred; inspect failure messages and SCF logs.");
  }

  return hints;
}

export function combineJobSummaries(daily: DailyJobSummary, prePush: PrePushJobSummary): JobRunSummary {
  const failures = [...daily.failures, ...prePush.failures];
  const failureCounts = countFailures(failures);
  const hints = buildHints(daily, prePush, failureCounts);
  const sent = daily.sent + prePush.sent;
  const failed = daily.failed + prePush.failed;
  return {
    ranAt: new Date().toISOString(),
    dateStr: daily.dateStr,
    status: failed > 0 ? "failed" : hints.length > 0 ? "warning" : "ok",
    userCount: Math.max(daily.userCount, prePush.userCount),
    sent,
    failed,
    failureCounts,
    hints,
    failures,
    daily,
    prePush,
  };
}
