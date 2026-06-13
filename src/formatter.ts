import type { AmbiguityReason, CalendarInfo, ListRange, PendingAction, Reminder, Weather } from "./types";
import type { MealPick } from "./meals";

export function formatAddReply(
  greeting: string,
  text: string,
  dateStr: string,
  weekday: string,
  timeStr?: string,
): string {
  const dt = timeStr ? `${dateStr}(${weekday}) ${timeStr}` : `${dateStr}(${weekday})`;
  return `记好啦${greeting}，桂子山打工人 📝\n${dt} 提醒你：${text}`;
}

export function formatListReply(
  greeting: string,
  label: string,
  reminders: Reminder[],
): string {
  if (reminders.length === 0) {
    return `${greeting}，${label}没有提醒事项。\n想试试的话，可以说：明天下午3点提醒我交实验报告`;
  }

  const sorted = [...reminders].sort((a, b) => a.occursAt.localeCompare(b.occursAt));
  const lines = sorted.map((r, i) => `${i + 1}. ${formatReminderLine(r)}`);

  return `${greeting}，${label}安排如下，稳住：\n${lines.join("\n")}\n\n可以继续说“修改第1条为...”或“删除第2条”。`;
}

export function formatBatchAddReply(
  greeting: string,
  items: Array<{ text: string; dateStr: string; weekday: string; timeStr?: string }>,
): string {
  const lines = items.map((item, i) => {
    const dt = item.timeStr ? `${item.dateStr}(${item.weekday}) ${item.timeStr}` : `${item.dateStr}(${item.weekday})`;
    return `${i + 1}. ${dt} ${item.text}`;
  });
  return `好的${greeting}，已记下 ${items.length} 条提醒：\n${lines.join("\n")}`;
}

export function formatDeleteReply(greeting: string, index: number): string {
  return `好的${greeting}，已删除第 ${index} 条提醒`;
}

export function formatHelp(): string {
  return (
    "我是你的华师日常提醒小助手，可以帮你记学习、生活和DDL。\n\n" +
    "📚 学习 / 添加提醒：\n" +
    "  明晚8点提醒我交实验报告\n" +
    "  每周一早上8点提醒我上英语课\n" +
    "  6月20日提醒我四六级报名\n\n" +
    "🏫 生活：\n" +
    "  下午5点提醒我取快递\n" +
    "  明天提醒我带伞\n" +
    "  每天晚上11点提醒我充电\n\n" +
    "📋 查看列表和修改：\n" +
    "  查看今天 / 查看明天 / 查看本周 / 查看全部 / 最近提醒\n" +
    "  修改第2条为明天下午3点交作业\n" +
    "  删除第3条\n\n" +
    "⚙️ 设置：\n" +
    "  设置每日提醒时间 7:30"
  );
}

export function formatSettingsReply(
  greeting: string,
  pushAt: string,
): string {
  return `好的${greeting}，已设置每日提醒时间为 ${pushAt}`;
}

export function formatPendingAdd(action: Extract<PendingAction, { kind: "add" }>): string {
  return `我理解为：${formatOccursDateTime(action.reminder.occursAt)}提醒你「${action.reminder.text}」。\n${formatAmbiguity(action.ambiguity)}\n回复“确认”保存，回复“取消”放弃。`;
}

export function formatPendingUpdate(action: Extract<PendingAction, { kind: "update" }>): string {
  return `确认修改第 ${action.index} 条提醒吗？\n原来：${formatReminderLine(action.previous)}\n修改为：${formatOccursDateTime(action.nextReminder.occursAt)} ${action.nextReminder.text}\n回复“确认”修改，回复“取消”放弃。`;
}

export function formatPendingDelete(action: Extract<PendingAction, { kind: "delete" }>): string {
  return `这条删掉就找不回来啦。确认删除第 ${action.index} 条提醒吗？\n第 ${action.index} 条：${formatReminderLine(action.snapshot)}\n回复“确认”删除，回复“取消”保留。`;
}

export function formatPendingBlocked(action: PendingAction): string {
  return `你还有一个待确认操作：\n${formatPendingSummary(action)}\n\n请先回复“确认”或“取消”。`;
}

export function formatPendingSummary(action: PendingAction): string {
  if (action.kind === "add") return `添加：${formatOccursDateTime(action.reminder.occursAt)} ${action.reminder.text}`;
  if (action.kind === "update") return `修改第 ${action.index} 条为：${formatOccursDateTime(action.nextReminder.occursAt)} ${action.nextReminder.text}`;
  return `删除第 ${action.index} 条：${formatReminderLine(action.snapshot)}`;
}

