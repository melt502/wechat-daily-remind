export type RuntimeEnv = {
  WX_TOKEN: string;
  WX_APPID: string;
  WX_SECRET: string;
  QWEATHER_KEY: string;
  QWEATHER_HOST: string;
};

export type RedisEnv = {
  UPSTASH_REDIS_URL: string;
  UPSTASH_REDIS_TOKEN: string;
};

type EnvSource = Record<string, string | undefined>;

const DEFAULT_QWEATHER_HOST = "devapi.qweather.com";

const ENV_ALIASES = {
  WX_TOKEN: ["WX_TOKEN", "WECHAT_TOKEN"],
  WX_APPID: ["WX_APPID", "WECHAT_APPID", "APPID"],
  WX_SECRET: ["WX_SECRET", "WECHAT_SECRET", "APPSECRET"],
  QWEATHER_KEY: ["QWEATHER_KEY", "QWEATHER_API_KEY", "HEFENG_KEY", "WEATHER_KEY"],
  QWEATHER_HOST: ["QWEATHER_HOST", "QWEATHER_API_HOST", "HEFENG_HOST", "WEATHER_HOST"],
} as const;

const REDIS_ALIASES = {
  UPSTASH_REDIS_URL: ["UPSTASH_REDIS_URL", "REDIS_URL"],
  UPSTASH_REDIS_TOKEN: ["UPSTASH_REDIS_TOKEN", "REDIS_TOKEN"],
} as const;

function pickEnv(source: EnvSource, names: readonly string[], fallback = ""): string {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return fallback;
}

export function resolveRuntimeEnv(source: EnvSource): RuntimeEnv {
  return {
    WX_TOKEN: pickEnv(source, ENV_ALIASES.WX_TOKEN),
    WX_APPID: pickEnv(source, ENV_ALIASES.WX_APPID),
    WX_SECRET: pickEnv(source, ENV_ALIASES.WX_SECRET),
    QWEATHER_KEY: pickEnv(source, ENV_ALIASES.QWEATHER_KEY),
    QWEATHER_HOST: pickEnv(source, ENV_ALIASES.QWEATHER_HOST, DEFAULT_QWEATHER_HOST),
  };
}

export function resolveRedisEnv(source: EnvSource): RedisEnv {
  return {
    UPSTASH_REDIS_URL: pickEnv(source, REDIS_ALIASES.UPSTASH_REDIS_URL),
    UPSTASH_REDIS_TOKEN: pickEnv(source, REDIS_ALIASES.UPSTASH_REDIS_TOKEN),
  };
}

export function describeRuntimeEnv(source: EnvSource): Record<string, { status: "set" | "missing" | "default"; from: string }> {
  const result: Record<string, { status: "set" | "missing" | "default"; from: string }> = {};

  for (const [key, names] of Object.entries(ENV_ALIASES)) {
    const found = names.find((name) => typeof source[name] === "string" && source[name]!.trim().length > 0);
    if (found) {
      result[key] = { status: "set", from: found };
    } else if (key === "QWEATHER_HOST") {
      result[key] = { status: "default", from: DEFAULT_QWEATHER_HOST };
    } else {
      result[key] = { status: "missing", from: names.join("|") };
    }
  }

  return result;
}

export function describeRedisEnv(source: EnvSource): Record<string, { status: "set" | "missing"; from: string }> {
  const result: Record<string, { status: "set" | "missing"; from: string }> = {};

  for (const [key, names] of Object.entries(REDIS_ALIASES)) {
    const found = names.find((name) => typeof source[name] === "string" && source[name]!.trim().length > 0);
    result[key] = found ? { status: "set", from: found } : { status: "missing", from: names.join("|") };
  }

  return result;
}
