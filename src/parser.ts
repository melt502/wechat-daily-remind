import { Lunar, Solar } from "lunar-javascript";
import type { AmbiguityReason, Command, ParsedReminder, ReminderRepeat } from "./types";

const WEEKDAY_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
};

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type ParseResult = {
  text: string;
  occursAt: string;
  repeat: ReminderRepeat | null;
  ambiguity: AmbiguityReason[];
};

function parseDateFromText(text: string, today: Date): Date | null {
  const ymd = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return new Date(+ymd[1], +ymd[2] - 1, +ymd[3]);

  const md = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (md) return new Date(today.getFullYear(), +md[1] - 1, +md[2]);

  const slash = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) return new Date(today.getFullYear(), +slash[1] - 1, +slash[2]);

  if (/今天/.test(text)) return new Date(today);
  if (/明天/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (/后天/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return d;
  }
  const dl = text.match(/(\d+)\s*天后/);
  if (dl) {
    const d = new Date(today);
    d.setDate(d.getDate() + +dl[1]);
    return d;
  }
  const nm = text.match(/下个月\s*(\d{1,2})\s*号/);
  if (nm) return new Date(today.getFullYear(), today.getMonth() + 1, +nm[1]);

  if (/月底/.test(text)) {
    return new Date(today.getFullYear(), today.getMonth() + 1, 0);
  }

  const wd = text.match(/(下下|下|本|这)?(?:周|星期)([一二三四五六日天])/);
  if (wd) {
    const prefix = wd[1] || "本";
    const weekday = WEEKDAY_MAP[wd[2]];
    let offset = prefix === "下下" ? 14 : prefix === "下" ? 7 : 0;
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const current = d.getDay() === 0 ? 7 : d.getDay();
    let diff = weekday - current;
    if (diff < 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  const festivalLunar: Record<string, [number, number]> = {
    "春节": [1, 1],
    "元宵": [1, 15],
    "端午": [5, 5],
    "七夕": [7, 7],
    "中秋": [8, 15],
    "重阳": [9, 9],
  };
  const textBefore = ` ${text} `;
  for (const [name, [lm, ld]] of Object.entries(festivalLunar)) {
    if (textBefore.includes(` ${name} `)) {
      const lunar = Lunar.fromYmd(today.getFullYear(), lm, ld);
      const s = lunar.getSolar();
      return new Date(s.getYear(), s.getMonth() - 1, s.getDay());
    }
  }

  if (textBefore.includes(" 清明 ")) {
    for (let d = 1; d <= 5; d++) {
      const s = Solar.fromYmd(today.getFullYear(), 4, d);
      if (s.getLunar().getJieQi() === "清明") {
        return new Date(s.getYear(), s.getMonth() - 1, s.getDay());
      }
    }
  }

  return null;
}

type TimeInfo = { hour: number; minute: number; period: string } | null;

function parseTimeFromText(text: string): TimeInfo {
  const campus = text.match(/(早|早上|上午|晚|晚上|今晚|明晚)\s*(\d{1,2})\s*半/);
  if (campus) return { hour: +campus[2], minute: 30, period: campus[1] || "" };

  const hhmm = text.match(/(\d{1,2}):(\d{2})/);
  if (hhmm) return { hour: +hhmm[1], minute: +hhmm[2], period: "" };

  const cn = text.match(
    /(早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)?\s*(\d{1,2})\s*点\s*(?:(半)|(\d{1,2})\s*分?)?/,
  );
  if (cn) return { hour: +cn[2], minute: cn[3] ? 30 : cn[4] ? +cn[4] : 0, period: cn[1] || "" };

  const short = text.match(/(早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)\s*(\d{1,2})(?!\d|[:：月号日点分])/);
  if (short) return { hour: +short[2], minute: 0, period: short[1] || "" };

  return null;
}

function adjustTime(time: TimeInfo): number {
  if (!time) return 0;

  let hour = time.hour;
  const minute = time.minute;

  const p = time.period;
  if (p === "下午" || p === "晚上" || p === "今晚" || p === "明晚" || p === "晚") {
    if (hour < 12) hour += 12;
  } else if (p === "凌晨" || p === "早" || p === "早上" || p === "今早" || p === "明早") {
    if (hour >= 12) hour -= 12;
  } else if (p === "中午" && hour < 6) {
    hour += 12;
  }

  return hour * 60 + minute;
}

function parseRepeatFromText(text: string): { repeat: ReminderRepeat; match: string } | null {
  const weekly = text.match(/每(?:周|星期)([一二三四五六日天])/);
  if (weekly) {
    const day = WEEKDAY_MAP[weekly[1]];
    return { repeat: { type: "weekly" as const, spec: `${day}` }, match: weekly[0] };
  }
  const monthly = text.match(/每月\s*(\d{1,2})\s*号/);
  if (monthly) {
    return { repeat: { type: "monthly" as const, spec: `${+monthly[1]}` }, match: monthly[0] };
  }
  const daily = text.match(/每天/);
  if (daily) {
    return { repeat: { type: "daily" as const, spec: "" }, match: daily[0] };
  }
  return null;
}

function stripTime(text: string): string {
  return text
    .replace(/(早|早上|上午|晚|晚上|今晚|明晚)\s*\d{1,2}\s*半/g, "")
    .replace(/\d{1,2}:\d{2}/g, "")
    .replace(
      /(?:早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)?\s*\d{1,2}\s*点\s*(?:半|\d{1,2}\s*分?)?/g,
      "",
    )
    .replace(/(?:早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)\s*\d{1,2}(?!\d|[:：月号日点分])/g, "");
}

function stripDate(text: string): string {
  return text
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, "")
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, "")
    .replace(/\d{1,2}\/\d{1,2}/g, "")
    .replace(/今天/g, "")
    .replace(/明天/g, "")
    .replace(/后天/g, "")
    .replace(/\d+\s*天后/g, "")
    .replace(/下个月\s*\d{1,2}\s*号/g, "")
    .replace(/月底/g, "")
    .replace(/[（(]?\s*(?:下下|下|本|这)?(?:周|星期)[一二三四五六日天]\s*[)）]?/g, "")
    .replace(/(?:^|\s)(?:春节|元宵|清明|端午|七夕|中秋|重阳)(?:\s|$)/g, "")
    .replace(/[（(]\s*[)）]/g, "");
}