export function formatConfirmDone(action: PendingAction): string {
  if (action.kind === "add") return `确认啦，已保存：${formatOccursDateTime(action.reminder.occursAt)} ${action.reminder.text}`;
  if (action.kind === "update") return `确认啦，已修改第 ${action.index} 条提醒。`;
  return `确认啦，已删除第 ${action.index} 条提醒。`;
}

export function formatCancelPending(): string {
  return "已取消，这条操作不会保存。";
}

export function formatNoPending(): string {
  return "目前没有待确认操作。你可以直接说：明天下午3点提醒我交实验报告";
}

export function formatNotFound(index: number): string {
  return `没找到第 ${index} 条提醒。\n回复“查看全部”看看当前有哪些提醒。`;
}

export function formatDailyPush(params: {
  greeting: string;
  signature: string;
  calendar?: CalendarInfo;
  weather?: Weather;
  reminders: Reminder[];
  lunch: MealPick;
  dinner: MealPick;
}): string {
  const lines: string[] = [];

  let header = `${params.greeting}，`;
  if (params.calendar) {
    const cal = params.calendar;
    const festival = cal.festival ? ` ${cal.festival}` : "";
    header += `今天是 ${cal.date} ${cal.weekday} 农历${cal.lunarDate}${festival}`;
  } else {
    header += "今天也要在桂子山好好生活";
  }
  lines.push(header);

  if (params.weather) {
    const w = params.weather;
    const umb = w.needUmbrella ? " · 记得带伞☂️" : "";
    lines.push("");
    lines.push(`${w.text} ${w.tempMin}~${w.tempMax}℃ · 降水 ${w.precipProb}%${umb}`);
  }

  lines.push("");
  if (params.reminders.length === 0) {
    lines.push("📋 今日提醒");
    lines.push("  哈哈老板今天没记事项，是个闲人");
  } else {
    lines.push("📋 今日提醒");
    for (const r of params.reminders) {
      lines.push(`  · ${formatOccursTime(r.occursAt)} ${r.text}`);
    }
  }

  lines.push("");
  lines.push(`🍱 中餐：${params.lunch.location} · ${params.lunch.meal}`);
  lines.push(`       (${params.lunch.comment})`);
  lines.push(`🍜 晚餐：${params.dinner.location} · ${params.dinner.meal}`);
  lines.push(`       (${params.dinner.comment})`);

  lines.push("");
  lines.push(`——${params.signature}`);

  return lines.join("\n");
}

export function formatPrePush(reminder: Reminder): string {
  const time = formatOccursTime(reminder.occursAt) || "今天";
  return `⏰ 提醒：${time} ${reminder.text}，还有30分钟`;
}

export function labelForRange(range: ListRange, date?: string): string {
  if (range === "today") return "今天";
  if (range === "tomorrow") return "明天";
  if (range === "week") return "本周";
  if (range === "all") return "全部";
  if (range === "recent") return "最近";
  return date ?? "指定日期";
}

function formatAmbiguity(reasons: AmbiguityReason[]): string {
  if (reasons.includes("missing-time")) return "但你没有说具体时间。";
  if (reasons.includes("past-time")) return "这个时间好像已经过去了。";
  if (reasons.includes("empty-text") || reasons.includes("short-text")) return "但提醒内容有点短，我有点拿不准。";
  return "我有点拿不准你的意思。";
}

function formatReminderLine(reminder: Reminder): string {
  const repeat = formatRepeat(reminder);
  return `${formatOccursDateTime(reminder.occursAt)} ${reminder.text}${repeat}`;
}

function formatRepeat(reminder: Reminder): string {
  if (!reminder.repeat) return "";
  if (reminder.repeat.type === "daily") return "（每天）";
  if (reminder.repeat.type === "weekly") return `（每周${"一二三四五六日"[Number(reminder.repeat.spec) - 1] ?? reminder.repeat.spec}）`;
  if (reminder.repeat.type === "monthly") return `（每月${reminder.repeat.spec}号）`;
  return "";
}

function formatOccursDateTime(occursAt: string): string {
  const date = occursAt.slice(0, 10);
  const time = formatOccursTime(occursAt);
  return time ? `${date} ${time}` : date;
}

function formatOccursTime(occursAt: string): string {
  const time = occursAt.slice(11, 16);
  if (time !== "00:00") return time;
  return "";
}
