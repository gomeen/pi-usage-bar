---

title: Multi-relay identity and selection
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

一个 pi 装了多个中转 provider 时，用量条只显示其中一个的余额；而且 h-self 与 h-company 指向同一个 host、只是 key 不同，两者无法共存。哪一层该负责区分它们？

## 根因

三处叠加：

1. **中转快照的身份是 host**（`probeRelayBalance` 把 `snapshot.provider` 设为 baseUrl 的 host）。同站不同 key 的两个 provider 身份相同 → 显示名撞车、缓存互相污染。
2. **快照选择按 plan 折叠**（`index.ts` 的 `byPlan` Map，键是 `PlanKind`）。所有中转的 `plan` 都是 `"relay"` → 多个中转只活下来一个。
3. **last-good / 退避槽位按 plan 索引**（`facade.ts` 的 `lastGood` / `backoff`）。中转之间共用 `"relay"` 槽 → 一个中转失败会显示另一个的余额。

## Resolution

**身份**：中转快照的 `provider` 改为 **pi provider id**（`h-self` / `h-company` / `4sapi`），host 只用于发请求和算缓存键。同一 host 上不同 key 是不同账户，必须能分开。

**选择**：新增纯模块 `src/select.ts`：
- `snapshotKey(plan, provider)` —— 官方套餐一个 plan 一个槽（`openai` 与 `openai-codex` 同属 codex，共用）；中转一个 provider 一个槽（`relay:h-self`）。
- `selectSnapshots(snapshots, activeProviderId)` —— 按槽去重，active provider 优先。官方套餐仍折叠为一条，中转全部保留。

**状态**：facade 的 last-good / 退避改用同一套 `snapshotKey` → 中转之间不再串味。

**缓存**：中转缓存键 = host + token 指纹（sha256 前 8 位）+ 缓存版本号。token 指纹让同站不同 key 各自独立；版本号让新增端点族时旧的 "absent" 判定不压制 7 天。

**探测端点族**（`src/providers/relay.ts`，见 issue 013 修订）：
1. one-api / new-api：`{site}/v1/dashboard/billing/subscription` + `/v1/dashboard/billing/usage` → `hard_limit_usd − total_usage/100`
2. Sub2API 风格：`{site}/v1/usage` → `balance`（兼容 `remaining`、`quota.limit−used`）

一族缺失才回退到下一族，两族皆缺才负缓存。base URL 归一化：剥掉尾部 `/v1` 再拼路径（修掉 `https://host/v1` 变成 `/v1/v1/...`）。

## 实测

pi 运行时（本地路径安装）三个中转同时显示：

```
4sapi bal $200.00 │ h-self bal $2028.99 │ h-company bal $4462.95
```

## 决策记录

- 中转显示名用 pi provider id，不用 host：host 可能同站多账户，provider id 才是用户认的账户名。
- 官方套餐保持按 plan 折叠（`openai` / `openai-codex` 是同一份 ChatGPT 订阅）。
- 选择逻辑放纯模块 `src/select.ts`，不放 `index.ts`（pi 接缝不做业务判断），可单测。
