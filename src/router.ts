import { Redis } from "@upstash/redis";
import { parse } from "./parser";
import * as store from "./store";
import { getCalendar } from "./calendar";
import { pick } from "./greetings";
import type { ListRange, PendingAction, Reminder } from "./types";
import {
  formatAddReply,
  formatBatchAddReply,
  formatCancelPending,
  formatConfirmDone,
  formatDeleteReply,
  formatHelp,
  formatListReply,
  formatNoPending,
  formatNotFound,
  formatPendingAdd,
  formatPendingBlocked,
  formatPendingDelete,
  formatPendingUpdate,
  formatSettingsReply,
  labelForRange,
} from "./formatter";

async function verifySignature(token: string, timestamp: string, nonce: string, signature: string): Promise<boolean> {
  const arr = [token, timestamp, nonce].sort();
  const sha1 = await hexSha1(arr.join(""));
  return sha1 === signature;
}

async function hexSha1(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  let re = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    result[m[1]] = m[2];
  }
  re = /<(\w+)>([^<]+?)<\/\1>/gs;
  while ((m = re.exec(xml)) !== null) {
    if (!(m[1] in result)) result[m[1]] = m[2];
  }
  return result;
}

function buildXmlReply(toUser: string, fromUser: string, content: string): string {
  const time = Math.floor(Date.now() / 1000);
  return (
    `<xml>\n` +
    `  <ToUserName><![CDATA[${toUser}]]></ToUserName>\n` +
    `  <FromUserName><![CDATA[${fromUser}]]></FromUserName>\n` +
    `  <CreateTime>${time}</CreateTime>\n` +
    `  <MsgType><![CDATA[text]]></MsgType>\n` +
    `  <Content><![CDATA[${content}]]></Content>\n` +
    `</xml>`
  );
}

