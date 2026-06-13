import { Solar } from "lunar-javascript";
import type { CalendarInfo } from "./types";

const FESTIVAL_NAMES = new Set([
  "春节", "元宵节", "龙头节", "端午节", "七夕节",
  "中秋节", "重阳节", "腊八节", "除夕",
]);

export function getCalendar(isoDate: string): CalendarInfo {
  const [y, m, d] = isoDate.split("-").map(Number);
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();

  const weekday = `周${solar.getWeekInChinese()}`;
  const lunarMonth = lunar.getMonthInChinese();
  const lunarDay = lunar.getDayInChinese();

  let lunarDate: string;
  if (lunarMonth === "正" && lunarDay === "初一") {
    lunarDate = `正月初一`;
  } else if (lunarDay === "初一") {
    lunarDate = `${lunarMonth}月初一`;
  } else {
    lunarDate = `${lunarMonth}月${lunarDay}`;
  }

  const festivals: string[] = [];

  for (const f of solar.getFestivals()) {
    if (FESTIVAL_NAMES.has(f)) festivals.push(f);
  }
  for (const f of lunar.getFestivals()) {
    if (FESTIVAL_NAMES.has(f)) festivals.push(f);
  }

  const jieqi = lunar.getJieQi();
  if (jieqi === "清明") {
    festivals.push("清明节");
  }

  const festival = festivals.length > 0 ? festivals[0] : undefined;

  return { date: isoDate, weekday, lunarDate, festival };
}
