import { Redis } from "@upstash/redis";
import { handleRequest } from "./src/router";
import { combineJobSummaries, runDaily, runPrePush } from "./src/daily";
import type { JobRunSummary } from "./src/daily";
import { describeRedisEnv, describeRuntimeEnv, resolveRedisEnv, resolveRuntimeEnv } from "./src/env";

let redis: Redis;

function getRedis(): Redis {
  if (!redis) {
    const env = resolveRedisEnv(process.env);
    redis = new Redis({
      url: env.UPSTASH_REDIS_URL,
      token: env.UPSTASH_REDIS_TOKEN,
    });
  }
  return redis;
}

type ApigwEvent = {
  httpMethod: string;
  path: string;
  headers: Record<string, string>;
  queryString?: Record<string, string>;
  body?: string;
};

type ApiResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

async function debugHandler(event: ApigwEvent): Promise<ApiResponse> {
  const body: Record<string, any> = {
    env: describeRuntimeEnv(process.env),
    redisEnv: describeRedisEnv(process.env),
    redis: { status: "untested" },
  };

  // Test Redis connectivity
  try {
    const r = getRedis();
    const pong = await r.ping();
    body.redis = { status: "ok", ping: pong };
  } catch (e: any) {
    body.redis = { status: "error", message: e?.message ?? String(e) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body, null, 2),
  };
}

async function runScheduledJobs(): Promise<JobRunSummary> {
  const r = getRedis();
  const env = resolveRuntimeEnv(process.env);
  const daily = await runDaily(r, {
    WX_APPID: env.WX_APPID,
    WX_SECRET: env.WX_SECRET,
    QWEATHER_KEY: env.QWEATHER_KEY,
    QWEATHER_HOST: env.QWEATHER_HOST,
  });
  const prePush = await runPrePush(r, {
    WX_APPID: env.WX_APPID,
    WX_SECRET: env.WX_SECRET,
  });
  return combineJobSummaries(daily, prePush);
}

async function handleApiGateway(event: ApigwEvent): Promise<ApiResponse> {
  if (event.httpMethod === "GET" && event.path === "/debug") {
    return debugHandler(event);
  }

  if ((event.httpMethod === "GET" || event.httpMethod === "POST") && event.path === "/cron") {
    const summary = await runScheduledJobs();
    console.log("[cron] summary", JSON.stringify(summary));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, summary }, null, 2),
    };
  }

  const host = event.headers?.host || "localhost";
  let urlStr = `https://${host}${event.path}`;
  if (event.queryString) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(event.queryString)) {
      qs.set(k, v);
    }
    urlStr += `?${qs.toString()}`;
  }

  const request = new Request(urlStr, {
    method: event.httpMethod,
    headers: new Headers(event.headers ?? {}),
    body: event.httpMethod === "POST" ? event.body : undefined,
  });

  const response = await handleRequest(request, getRedis(), {
    WX_TOKEN: resolveRuntimeEnv(process.env).WX_TOKEN,
  });

  const resHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    resHeaders[k] = v;
  });

  return {
    statusCode: response.status,
    headers: resHeaders,
    body: await response.text(),
  };
}

export async function main_handler(event: any, _context: any) {
  // Timer trigger: event.Type === "Timer"
  if (event?.Type === "Timer" || event?.type === "Timer" || event?.TriggerName || event?.triggerName) {
    const summary = await runScheduledJobs();
    console.log("[timer] summary", JSON.stringify(summary));
    return;
  }

  // API Gateway trigger
  return handleApiGateway(event as ApigwEvent);
}
