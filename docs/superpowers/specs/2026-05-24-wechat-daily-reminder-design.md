# 微信公众号每日提醒助手 · 设计文档

- 日期：2026-05-24
- 状态：草案，待评审
- 范围：单一实现计划

## 1. 背景与目标

每天早上 07:00（北京时间）通过微信公众号收到一条整合消息，内容包含：

1. 当日提醒清单（用户在公众号聊天里随时编辑）
2. 武汉天气与是否需要带伞
3. 公历日期 + 农历日期 + 节日标注
4. 中餐 / 晚餐建议（地点 + 主餐 + 趣味评论）

要求：

- 全程 0 成本（不依赖任何按量计费服务）
- 编辑入口为公众号聊天界面，支持「下周三」这类自然中文表达
- 多人使用，每个微信用户拥有独立提醒库与独立推送时间
- 餐厅推荐遵循概率规则：晴天 90% 校内 / 10% 校外；非晴天 100% 校内
- 称呼多样化、文案有趣

## 2. 非目标

- 不做 Web 管理后台
- 不做模板消息（个人订阅号已被禁用）
- 不接任何付费 LLM API
- 不为「朋友」自定义食堂池（默认共用华师一套）
- 不做按提醒条目的细粒度提前 N 分钟通知

## 3. 推送渠道与运行环境

| 项 | 选型 | 理由 |
|---|---|---|
| 公众号载体 | 微信公众号测试号 | 个人即可申请，模板/客服消息均可用，0 成本 |
| 运行环境 | Cloudflare Workers + KV | 一处承载 webhook + cron + 存储；免费额度对个人远远够用；wrangler 部署体验好 |
| 数据存储 | Workers KV（按 OpenID 分区） | 多人独立提醒库 |
| 天气源 | 和风天气（QWeather）国内版 | 免费 1000 次/日，含降水概率与逐时预报 |
| 农历库 | `lunar-javascript`（或同类零依赖 npm 包） | 节日识别覆盖春节、元宵、清明、端午、七夕、中秋、重阳 |

## 4. 总体架构

```
微信用户 ─── 微信测试号服务器 ─── POST /wechat ──> Cloudflare Worker
                                                     │
                                                     ├─ KV (per-OpenID 分区)
                                                     ├─ 和风天气 API
                                                     └─ 微信客服消息 API（推送回包）

Cron(07:00 CST) ──> Worker.run(daily) ── 遍历用户 ── 组装文案 ── 客服消息 API ── 用户
```

两条数据通路：

1. **聊天编辑路径（同步，5 秒预算内）**：用户发消息 → 校验签名 → 解析 → 写 KV → XML 回包。
2. **每日推送路径（cron 触发，无超时压力）**：cron → 遍历 OpenID → 拉天气/农历 → 抽餐厅 → 渲染文案 → 客服消息接口主动推。

## 5. 模块切分

每个模块独立文件、单一职责、可单测。

### 5.1 `router.ts`
- HTTP 入口，做微信签名校验、消息类型判断、流程编排。
- 不包含业务规则。

### 5.2 `parser.ts`
- 输入用户文本，输出结构化命令：`{ kind: 'add'|'list'|'delete'|'settings'|'help', payload }`。
- 内部三层：命令词识别 → 日期短语解析 → 时间识别。
- 支持的日期表达：
  - 具体日期：`5月15日`、`5/15`、`2026-05-15`
  - 相对日：`明天`、`后天`、`N 天后`
  - 周内：`周三`、`下周三`、`下下周一`
  - 月份：`下个月 3 号`
  - 节日名：春节、元宵、清明、端午、七夕、中秋、重阳
  - 重复：`每周三`、`每月 1 号`、`每天`
- 时间表达：`14:00`、`下午 2 点`、`晚上 7 点`、`早 8`。
- 解析失败：返回 `{ kind: 'help' }`，由 formatter 输出引导文案。

### 5.3 `store.ts`
- 屏蔽 KV 细节，对外暴露：
  - `addReminder(openid, reminder)`（首次写入时自动把 OpenID 加进 `users:index`）
  - `listReminders(openid, fromDate, toDate)`
  - `deleteReminder(openid, indexOrId)`
  - `markPushed(openid, reminderIds, dateISO)`
  - `getSettings(openid)` / `setSettings(openid, patch)`
  - `purgeOlderThan(openid, days=30)`
  - `listAllOpenIds()`（cron 用，读 `users:index`）
- 提醒条目结构：

```ts
type Reminder = {
  id: string;            // nanoid
  openid: string;
  text: string;          // 一行内容
  occursAt: string;      // ISO，单次提醒；重复提醒该字段为创建时间
  repeat?: { type: 'weekly' | 'monthly' | 'daily'; spec: string };
  createdAt: string;
  pushedDates: string[]; // 已推过的日期；单次提醒推送后会进 history 字段、原条目删除；重复提醒留住此字段用于幂等防止同日重复推
};
```

### 5.4 `calendar.ts`
- 输入 ISO 日期，输出 `{ date, weekday, lunarDate, festival? }`。
- 节日清单：春节、元宵、清明、端午、七夕、中秋、重阳。

