import { Redis } from "@upstash/redis";
import type { PendingAction, Reminder, UserSettings } from "./types";

const genId = () => Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

const DEFAULT_SETTINGS: UserSettings = { pushAt: "07:00", tz: "Asia/Shanghai" };

function remindersKey(openid: string) { return `user:${openid}:reminders`; }
function settingsKey(openid: string) { return `user:${openid}:settings`; }
function historyKey(openid: string) { return `user:${openid}:history`; }
function pendingActionKey(openid: string) { return `user:${openid}:pending-action`; }
const USERS_INDEX = "users:index";
const PENDING_ACTION_TTL_SECONDS = 10 * 60;

export async function addReminder(
  redis: Redis,
  openid: string,
  reminder: Omit<Reminder, "id" | "openid" | "createdAt" | "pushedDates">,
): Promise<Reminder> {
  const newReminder: Reminder = {
    ...reminder,
    id: genId(),
    openid,
    createdAt: new Date().toISOString(),
    pushedDates: [],
  };

  const key = remindersKey(openid);
  const existing = await redis.get<Reminder[]>(key);
  const reminders = existing ?? [];
  reminders.push(newReminder);
  await redis.set(key, reminders);
  await ensureUserIndexed(redis, openid);
  return newReminder;
}

export async function listReminders(
  redis: Redis,
  openid: string,
  fromDate?: string,
  toDate?: string,
): Promise<Reminder[]> {
  const reminders = (await redis.get<Reminder[]>(remindersKey(openid))) ?? [];
  if (!fromDate && !toDate) return reminders;
  return reminders.filter((r) => {
    const d = r.occursAt.slice(0, 10);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
}

export async function deleteReminder(
  redis: Redis,
  openid: string,
  index: number,
): Promise<boolean> {
  const key = remindersKey(openid);
  const existing = await redis.get<Reminder[]>(key);
  if (!existing || index < 1 || index > existing.length) return false;
  const newList = [...existing];
  newList.splice(index - 1, 1);
  await redis.set(key, newList);
  return true;
}

export async function deleteReminderById(
  redis: Redis,
  openid: string,
  reminderId: string,
): Promise<boolean> {
  const key = remindersKey(openid);
  const existing = await redis.get<Reminder[]>(key);
  if (!existing) return false;
  const next = existing.filter((r) => r.id !== reminderId);
  if (next.length === existing.length) return false;
  await redis.set(key, next);
  return true;
}

export async function updateReminderById(
  redis: Redis,
  openid: string,
  reminderId: string,
  patch: Pick<Reminder, "text" | "occursAt"> & { repeat?: Reminder["repeat"] },
): Promise<Reminder | null> {
  const key = remindersKey(openid);
  const existing = await redis.get<Reminder[]>(key);
  if (!existing) return null;
  const idx = existing.findIndex((r) => r.id === reminderId);
  if (idx === -1) return null;
  const updated: Reminder = {
    ...existing[idx],
    text: patch.text,
    occursAt: patch.occursAt,
    ...(patch.repeat ? { repeat: patch.repeat } : { repeat: undefined }),
  };
  existing[idx] = updated;
  await redis.set(key, existing);
  return updated;
}

export async function getSettings(redis: Redis, openid: string): Promise<UserSettings> {
  const existing = await redis.get<UserSettings>(settingsKey(openid));
  return existing ?? { ...DEFAULT_SETTINGS };
}

export async function setSettings(
  redis: Redis,
  openid: string,
  patch: Partial<UserSettings>,
): Promise<UserSettings> {
  const current = await getSettings(redis, openid);
  const updated = { ...current, ...patch };
  await redis.set(settingsKey(openid), updated);
  await ensureUserIndexed(redis, openid);
  return updated;
}

export async function markPushed(
  redis: Redis,
  openid: string,
  reminderId: string,
  dateISO: string,
): Promise<void> {
  const key = remindersKey(openid);
  const existing = await redis.get<Reminder[]>(key);
  if (!existing) return;

  const idx = existing.findIndex((r) => r.id === reminderId);
  if (idx === -1) return;

  const reminder = existing[idx];

  if (reminder.repeat) {
    if (!reminder.pushedDates.includes(dateISO)) {
      reminder.pushedDates.push(dateISO);
      existing[idx] = reminder;
      await redis.set(key, existing);
    }
  } else {
    existing.splice(idx, 1);
    await redis.set(key, existing);
    await addToHistory(redis, openid, reminder);
  }
}

export async function getPrePushedIds(
  redis: Redis,
  openid: string,
  dateISO: string,
): Promise<string[]> {
  const existing = await redis.get<string[]>(`user:${openid}:prepush:${dateISO}`);
  return existing ?? [];
}

export async function markPrePushed(
  redis: Redis,
  openid: string,
  dateISO: string,
  reminderId: string,
): Promise<void> {
  const key = `user:${openid}:prepush:${dateISO}`;
  const existing = await redis.get<string[]>(key);
  const ids = existing ?? [];
  if (!ids.includes(reminderId)) {
    ids.push(reminderId);
    await redis.set(key, ids, { ex: 86400 });
  }
}

export async function purgeOlderThan(
  redis: Redis,
  openid: string,
  days: number = 30,
): Promise<void> {
  const existing = await redis.get<Reminder[]>(historyKey(openid));
  if (!existing) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();
  const filtered = existing.filter((r) => r.createdAt > cutoffStr);
  await redis.set(historyKey(openid), filtered);
}

export async function listAllOpenIds(redis: Redis): Promise<string[]> {
  const existing = await redis.get<string[]>(USERS_INDEX);
  return existing ?? [];
}

export async function ensureUserIndexed(redis: Redis, openid: string): Promise<void> {
  if (!openid) return;
  const existing = (await redis.get<string[]>(USERS_INDEX)) ?? [];
  if (!existing.includes(openid)) {
    existing.push(openid);
    await redis.set(USERS_INDEX, existing);
  }
}

export async function setPendingAction(redis: Redis, openid: string, action: PendingAction): Promise<void> {
  await redis.set(pendingActionKey(openid), action, { ex: PENDING_ACTION_TTL_SECONDS });
}

export async function getPendingAction(redis: Redis, openid: string): Promise<PendingAction | null> {
  return await redis.get<PendingAction>(pendingActionKey(openid));
}

export async function clearPendingAction(redis: Redis, openid: string): Promise<void> {
  await redis.del(pendingActionKey(openid));
}

async function addToHistory(redis: Redis, openid: string, reminder: Reminder): Promise<void> {
  const key = historyKey(openid);
  const existing = (await redis.get<Reminder[]>(key)) ?? [];
  existing.push({ ...reminder, pushedDates: [] });
  await redis.set(key, existing);
}
