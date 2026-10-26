# pi-usage-bar

[English](README.md) · [简体中文](README.zh.md)

[Pi](https://github.com/earendil-works/pi) 编码智能体的订阅套餐用量条——配额窗口、重置倒计时、中转站余额、官方重置公告，样式对齐 [claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar)。

## 功能

- **footer 用量条**：当前模型对应套餐的两个配额窗口（会话 + 周窗），每格渐变 bar + `⏰` 重置倒计时
- **四种 look**：aurora 块条（默认）、aurora 细线、ring（`◔ 14% 5h · resets 1h07m`）、classic 电池条——全部可实时切换
- **中转站余额**：one-api/new-api 系中转的自定义 provider 自动探测计费端点，显示剩余金额（`bal $200.00`）
- **官方重置公告**：Codex 套餐接入 [codex-resets.com](https://codex-resets.com)（`↻ Official reset · 21h ago`）
- **`/usage`** 单一入口查看套餐详情或进入内层 **Settings**，**`--usage`** 一行 JSON 冒烟测试

## 支持的套餐

| 套餐 | Pi provider id | 认证 |
|---|---|---|
| OpenAI Codex (ChatGPT) | `openai`、`openai-codex` | ChatGPT 订阅 OAuth —— **用量查询需要 `openai-codex`（"OpenAI Codex"）登录**：`openai` 的 ChatGPT 直用令牌无法访问 backend-api 用量端点。`/login` → OpenAI Codex 登一次即可。 |
| Anthropic Claude | `anthropic` | Claude Pro/Max OAuth |
| ZAI Coding Plan（国际/国内） | `zai`、`zai-coding-cn` | API key |
| MiniMax Token Plan（国际/国内） | `minimax`、`minimax-cn` | API key |
| 中转站（one-api/new-api 系） | 任意自定义 provider id | API key |

自定义 provider（代理、cc-switch 条目）会自动探测中转计费端点；也可以用 `providerMap` 显式映射到某个套餐。

## 安装

```bash
pi install npm:@gomeen/pi-usage-bar
```

重启 Pi（或 `/reload`）。套餐认证走 Pi 的 `/login`——扩展通过 Pi 的 provider API 解析凭据，从不直接读 `auth.json`。

## 配置

配置在 `~/.pi/agent/usage-bar.json`（稀疏写入——只存非默认键）。可以直接改文件，也可以打开 `/usage` → **Settings**，再选择 **Appearance**（外观）、**Display**（显示内容）或 **Advanced**（高级）。Enter/Space 切换值并立即保存。**Appearance** → **Bar style** 实时预览并选择四种样式；**Display** 管理显示套餐、重置信息和余额；**Advanced** 包含刷新间隔和 **Provider mapping** 配置说明，结构化的 `providerMap` 条目仍在 JSON 文件中编辑。Esc 逐级返回。

| 键 | 默认 | 含义 |
|---|---|---|
| `style` | `"aurora"` | `aurora` \| `ring` \| `classic` |
| `bar_glyph` | `"block"` | `block` \| `thin`（aurora 用） |
| `theme` | `"graphite"` | `graphite` \| `"pi"`（跟随 pi 主题） |
| `density` | `"regular"` | `compact` \| `regular` \| `cozy` |
| `bar_width` | `12` | bar 格数 |
| `color_ok` / `color_warn` / `color_hot` | `""` | `#rrggbb` 覆盖 |
| `warning_threshold` / `critical_threshold` | `30` / `70` | 百分比 |
| `display.mode` | `"all"` | `active`（当前套餐）\| `all`（全部已配置套餐） |
| `display.providers` | `[]` | `all` 模式的套餐过滤 |
| `display.compact_others` | `true` | 非当前套餐压缩为一行简报 |
| `providerMap` | `{}` | 自定义 id → 套餐，如 `{"cc-switch-zhipu-glm": "zai-cn"}` 或 `{"my-relay": {"type": "relay"}}` |
| `refresh_minutes` | `2` | 轮询间隔（分钟） |
| `show_resets` | `true` | 官方重置公告 |
| `show_reset_countdown` | `false` | 每个窗口的 `⏰` 重置倒计时 |
| `show_balance` | `true` | 中转余额探测 |
| `currency` | `"$"` | 余额货币符号 |

第一方监控端点可用环境变量覆盖：`PI_ZAI_USAGE_ENDPOINT`、`PI_ZAI_CODING_CN_USAGE_ENDPOINT`、`PI_MINIMAX_USAGE_ENDPOINT`、`PI_MINIMAX_CN_USAGE_ENDPOINT`（含 legacy 变体）。**provider token 会作为 Bearer 发送到所配置的端点——只覆盖你信任的端点。**

## 安全

- token 只发给第一方端点（或中转站自己的 host、用它自己的 key）
- token 永不出现在日志、`/usage`、`--usage` 输出里
- 从不读写 `auth.json`；凭据全部通过 Pi 的 `modelRegistry` 解析

## 开发

```bash
npm install
npm run check   # tsc --noEmit + biome + vitest
```

架构：一个深模块（`UsageSnapshot` 管线）+ 三条缝——数据（`src/providers/`）、渲染（`src/render/`，纯函数）、pi 适配（`src/pi/`）。见 [AGENTS.md](AGENTS.md)。

## 致谢

本项目受三个 MIT 项目启发（借鉴思路，不搬代码）：

- [hknet/pi-usage-bars](https://github.com/hknet/pi-usage-bars) —— 各家用量 API 的调研参考
- [leeguooooo/claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar) —— aurora 样式与配置词汇
- [leeguooooo/codex-statebar](https://github.com/leeguooooo/codex-statebar) —— ring 样式与官方重置行

## 许可

[MIT](LICENSE)
