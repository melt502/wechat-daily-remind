import { handleRequest } from "./router";
import { runDaily, runPrePush } from "./daily";
import { resolveRuntimeEnv } from "./env";

export interface Env {
  KV: KVNamespace;
  WX_TOKEN: string;
  WX_APPID: string;
  WX_SECRET: string;
  QWEATHER_KEY: string;
  QWEATHER_HOST?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtimeEnv = resolveRuntimeEnv(env as unknown as Record<string, string | undefined>);
    return handleRequest(request, env.KV, { WX_TOKEN: runtimeEnv.WX_TOKEN });
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const runtimeEnv = resolveRuntimeEnv(env as unknown as Record<string, string | undefined>);
    // Daily full push (self-guarding via pushedDates)
    await runDaily(env.KV, {
      WX_APPID: runtimeEnv.WX_APPID,
      WX_SECRET: runtimeEnv.WX_SECRET,
      QWEATHER_KEY: runtimeEnv.QWEATHER_KEY,
      QWEATHER_HOST: runtimeEnv.QWEATHER_HOST,
    });

    // Pre-push check (sends reminders 30 min before event)
    await runPrePush(env.KV, {
      WX_APPID: runtimeEnv.WX_APPID,
      WX_SECRET: runtimeEnv.WX_SECRET,
    });
  },
};
