import { afterEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "@upstash/redis";
import { fetchWeather } from "../src/weather";

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
  } as unknown as Redis;
}

describe("weather", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the default QWeather host when host env is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "200",
        daily: [
          {
            fxDate: "2026-05-29",
            tempMax: "28",
            tempMin: "21",
            textDay: "多云",
            textNight: "多云",
            precipProb: "10",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const weather = await fetchWeather(createMockRedis(), "qweather-key", "", "2026-05-29");

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("https://devapi.qweather.com/"));
    expect(weather.text).toBe("多云");
  });
});