function stripRepeat(text: string): string {
  return text
    .replace(/每(?:周|星期)[一二三四五六日天]/g, "")
    .replace(/每月\s*\d{1,2}\s*号/g, "")
    .replace(/每天/g, "");
}

function stripCommandPrefix(text: string): string {
  return text
    .replace(/^(添加|新增|加|记|增加|记下|提醒我|提醒|列表|列|查看|显示|查|看看|删除|删|移除|去掉|设置|设定|修改)\s*/, "")
    .trim();
}

function extractText(raw: string): string {
  let t = raw;
  t = stripRepeat(t);
  t = stripDate(t);
  t = stripTime(t);
  t = stripCommandPrefix(t);
  t = t.replace(/为\s*$/, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function hasExplicitTime(text: string): boolean {
  return parseTimeFromText(text) !== null;
}

function buildAmbiguity(text: string, occursAt: string, body: string, hasTime: boolean): AmbiguityReason[] {
  const reasons: AmbiguityReason[] = [];
  if (!hasTime) reasons.push("missing-time");
  if (!body.trim()) reasons.push("empty-text");
  if (body.trim().length > 0 && body.trim().length <= 1) reasons.push("short-text");
  if (new Date(occursAt).getTime() < Date.now()) reasons.push("past-time");
  return [...new Set(reasons)];
}

function parseFullInput(input: string): ParseResult {
  const today = new Date();
  const text = input;

  const repeatResult = parseRepeatFromText(text);
  const repeat = repeatResult?.repeat ?? null;

  const date = parseDateFromText(text, today) ?? today;
  let occursAt = toISO(date);

  const timeInfo = parseTimeFromText(text);
  if (timeInfo) {
    const mins = adjustTime(timeInfo);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    occursAt += `T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  } else {
    occursAt += "T00:00:00";
  }

  const body = extractText(input);
  const textBody = body || input.trim();

  return { text: textBody, occursAt, repeat, ambiguity: buildAmbiguity(text, occursAt, body, Boolean(timeInfo)) };
}

const ADD_WORDS = /^(添加|新增|加|记|增加|记下|提醒我|提醒)\s*/;
const LIST_WORDS = /^(列表|列|查看|显示|查|看看)\s*/;
const DELETE_WORDS = /^(删除|删|移除|去掉)\s*/;
const UPDATE_WORDS = /^(修改|改)\s*/;
const SETTINGS_WORDS = /^(设置|设定)\s*/;
const HELP_WORDS = /^(帮助|帮|？|\?|help)$/;

function toParsedReminder(result: ParseResult): ParsedReminder {
  return {
    text: result.text,
    occursAt: result.occursAt,
    ...(result.repeat ? { repeat: result.repeat } : {}),
    ...(result.ambiguity.length ? { ambiguity: result.ambiguity } : {}),
  };
}

function toBatchParsedReminder(result: ParseResult): ParsedReminder {
  return {
    text: result.text,
    occursAt: result.occursAt,
    ...(result.repeat ? { repeat: result.repeat } : {}),
  };
}

type SegmentPart = {
  text: string;
  delimiter: string;
};

const PERIOD_WORDS = /(早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)/g;
const TIME_BOUNDARY =
  /(?:(?:早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)\s*)?\d{1,2}:\d{2}|(?:(?:早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)\s*)?\d{1,2}\s*点\s*(?:半|\d{1,2}\s*分?)?|(?:早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)\s*\d{1,2}\s*半|(?:早上|上午|下午|晚上|今晚|明晚|今早|明早|凌晨|中午|早|晚)\s*\d{1,2}(?!\d|[:：月号日点分])/g;

function splitPunctuation(input: string): SegmentPart[] {
  const parts: SegmentPart[] = [];
  const re = /[，,；;。！？\n]+/g;
  let lastIndex = 0;
  let delimiter = "";
  let match: RegExpExecArray | null;

  while ((match = re.exec(input)) !== null) {
    const text = input.slice(lastIndex, match.index).trim();
    if (text) parts.push({ text, delimiter });
    delimiter = match[0];
    lastIndex = re.lastIndex;
  }

  const tail = input.slice(lastIndex).trim();
  if (tail) parts.push({ text: tail, delimiter });
  return parts;
}

function hasTimeBoundary(text: string): boolean {
  TIME_BOUNDARY.lastIndex = 0;
  return TIME_BOUNDARY.test(text);
}

function getLastPeriod(text: string): string {
  PERIOD_WORDS.lastIndex = 0;
  let result = "";
  let match: RegExpExecArray | null;
  while ((match = PERIOD_WORDS.exec(text)) !== null) {
    result = match[1];
  }
  return result;
}

function shouldStartNewSegment(text: string, today: Date): boolean {
  return Boolean(
    hasTimeBoundary(text) ||
      getLastPeriod(text) ||
      parseDateFromText(text, today) ||
      parseRepeatFromText(text),
  );
}

function splitTaskSegments(input: string, today: Date): string[] {
  const parts = splitPunctuation(input);
  const merged: string[] = [];

  for (const part of parts) {
    if (merged.length === 0 || shouldStartNewSegment(part.text, today)) {
      merged.push(part.text);
      continue;
    }

    merged[merged.length - 1] += `${part.delimiter || "，"}${part.text}`;
  }

  return merged.flatMap(splitAdjacentTimedTasks).filter((s) => s.trim().length > 0);
}

function splitAdjacentTimedTasks(segment: string): string[] {
  TIME_BOUNDARY.lastIndex = 0;
  const matches = Array.from(segment.matchAll(TIME_BOUNDARY));
  if (matches.length <= 1) return [segment.trim()];

  const chunks: string[] = [];
  const prefix = segment.slice(0, matches[0].index ?? 0).trim();

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? segment.length : segment.length;
    const body = segment.slice(start, end).trim();
    chunks.push(i === 0 && prefix ? `${prefix} ${body}` : body);
  }

  return chunks;
}

function parseMultiSegment(input: string): { items: ParseResult[] } {
  const today = new Date();
  const segments = splitTaskSegments(input, today);

  if (segments.length <= 1) {
    return { items: [parseFullInput(input)] };
  }

  const sharedDate = parseDateFromText(input, today) ?? today;
  const sharedRepeat = parseRepeatFromText(input)?.repeat ?? null;

  const items: ParseResult[] = [];
  let lastPeriod = "";

  for (const segment of segments) {
    const segmentDate = parseDateFromText(segment, today) ?? sharedDate;
    const segmentRepeat = parseRepeatFromText(segment)?.repeat ?? sharedRepeat;
    const segmentTime = parseTimeFromText(segment);
    const period = getLastPeriod(segment);
    let occursAt = toISO(segmentDate);

    if (segmentTime) {
      const effectiveTime = { ...segmentTime, period: segmentTime.period || lastPeriod };
      const mins = adjustTime(effectiveTime);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      occursAt += `T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
    } else {
      const periodDefault: Record<string, string> = {
        "上午": "T09:00:00", "下午": "T14:00:00", "晚上": "T19:00:00", "晚": "T19:00:00",
        "凌晨": "T02:00:00", "中午": "T12:00:00", "今早": "T08:00:00", "明早": "T08:00:00", "早": "T08:00:00",
      };
      occursAt += periodDefault[period || lastPeriod] || "T00:00:00";
    }

    const body = extractText(segment);
    items.push({ text: body || segment, occursAt, repeat: segmentRepeat, ambiguity: buildAmbiguity(segment, occursAt, body, Boolean(segmentTime)) });
    if (segmentTime?.period || period) {
      lastPeriod = segmentTime?.period || period;
    }
  }

  return { items };
}

function parseListRange(rest: string): Command {
  if (/今天/.test(rest)) return { kind: "list", payload: { range: "today" } };
  if (/明天/.test(rest)) return { kind: "list", payload: { range: "tomorrow" } };
  if (/本周|这周|一周/.test(rest)) return { kind: "list", payload: { range: "week" } };
  if (/全部|所有/.test(rest)) return { kind: "list", payload: { range: "all" } };
  if (/最近|近期/.test(rest)) return { kind: "list", payload: { range: "recent" } };
  const date = parseDateFromText(rest, new Date());
  if (date) return { kind: "list", payload: { range: "date", date: toISO(date) } };
  return { kind: "list", payload: { range: "today" } };
}

export function parse(input: string): Command {
  const text = input.trim();

  if (HELP_WORDS.test(text)) {
    return { kind: "help" };
  }

  if (UPDATE_WORDS.test(text)) {
    const rest = text.replace(UPDATE_WORDS, "").trim();
    const m = rest.match(/^第?\s*(\d+)\s*条?\s*(?:为|改为|成|改成)?\s*(.+)$/);
    if (m) {
      return { kind: "update", payload: { index: +m[1], next: toParsedReminder(parseFullInput(m[2])) } };
    }
    return { kind: "help" };
  }

  if (SETTINGS_WORDS.test(text)) {
    const rest = text.replace(SETTINGS_WORDS, "");
    const pushAt = rest.match(/(?:每日提醒时间|推送时间)\s*[是为]?\s*(\d{1,2}):(\d{2})/);
    if (pushAt) {
      return { kind: "settings", payload: { pushAt: `${pushAt[1]}:${pushAt[2]}` } };
    }
    return { kind: "help" };
  }

  if (DELETE_WORDS.test(text)) {
    const rest = text.replace(DELETE_WORDS, "").trim();
    const idx = rest.match(/^第?\s*(\d+)\s*条?/);
    if (idx) {
      return { kind: "delete", payload: { index: +idx[1] } };
    }
    return { kind: "help" };
  }

  if (/^最近提醒$/.test(text)) {
    return { kind: "list", payload: { range: "recent" } };
  }

  if (LIST_WORDS.test(text)) {
    const rest = text.replace(LIST_WORDS, "");
    return parseListRange(rest);
  }

  if (ADD_WORDS.test(text)) {
    const result = parseMultiSegment(text.replace(ADD_WORDS, ""));
    if (result.items.length === 1) {
      return { kind: "add", payload: toParsedReminder(result.items[0]) };
    }
    return { kind: "batch_add", payload: { items: result.items.map(toBatchParsedReminder) } };
  }

  const result = parseMultiSegment(text);
  if (result.items.length === 1) {
    return { kind: "add", payload: toParsedReminder(result.items[0]) };
  }
  return { kind: "batch_add", payload: { items: result.items.map(toBatchParsedReminder) } };
}