### 5.5 `weather.ts`
- 调和风天气获取武汉当日天气与逐时降水概率，输出：

```ts
type Weather = {
  text: string;           // 多云
  tempMax: number;
  tempMin: number;
  precipProb: number;     // 当日最大降水概率 %
  willRain: boolean;      // 文字含"雨" 或 precipProb >= 50
  isClearLike: boolean;   // 文字为「晴」或「多云」 且 willRain=false
  needUmbrella: boolean;  // = willRain
};
```

- KV 缓存键 `weather:wuhan:YYYY-MM-DD`，TTL 1 小时。

### 5.6 `meals.ts`
- 数据：硬编码两份字典 `(地点 → 招牌菜数组)`：
  - 校内（华中师范大学）：东一、东二、学子、沁园春、南门小吃街、桂香园
  - 校外（步行可达）：街道口、广八路、虎泉
- 算法（中、晚餐独立抽样）：
  - `weather.isClearLike == true` → 90% 校内 / 10% 校外
  - 否则 → 100% 校内
- 趣味评论：评论池约 30 条，按"地点 + 主餐"哈希取一条，避免每天同款。

### 5.7 `greetings.ts`
- 称呼池约 15~20 条，按维度分组：通用、早安、雨天、晴天、周末、工作日。
- 接口 `pick({ slot, context })`，slot ∈ `{ reply, morning, sign }`，context 含 `isRainy / isWeekend / isClearLike`。
- 应用位置：聊天回包开头、每日推送开头问候、每日推送结尾签名（推送两处分别抽，避免重复）。

### 5.8 `pusher.ts`
- 维护 `wx:access_token`（KV 共享，TTL 7000s，提前 5 分钟刷新）。
- 调 `https://api.weixin.qq.com/cgi-bin/message/custom/send` 给指定 OpenID 发文本。
- 失败重试 1 次，二次仍失败则记日志（`console.log` + `wrangler tail`）。

### 5.9 `daily.ts`
- cron 入口。流程：
  1. `store.listAllOpenIds()`
  2. 对每个用户：
     - `listReminders(openid, today, today)` + 重复规则展开
     - `weather.fetch(wuhan)`
     - `calendar.lookup(today)`
     - `meals.pickLunch / pickDinner(weather.isClearLike)`
     - `greetings.pick(...)` × 2
     - `formatter.renderDaily(...)`
     - `pusher.sendText(openid, text)`
     - 成功：`store.markPushed(...)` + 单次提醒进 history
     - 失败：log 后跳过（次日重试）
  3. 每个用户处理末尾顺手 `purgeOlderThan(openid, 30)`。

### 5.10 `formatter.ts`
- 聊天回包模板：`好的{称呼}，已记下：6月3日(周三) 14:00 跟导师开会`
- 每日推送模板示例：

```
☀️ 元气老板早，今天是 5月25日 周一 农历四月初九

🌤 武汉 多云 22~28℃ · 降水 10%

📋 今日提醒
  · 14:00 跟导师开会
  · 19:30 阅读小组

🍱 中餐：东一 · 水煮肉片
       (周一不吃辣？说不定今天破例)
🍜 晚餐：广八路 · 烤鱼
       (天气不错，出去走走解锁新店)

——出门撒野老板，今天可以试试新店
```

- 空提醒文案：`📋 今日提醒\n  · 哈哈老板今天没记事项，是个闲人`（其余区域照常推）。
- 任一外部数据缺失（天气 / 农历）→ 对应区块整段省略，不出现 `undefined` 或孤立标点。

## 6. 数据流

### 6.1 聊天编辑（同步，5 秒预算）

```
用户消息 → /wechat
        → 签名校验
        → parser.parse
        → store.{add|list|delete|set}
        → formatter.replyXml
        → 返回 XML
```

约束：

- 5 秒内完成，路径中**不**调用任何外部 API（天气、微信主动推送都禁止）。
- 整个 handler 必须 try/catch，异常时也要返回合法 XML，避免微信 3 次重试导致重复入库。
- 解析失败 → 友好提示 + 示例。

### 6.2 每日推送（cron）

- cron 表达式：UTC `0 23 * * *`（= 北京时间次日 07:00）。
- 串行处理用户；每个用户用 `try/catch` 包裹，单用户失败不影响其他人。
- `markPushed` 仅在 `sendText` 成功后写。

### 6.3 access_token 生命周期

```
读 KV wx:access_token
  ├─ 命中 + 剩余 > 5 分钟 → 直接用
  └─ 否则 → 调 /cgi-bin/token → 写 KV (TTL 7000s) → 返回
```

token 用 KV 共享而非 Worker 内存（Worker 无状态、isolate 不固定）。

### 6.4 重复提醒展开

- 创建时存 `repeat: { type, spec }`，**不**复制为多条。
- 推送当天比对规则（今日是周几 / 几号）→ 命中则放入"今日列表"。
- 推送成功后，把 `today` 加进该重复条目的 `pushedDates`，作幂等保护（同日多次 cron 触发不会重复推）。
- 重复提醒永不进 history、永不被 purge，永久保留直到用户主动删。
- 单次提醒推送成功后从 `reminders` 中移除、转入 `history`。

