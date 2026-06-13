import { Redis } from "@upstash/redis";

const TOKEN_KEY = "wx:access_token";
const TOKEN_TTL = 7000;
const REFRESH_MARGIN = 300_000; // 5 minutes in ms
const SEND_URL = "https://api.weixin.qq.com/cgi-bin/message/custom/send";
const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type SendResponse = {
  errcode: number;
  errmsg: string;
};

type StoredToken = {
  token: string;
  expiresAt: number;
};

async function getAccessToken(
  redis: Redis,
  appid: string,
  secret: string,
): Promise<string> {
  if (!appid || !secret) {
    throw new Error("WeChat credentials missing");
  }

  const cached = await redis.get<string>(TOKEN_KEY);
  if (cached) {
    const parsed = JSON.parse(cached) as StoredToken;
    if (parsed.expiresAt > Date.now() + REFRESH_MARGIN) {
      return parsed.token;
    }
  }

  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const resp = await fetch(url);
  const data = (await resp.json()) as TokenResponse;

  if (!data.access_token) {
    throw new Error(`WeChat token error: ${data.errcode} ${data.errmsg}`);
  }

  const expiresIn = data.expires_in ?? TOKEN_TTL;
  const toStore: StoredToken = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  await redis.set(TOKEN_KEY, JSON.stringify(toStore), { ex: TOKEN_TTL });

  return data.access_token;
}

function sendError(openid: string, data: SendResponse): Error {
  if (data.errcode === 45015) {
    return new Error(`WeChat customer-service window expired for ${openid}: ${data.errcode} ${data.errmsg}`);
  }
  return new Error(`WeChat send error for ${openid}: ${data.errcode} ${data.errmsg}`);
}

export async function sendText(
  redis: Redis,
  appid: string,
  secret: string,
  openid: string,
  text: string,
): Promise<void> {
  const token = await getAccessToken(redis, appid, secret);
  const url = `${SEND_URL}?access_token=${token}`;

  const body = { touser: openid, msgtype: "text", text: { content: text } };

  // First attempt
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as SendResponse;

  if (data.errcode === 0) return;

  if (data.errcode !== 40001 && data.errcode !== 42001) {
    throw sendError(openid, data);
  }

  await redis.del(TOKEN_KEY);

  const token2 = await getAccessToken(redis, appid, secret);
  const url2 = `${SEND_URL}?access_token=${token2}`;
  const resp2 = await fetch(url2, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data2 = (await resp2.json()) as SendResponse;

  if (data2.errcode !== 0) {
    throw sendError(openid, data2);
  }
}
