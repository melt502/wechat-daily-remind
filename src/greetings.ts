import type { GreetingSlot, GreetingContext } from "./types";

type Entry = {
  text: string;
  slots: GreetingSlot[];
  tags: string[];
};

const pool: Entry[] = [
  // 通用
  { text: "老板", slots: ["reply", "morning", "sign"], tags: ["通用"] },
  { text: "朋友", slots: ["reply", "morning"], tags: ["通用"] },
  { text: "亲爱的大人", slots: ["reply", "morning"], tags: ["通用"] },
  { text: "这位同学", slots: ["reply", "morning"], tags: ["通用"] },
  { text: "老铁", slots: ["reply", "morning", "sign"], tags: ["通用"] },

  // 早安
  { text: "早起的鸟儿有虫吃", slots: ["morning"], tags: ["通用"] },
  { text: "元气老板早", slots: ["morning"], tags: ["晴天"] },
  { text: "又见面了老板", slots: ["morning"], tags: ["通用"] },
  { text: "一日之计在于晨", slots: ["morning"], tags: ["通用"] },
  { text: "早上好呀，今天也是元气满满的一天", slots: ["morning"], tags: ["晴天"] },

  // 雨天
  { text: "记得带伞", slots: ["morning", "sign"], tags: ["雨天"] },
  { text: "下雨天别淋着了", slots: ["morning"], tags: ["雨天"] },
  { text: "湿冷天气注意保暖", slots: ["sign"], tags: ["雨天"] },
  { text: "路上滑，慢点走", slots: ["sign"], tags: ["雨天"] },
  { text: "别忘了带伞", slots: ["sign"], tags: ["雨天"] },

  // 晴天
  { text: "出门撒野老板", slots: ["sign"], tags: ["晴天"] },
  { text: "今天适合出去走走", slots: ["sign"], tags: ["晴天"] },
  { text: "好天气配好心情", slots: ["sign"], tags: ["晴天"] },

  // 周末
  { text: "周末愉快老板", slots: ["morning", "sign"], tags: ["周末"] },
  { text: "周末了，好好休息", slots: ["sign"], tags: ["周末"] },

  // 工作日
  { text: "搬砖快乐", slots: ["morning", "sign"], tags: ["工作日"] },
  { text: "又是努力的一天", slots: ["morning"], tags: ["工作日"] },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function contextTag(context: GreetingContext): string {
  if (context.isRainy) return "雨天";
  if (context.isClearLike) return "晴天";
  if (context.isWeekend) return "周末";
  return "工作日";
}

export function pick(slot: GreetingSlot, context: GreetingContext): string {
  const tag = contextTag(context);

  const exact = pool.filter(
    (e) => e.slots.includes(slot) && e.tags.includes(tag),
  );
  if (exact.length > 0) return pickRandom(exact).text;

  const generic = pool.filter(
    (e) => e.slots.includes(slot) && e.tags.includes("通用"),
  );
  if (generic.length > 0) return pickRandom(generic).text;

  return slot === "reply" ? "老板" : "又是美好的一天";
}
