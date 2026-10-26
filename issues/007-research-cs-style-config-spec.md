---
title: Research cs/cxs style and config spec
labels: [wayfinder:research]
status: open
assignee: research-subagent
blocked-by: []
---

## Question

从 claude-code-usage-bar 与 codex-statebar 源码提取完整样式规格，达到「不看 Python 源码就能用 TypeScript 重写渲染器」的程度：四种 look（aurora block / thin / ring / classic）的渲染器逐段规格、字形（■ ━ ◔ 及 edge 色）、bar 宽度、每格按位置的颜色混合公式（s_ok→s_warn→s_hot）、severity RGB 计算函数、graphite 调色板精确 RGB 值、百分数格式（粗体右对齐）、⏰ 倒计时格式（1h07m、去秒规则）、`· resets …` 措辞、分隔符与 density padding、warning/critical 阈值默认值、全部配置键与默认值、narrow_layout 堆叠行为。产出 `research/cs-style-spec.md`。
