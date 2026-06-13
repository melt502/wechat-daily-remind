# WeChat Daily Reminder / 华师微信日常提醒助手

一个面向华中师范大学学生的微信日常提醒与校园生活小助手。用户可以通过微信公众号/微信测试号发送自然语言消息来添加、查看、修改、删除提醒；系统支持每日汇总推送、具体事项提前 30 分钟提醒、天气与随机餐食推荐，并可部署到腾讯云 SCF 定时运行。

## 功能特性

### 提醒管理

- 自然语言添加提醒：`明天下午3点提醒我交作业`
- 批量添加提醒：`明天8:30起床，9:30去图书馆学习，12:00抢活动名额`
- 查看提醒：`查看今天`、`查看明天`、`查看本周`、`查看全部`、`最近提醒`
- 修改提醒：`修改第2条为下周五晚8点交论文`
- 删除提醒：`删除第3条`
- 设置每日汇总时间：`设置每日提醒时间 7:30`

### 确认机制

为避免误操作，以下操作会先进入确认流程：

- 模糊添加，例如缺少具体时间：`提醒我交作业`
- 修改提醒
- 删除提醒

确认词：`确认`、`好`、`好的`、`是的`、`OK`、`ok`

取消词：`取消`、`算了`、`不要了`、`不用了`

待确认操作默认保留 10 分钟，过期后需要重新发送命令。

### 学生常用表达解析

支持常见日期表达：

- 今天、明天、后天、3 天后
- 本周三、这周三、下周五、下下周一
- 6月20日、6/20、2026-06-20
- 月底、下个月1号

支持常见时间表达：

- 早八、早八半
- 上午10点、中午12点、下午3点
- 晚上8点、晚八、八点半
- 23:59、晚上11点59

支持重复提醒：

- 每天晚上11点提醒我充电
- 每周一早上8点提醒我上英语课
- 每月15号提醒我交话费

### 每日推送

每日推送包含：

- 日期、星期、农历/节日信息
- 天气信息和带伞提示
- 今日提醒列表
- 随机中餐、晚餐推荐
- 个性化问候和签名

### 提前提醒

带具体时间的提醒会在事项开始前约 30 分钟推送一次。

### 诊断能力

腾讯云 SCF 部署后，可通过 `/cron` 手动触发定时任务并查看结构化 JSON 摘要，用于排查：

- SCF 是否触发
- Redis 中是否有用户和提醒
- 是否进入推送窗口
- 微信客服消息接口是否失败
- 是否遇到 `45015` 客服消息窗口过期问题

## 使用示例

### 添加提醒

```text
明天下午3点提醒我交作业
今晚8点提醒我开组会
早八提醒我上英语课
6月20日提醒我四六级报名
下午5点提醒我取快递
```

### 查看提醒

```text
查看今天
查看明天
查看本周
查看全部
最近提醒
```

### 修改提醒

```text
修改第2条为明天下午3点交作业
修改第1条为下周五晚8点交论文
```

### 删除提醒

```text
删除第3条
```

### 设置每日推送时间

```text
设置每日提醒时间 7:30
设置推送时间 08:00
```

### 查看帮助

```text
帮助
```

## 项目结构

```text
.
├── api/                 # Vercel/HTTP 入口
├── docs/                # 设计文档
├── scripts/             # SCF 打包脚本
├── src/
│   ├── calendar.ts      # 公历/农历/节日信息
│   ├── daily.ts         # 每日推送和提前提醒任务
│   ├── env.ts           # 环境变量解析
│   ├── formatter.ts     # 回复文案格式化
│   ├── greetings.ts     # 问候语和签名
│   ├── meals.ts         # 随机餐食推荐
│   ├── parser.ts        # 自然语言命令解析
│   ├── pusher.ts        # 微信客服消息发送
│   ├── router.ts        # 微信消息路由和业务编排
│   ├── store.ts         # Redis 数据访问
│   ├── types.ts         # 类型定义
│   └── weather.ts       # 天气查询与缓存
├── test/                # Vitest 测试
├── scf-main.ts          # 腾讯云 SCF 入口
├── package.json
├── tsconfig.json
└── tsconfig.scf.json
```

## 环境变量

部署前需要配置以下环境变量：

| 变量名 | 说明 |
| --- | --- |
| `WX_TOKEN` | 微信公众号/测试号服务器配置 Token |
| `WX_APPID` | 微信 AppID |
| `WX_SECRET` | 微信 AppSecret |
| `UPSTASH_REDIS_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_TOKEN` | Upstash Redis REST Token |
| `QWEATHER_KEY` | 和风天气 API Key |
| `QWEATHER_HOST` | 和风天气 API Host |

## 本地开发

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
npm test
```

当前测试覆盖 parser、store、formatter、daily、pre-push、pusher、SCF 入口等关键模块。

### Cloudflare Worker 本地运行

```bash
npm run dev
```

### Cloudflare Worker 部署

```bash
npm run deploy
```

## 腾讯云 SCF 部署

### 1. 构建 SCF 代码

```bash
npm run build:scf
```

### 2. 生成上传包

```bash
npm run pack:scf
```

成功后会生成：

```text
scf-deploy.zip
```

### 3. 上传到腾讯云 SCF

在腾讯云 SCF 控制台中上传 `scf-deploy.zip`。

函数入口建议使用：

```text
scf-main.main_handler
```

### 4. 配置触发器

建议配置：

- API Gateway：接收微信消息和手动访问 `/cron`、`/debug`
- Timer 定时触发器：每 10~15 分钟触发一次，用于每日汇总和提前提醒扫描

### 5. 常用诊断接口

```text
GET /debug
```

用于检查环境变量解析和 Redis 连通性，不触发推送。

```text
GET /cron
```

手动执行定时任务，返回结构化摘要，便于排查自动提醒问题。

## 微信配置说明

在微信公众号或微信测试号后台配置服务器地址时，需要指向你的 HTTP/API Gateway 地址。

微信会通过 GET 请求验证签名，项目会使用 `WX_TOKEN` 进行校验。

用户发送消息后，微信会通过 POST XML 转发给本项目，项目解析消息并回复 XML。

## 数据存储

项目使用 Upstash Redis 存储：

- 用户提醒列表
- 用户设置
- 已推送状态
- 提前提醒状态
- 待确认操作
- 微信消息去重标记

主要 key 形式：

```text
user:{openid}:reminders
user:{openid}:settings
user:{openid}:pending-action
user:{openid}:prepush:{date}
user:{openid}:daily-push:{date}
users:index
msg:dedup:{MsgId}
```

## 注意事项

### 微信客服消息窗口限制

当前主动推送通道使用微信客服消息接口。长期未与公众号互动的用户可能遇到微信错误码 `45015`，表示客服消息窗口过期。

如果 `/cron` 摘要中出现 `wechat-window-expired` 或 `45015`，说明定时任务可能已经正常运行，但微信拒绝向该用户发送客服消息。后续可考虑模板消息、订阅消息或其他合规推送通道。

### 不包含实时校园数据

当前项目不会实时查询：

- 华师课表
- 食堂菜单
- 图书馆座位
- 校车信息
- 校园网状态

如果用户询问这些信息，助手会引导用户设置提醒，而不会假装知道实时数据。

## 常用命令速查

```bash
npm install          # 安装依赖
npm test             # 运行测试
npm run build:scf    # 构建 SCF 代码
npm run pack:scf     # 生成 scf-deploy.zip
npm run dev          # 本地运行 Worker
npm run deploy       # 部署 Cloudflare Worker
```

## License

Private project.
