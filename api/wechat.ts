import { Redis } from "@upstash/redis";
import { handleRequest } from "../src/router";
import { resolveRedisEnv, resolveRuntimeEnv } from "../src/env";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
  const redisEnv = resolveRedisEnv(process.env);
  const env = resolveRuntimeEnv(process.env);
  const redis = new Redis({
    url: redisEnv.UPSTASH_REDIS_URL,
    token: redisEnv.UPSTASH_REDIS_TOKEN,
  });

  return handleRequest(req, redis, { WX_TOKEN: env.WX_TOKEN });
}
