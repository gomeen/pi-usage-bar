---
title: Charting decisions locked
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

建图前两轮 grilling：目的地、范围、样式、配置机制如何锁定？

## Resolution

**Round 1**

1. **交付物形态**：发布到 pi 社区和 GitHub 供大家使用——按可发布标准写（MIT、测试、README）。
2. **与 hknet/pi-usage-bars 的关系**：从零写，不 fork、不移植其代码；其实现仅作各家 API 形状的参考，README 致谢。
3. **Provider 范围**：v1 只支持 Codex（ChatGPT 订阅 OAuth）、Claude（Pro/Max OAuth）、ZAI（国际 + 国内）、MiniMax（国际 + 国内）。
4. **样式**：与 claude-code-usage-bar 一致；cs 可配置的维度全部做成可配置（aurora block / thin / ring / classic 全 look）。
5. **重置时间**：cs 式 `⏰2h15m` 倒计时为默认，格式可配（紧凑倒计时 / `resets …` 自然语言 / 绝对时间）。

**Round 2**

- **配置机制（R1-Q6 选 C）**：三层——`~/.pi/agent/` 下 JSON 配置文件为基准 + pi 斜杠命令交互修改 + 环境变量覆盖端点（沿用 hknet 的 `PI_*_ENDPOINT` 命名惯例）。
- **footer 显示策略**：默认只显当前模型对应的 plan，`display.mode: "active" | "all"` 可切；当前模型无匹配 plan 时退回显示全部已配置 plan，代理场景不空屏。
- **`/usage` 命令**：v1 就做简单版——列表 + 选中展开详情，不做搜索分页。
- **providerMap**：支持自定义 provider ID → plan 的手动映射（如 `cc-switch-zhipu-glm` → `zai-cn`），社区里用中转/代理用户的刚需。
- **颜色基准（选 C）**：默认 cs graphite 固定调色板（truecolor），可配置切换为跟随 pi 主题 token；保留 `color_ok` / `color_warn` / `color_hot` 覆盖键。
- **附加 segments**：v1 一个不做，纯配额 bars + 重置倒计时（+ API-key 类 plan 的余额行）。
- **包名**：仓库名保持 `pi-usage-bar`，npm 包名发布前查重再定。
- **i18n**：v1 只英文，README 中英双语。
