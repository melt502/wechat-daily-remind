import { describe, it, expect, vi, afterEach } from "vitest";
import type { Redis } from "@upstash/redis";
import { sendText } from "../src/pusher";

function createMockRedis(): Redis {
  const data = new Map<string, string>();
  return {
    get: async <T>(key: string): Promise<T | null> => {
      const val = data.get(key);
      if (val === undefined) return null;
      return val as T;
    },
    set: async (key: string, value: any): Promise<any> => {
      data.set(key, typeof value === "string" ? value : JSON.stringify(value));
      return "OK";
    },
    del: async (...keys: string[]): Promise<number> => {
      let count = 0;
      for (const key of keys) {
        if (data.delete(key)) count++;
      }
      return count;
    },
  } as unknown as Redis;
}

describe("pusher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes token and retries token errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ access_token: "token-1", expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ errcode: 40001, errmsg: "invalid credential" }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ access_token: "token-2", expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ errcode: 0, errmsg: "ok" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await sendText(createMockRedis(), "appid", "secret", "openid", "hello");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toContain("access_token=token-2");
  });

  it("identifies expired customer-service window without retrying send", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ access_token: "token-1", expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ errcode: 45015, errmsg: "response out of time limit" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendText(createMockRedis(), "appid", "secret", "openid", "hello")).rejects.toThrow(
      "customer-service window expired",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
