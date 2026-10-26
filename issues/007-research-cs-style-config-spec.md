---
title: Research cs/cxs style and config spec
labels: [wayfinder:research]
status: closed
assignee: research-cs-style
blocked-by: []
---

## Question

从 claude-code-usage-bar 与 codex-statebar 源码提取完整样式规格，达到「不看 Python 源码就能用 TypeScript 重写渲染器」的程度：四种 look（aurora block / thin / ring / classic）的渲染器逐段规格、字形（■ ━ ◔ 及 edge 色）、bar 宽度、每格按位置的颜色混合公式（s_ok→s_warn→s_hot）、severity RGB 计算函数、graphite 调色板精确 RGB 值、百分数格式（粗体右对齐）、⏰ 倒计时格式（1h07m、去秒规则）、`· resets …` 措辞、分隔符与 density padding、warning/critical 阈值默认值、全部配置键与默认值、narrow_layout 堆叠行为。产出 `research/cs-style-spec.md`。

## Resolution

研究完成，产物：[research/cs-style-spec.md](../research/cs-style-spec.md)（635 行，逐条 file:line 引用）。

要点：
- 四种 look 全部成段规格化（含 ring 的 ○◔◑◕● 五档字形 quanta、classic 的 battery 布局），带 ANSI 工作示例。
- graphite 精确 RGB（ink/mute/edge/s_ok/s_warn/s_hot/wt）；severity 取色梯（30/70 阈值 + 70/85 投影带）。
- cs 与 cxs 两份完整配置键表（类型 + 默认值 + 解析优先级），TS 移植直接镜像。
- 格式化规则：⏰ 倒计时（1h07m/3d04h、<10 分钟保留秒）、K 缩写、`→NN%` 投影 chip 语法。

留给后续票的发现：cs 的 s_ok 是绿色 (78,200,91)，cxs 是青绿 (120,200,192)，模型 accent 混色也不同——默认色由样式原型票（010）定。severity 梯的 docstring 与常量不一致（80/100 vs 70/85），以常量为准。