## 7. KV Schema

| Key | 内容 | TTL |
|---|---|---|
| `user:{openid}:reminders` | `Reminder[]` | 永久 |
| `user:{openid}:settings` | `{ pushAt: '07:00', tz: 'Asia/Shanghai' }` | 永久 |
| `user:{openid}:history` | 30 天滚动的已推单次提醒 | 永久（按内容裁剪） |
| `users:index` | OpenID 数组 | 永久 |
| `wx:access_token` | string | 7000 秒 |
| `weather:wuhan:{date}` | Weather JSON | 1 小时 |

## 8. 错误处理

| 场景 | 处理 |
|---|---|
| 微信签名校验失败 | 返回 401，不写日志（防刷） |
| parser 解析失败 | 友好回复 + 示例文案 |
| 天气 API 失败 | 推送省略天气段；餐厅推荐按 `isClearLike=false` 走 |
| 农历查询失败 | 省略农历，只显示公历 |
| 微信推送 API 失败 | 重试 1 次，仍失败则跳过，次日 cron 重试 |
| KV 写失败 | 直接抛，让 Worker 返 500（极少发生） |

## 9. 测试策略

### 9.1 单元测试（vitest）

| 模块 | 关键测试点 |
|---|---|
| `parser` | 表驱动覆盖各日期短语、时间、命令词、节日名、重复规则、特殊字符 |
| `parser` | 边界：今天=周三时"下周三"=7 天后；月末"下个月 3 号"跨月 |
| `calendar` | 已知日期农历对照、节日识别（中秋节 2026-09-25 等样本） |
| `meals` | 伪随机种子下 1000 次抽样校外占比落在 8%~12%；非晴天 0% 校外；空池不崩 |
| `greetings` | 雨天不返回"出门撒野老板"；slot 过滤正确 |
| `store` | 用 Miniflare mock KV：add/list/delete/purge 行为；history 30 天裁剪 |
| `formatter` | 空状态：无提醒、无天气、无农历——文案不会出现 `undefined` 或孤立标点 |

### 9.2 集成测试（Miniflare）

- POST `/wechat` 模拟用户：加、列、删、非法签名、解析失败。
- 模拟 cron：2 个用户、各 2 条提醒（1 单次 1 重复）、mock 天气与微信接口，验证两人都被推、文案完整、`pushedDates` 更新；重复提醒不进 history、单次提醒进 history。

### 9.3 手测清单（部署后必跑一次）

- 关注测试号 → 发 `帮助` → 加一条 → 列表 → 删 → 次日 7:00 收到推送
- 推送中带伞建议在雨天显示
- 推送时间但当日无提醒：验证空提醒文案
- 故意改坏和风 API key：cron 跑一遍 → 验证降级（无天气段，餐厅按非晴天来）

### 9.4 不写测试的部分

- `pusher.ts` 调微信 API 的部分：依赖外部，单测意义小，靠集成测 + 手测兜底。
- 文案具体字符：模板会改，只断言"包含日期 / 包含提醒文本"等稳定字段。

### 9.5 部署前硬卡口

1. `pnpm test` 全绿
2. `wrangler dev` 本地跑通签名 + 加提醒 + 列表
3. `wrangler deploy --dry-run` 无报错
4. 部署后通过 wrangler 手动触发一次 cron（`wrangler dev --test-scheduled` 或在 dashboard 上 Trigger Event），确认收到推送

## 10. 0 成本边界

- 和风天气：1000 次/日；按 1 用户 × 1 次/日 + 1 小时缓存，单用户实际 ≤ 1 次/日。
- Workers：10 万次/日；每用户每天写 KV ≤ 50 次，远低于上限。
- KV 写：1000 次/日，唯一可能踩线项；个人/小群体场景不会触发。
- access_token 调用频率：2 小时内最多 1 次刷新，远低于微信日上限。

## 11. 部署与配置

- 仓库结构（建议）：

```
.
├── src/
│   ├── router.ts
│   ├── parser.ts
│   ├── store.ts
│   ├── calendar.ts
│   ├── weather.ts
│   ├── meals.ts
│   ├── greetings.ts
│   ├── pusher.ts
│   ├── daily.ts
│   ├── formatter.ts
│   └── data/
│       ├── canteens.ts
│       ├── offcampus.ts
│       └── comments.ts
├── test/
├── wrangler.toml
└── package.json
```

- `wrangler.toml` 关键配置：
  - `[triggers] crons = ["0 23 * * *"]`（UTC = CST 07:00）
  - `[[kv_namespaces]] binding = "KV"`
  - 环境变量：`WX_TOKEN`（微信签名 token）、`WX_APPID`、`WX_SECRET`、`QWEATHER_KEY`
  - secrets 通过 `wrangler secret put` 注入，不进仓库

## 12. 开放问题（实施时再细化）

- 重复提醒是否需要"截止日期"（暂定不需要，永久重复直到删除）。
- 用户主动取消关注时是否清理其数据（暂定保留，避免重新关注后丢失）。
- 历史记录的查询命令是否对外暴露（首版不实现，后续按需）。
