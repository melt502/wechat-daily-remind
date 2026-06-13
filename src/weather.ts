import { Redis } from "@upstash/redis";
import type { Weather } from "./types";

const WUHAN_LOCATION = "101200101";
const CACHE_TTL = 3600; // 1 hour
const DEFAULT_QWEATHER_HOST = "devapi.qweather.com";

type QWeatherDaily = {
  fxDate: string;
  tempMax: string;
  tempMin: string;
  textDay: string;
  textNight: string;
  precip?: string;
  precipProb?: string;
};

type QWeatherResponse = {
  code: string;
  daily?: QWeatherDaily[];
};

export async function fetchWeather(
  redis: Redis,
  qweatherKey: string,
  qweatherHost: string,
  dateStr: string,
): Promise<Weather> {
  // Check cache
  const cacheKey = `weather:wuhan:${dateStr}`;
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    return typeof cached === "string" ? (JSON.parse(cached) as Weather) : (cached as Weather);
  }

  if (!qweatherKey) {
    throw new Error("QWEATHER_KEY not set");
  }
  const host = (qweatherHost || DEFAULT_QWEATHER_HOST).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${host}/v7/weather/3d?location=${WUHAN_LOCATION}&key=${qweatherKey}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`QWeather API error: ${resp.status}`);
  }

  const data = (await resp.json()) as QWeatherResponse;
  if (data.code !== "200" || !data.daily || data.daily.length === 0) {
    throw new Error(`QWeather API error: code=${data.code}`);
  }

  const weatherDay = data.daily.find((day) => day.fxDate === dateStr) ?? data.daily[0];
  const weather = buildWeather(weatherDay);

  // Cache the result
  await redis.set(cacheKey, JSON.stringify(weather), { ex: CACHE_TTL });

  return weather;
}

function buildWeather(daily: QWeatherDaily): Weather {
  const text = daily.textDay;
  const tempMax = parseInt(daily.tempMax, 10);
  const tempMin = parseInt(daily.tempMin, 10);
  const precipProb = parseInt(daily.precipProb ?? daily.precip ?? "0", 10) || 0;

  const willRain = text.includes("雨") || daily.textNight.includes("雨") || precipProb >= 50;
  const isClearLike = !willRain && (text === "晴" || text.includes("多云"));
  const needUmbrella = willRain;

  return { text, tempMax, tempMin, precipProb, willRain, isClearLike, needUmbrella };
}