export async function handleRequest(
  request: Request,
  redis: Redis,
  env: { WX_TOKEN: string },
): Promise<Response> {
  const url = new URL(request.url);
  console.log(`[router] ${request.method} ${url.pathname}${url.search}`);

  if (request.method === "GET") {
    const timestamp = url.searchParams.get("timestamp") || "";
    const nonce = url.searchParams.get("nonce") || "";
    const signature = url.searchParams.get("signature") || "";
    const echostr = url.searchParams.get("echostr") || "";

    console.log(`[router] GET verify: token=${env.WX_TOKEN ? "set" : "EMPTY"} ts=${timestamp} sig=${signature}`);
    const ok = await verifySignature(env.WX_TOKEN, timestamp, nonce, signature);
    console.log(`[router] signature valid: ${ok}`);
    if (ok) {
      return new Response(echostr);
    }
    return new Response("Invalid signature", { status: 401 });
  }

  if (request.method === "POST") {
    const rawXml = await request.text();
    console.log(`[router] POST raw XML: ${rawXml}`);
    const msg = parseXml(rawXml);
    console.log(`[router] parsed msg:`, JSON.stringify(msg));
    const openid = msg.FromUserName || "";
    const content = msg.Content || "";
    const ourId = msg.ToUserName || "";
    const msgId = msg.MsgId || "";

    if (msgId) {
      const dedupKey = `msg:dedup:${msgId}`;
      const seen = await redis.get(dedupKey);
      if (seen) {
        console.log(`[router] duplicate MsgId=${msgId}, skipping`);
        const xml = buildXmlReply(openid, ourId, "");
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }
      await redis.set(dedupKey, "1", { ex: 60 });
    }

    try {
      const reply = await processMessage(redis, openid, content);
      console.log(`[router] reply: ${reply}`);
      const xml = buildXmlReply(openid, ourId, reply);
      console.log(`[router] XML response: ${xml}`);
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    } catch (err) {
      console.log(`[router] ERROR:`, err instanceof Error ? err.message : String(err));
      console.log(`[router] stack:`, err instanceof Error ? err.stack : "");
      const fallback = buildXmlReply(openid, ourId, "处理出错，请稍后再试");
      return new Response(fallback, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}

const CONFIRM_WORDS = new Set(["确认", "好", "好的", "是的", "ok", "OK", "Ok"]);
const CANCEL_WORDS = new Set(["取消", "算了", "不要了", "不用了"]);

async function processMessage(
  redis: Redis,
  openid: string,
  content: string,
): Promise<string> {
  console.log(`[process] openid=${openid} content=${content}`);
  await store.ensureUserIndexed(redis, openid);

  const today = new Date();
  const context = {
    isRainy: false,
    isWeekend: today.getDay() === 0 || today.getDay() === 6,
    isClearLike: true,
  };
  const greeting = pick("reply", context);
  const trimmed = content.trim();
  const pending = await store.getPendingAction(redis, openid);

  if (CONFIRM_WORDS.has(trimmed)) {
    if (!pending) return formatNoPending();
    await executePendingAction(redis, openid, pending);
    await store.clearPendingAction(redis, openid);
    return formatConfirmDone(pending);
  }

  if (CANCEL_WORDS.has(trimmed)) {
    if (!pending) return formatNoPending();
    await store.clearPendingAction(redis, openid);
    return formatCancelPending();
  }

  if (pending) {
    return formatPendingBlocked(pending);
  }

  const command = parse(content);
  console.log(`[process] command:`, JSON.stringify(command));

  switch (command.kind) {
    case "add": {
      if (command.payload.ambiguity?.length) {
        const action: PendingAction = {
          kind: "add",
          originalText: content,
          reminder: command.payload,
          ambiguity: command.payload.ambiguity,
          createdAt: new Date().toISOString(),
        };
        await store.setPendingAction(redis, openid, action);
        return formatPendingAdd(action);
      }

      const cal = getCalendar(command.payload.occursAt.slice(0, 10));
      const timeStr = command.payload.occursAt.slice(11, 16);
      const timeDisplay = timeStr !== "00:00" ? timeStr : undefined;

      await store.addReminder(redis, openid, {
        text: command.payload.text,
        occursAt: command.payload.occursAt,
        repeat: command.payload.repeat,
      });

      return formatAddReply(greeting, command.payload.text, cal.date, cal.weekday, timeDisplay);
    }

    case "batch_add": {
      const displayItems: Array<{ text: string; dateStr: string; weekday: string; timeStr?: string }> = [];

      for (const item of command.payload.items) {
        const cal = getCalendar(item.occursAt.slice(0, 10));
        const timeStr = item.occursAt.slice(11, 16);
        const timeDisplay = timeStr !== "00:00" ? timeStr : undefined;

        await store.addReminder(redis, openid, {
          text: item.text,
          occursAt: item.occursAt,
          repeat: item.repeat,
        });

        displayItems.push({ text: item.text, dateStr: cal.date, weekday: cal.weekday, timeStr: timeDisplay });
      }

      return formatBatchAddReply(greeting, displayItems);
    }

    case "list": {
      const reminders = await store.listReminders(redis, openid);
      const filtered = filterReminders(reminders, command.payload.range, command.payload.date);
      return formatListReply(greeting, labelForRange(command.payload.range, command.payload.date), filtered);
    }

    case "update": {
      const reminders = await store.listReminders(redis, openid);
      const target = reminders[command.payload.index - 1];
      if (!target) return formatNotFound(command.payload.index);
      const action: PendingAction = {
        kind: "update",
        originalText: content,
        index: command.payload.index,
        reminderId: target.id,
        previous: target,
        nextReminder: command.payload.next,
        createdAt: new Date().toISOString(),
      };
      await store.setPendingAction(redis, openid, action);
      return formatPendingUpdate(action);
    }

    case "delete": {
      const reminders = await store.listReminders(redis, openid);
      const target = reminders[command.payload.index - 1];
      if (!target) return formatNotFound(command.payload.index);
      const action: PendingAction = {
        kind: "delete",
        originalText: content,
        index: command.payload.index,
        reminderId: target.id,
        snapshot: target,
        createdAt: new Date().toISOString(),
      };
      await store.setPendingAction(redis, openid, action);
      return formatPendingDelete(action);
    }

    case "settings": {
      const updated = await store.setSettings(redis, openid, command.payload);
      return formatSettingsReply(greeting, updated.pushAt);
    }

    case "help":
      return formatHelp();
  }
}

async function executePendingAction(redis: Redis, openid: string, action: PendingAction): Promise<void> {
  if (action.kind === "add") {
    await store.addReminder(redis, openid, {
      text: action.reminder.text,
      occursAt: action.reminder.occursAt,
      repeat: action.reminder.repeat,
    });
    return;
  }
  if (action.kind === "update") {
    await store.updateReminderById(redis, openid, action.reminderId, {
      text: action.nextReminder.text,
      occursAt: action.nextReminder.occursAt,
      repeat: action.nextReminder.repeat,
    });
    return;
  }
  await store.deleteReminderById(redis, openid, action.reminderId);
}

function filterReminders(reminders: Reminder[], range: ListRange, date?: string): Reminder[] {
  const now = new Date();
  const today = toDateString(now);
  const active = reminders.filter((r) => isActiveReminder(r, today));
  if (range === "all") return active.sort(byOccursAt);
  if (range === "recent") return active.sort(byOccursAt).slice(0, 10);
  if (range === "date") return reminders.filter((r) => reminderMatchesDate(r, date ?? today)).sort(byOccursAt);
  if (range === "today") return reminders.filter((r) => reminderMatchesDate(r, today)).sort(byOccursAt);
  if (range === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return reminders.filter((r) => reminderMatchesDate(r, toDateString(d))).sort(byOccursAt);
  }
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  const endStr = toDateString(end);
  return active.filter((r) => {
    const d = r.occursAt.slice(0, 10);
    return d >= today && d <= endStr;
  }).sort(byOccursAt);
}

function isActiveReminder(reminder: Reminder, today: string): boolean {
  return Boolean(reminder.repeat) || reminder.occursAt.slice(0, 10) >= today;
}

function reminderMatchesDate(reminder: Reminder, date: string): boolean {
  const d = reminder.occursAt.slice(0, 10);
  return d === date || Boolean(reminder.repeat && d <= date);
}

function byOccursAt(a: Reminder, b: Reminder): number {
  return a.occursAt.localeCompare(b.occursAt);
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
