import { Redis } from "@upstash/redis";
import { runDaily, runPrePush } from "../src/daily";
import { resolveRedisEnv, resolveRuntimeEnv } from "../src/env";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const redisEnv = resolveRedisEnv(process.env);
  const env = resolveRuntimeEnv(process.env);
  const redis = new Redis({
    url: redisEnv.UPSTASH_REDIS_URL,
    token: redisEnv.UPSTASH_REDIS_TOKEN,
  });

  try {
    console.log("[cron] start");
    console.log("[cron] runDaily");
    await runDaily(redis, {
      WX_APPID: env.WX_APPID,
      WX_SECRET: env.WX_SECRET,
      QWEATHER_KEY: env.QWEATHER_KEY,
      QWEATHER_HOST: env.QWEATHER_HOST,
    });

    console.log("[cron] runPrePush");
    await runPrePush(redis, {
      WX_APPID: env.WX_APPID,
      WX_SECRET: env.WX_SECRET,
    });

    console.log("[cron] completed");
    return new Response("OK");
  } catch (err) {
    console.error("Cron error:", err instanceof Error ? err.message : String(err));
    return new Response("Error", { status: 500 });
  }
}
