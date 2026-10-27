---

title: Style prototype with fake data
labels: [wayfinder:prototype]
status: closed
assignee: main-session
blocked-by: [7]
---

## Question

样式原型：用假数据渲染四种 look（aurora block / thin / ring / classic）× density × 阈值变体的实际终端效果（ANSI 直出或 HTML 预览），供用户拍板视觉细节：bar 宽度、分隔符、⏰ 位置与格式、多 bar 并排 vs 窄终端堆叠、四家 provider 同显时的布局、中转站余额行（`bal[████ 29%] $200.00` 油表条，见 013 票）的摆放，以及官方重置公告行（`↻ Official reset · X前` 等，见 012 票）的摆放与折叠规则；顺带拍板 cs 绿 vs cxs 青绿的默认 s_ok、无配额/错误/stale 状态样例。

## Resolution

原型：[prototypes/style-demo.html](../prototypes/style-demo.html)（假数据、可交互切换 look/density/s_ok/显示模式，A–F 六区）。全部拍板：

- **默认 look：aurora block**（12 格 ■ 块条、每格按位置渐变 s_ok→s_warn→s_hot）；thin / ring / classic 可配置切换。
- **s_ok 默认：cs 绿 (78,200,91)**；cxs 青绿可配。
- **bar 12 格 + density regular** 出厂默认。
- **↻ 官方重置公告：跟在 Codex 段尾**（不单独成一行）。
- **⏰ 倒计时格式：cs 原样**（5h 窗 `2h15m`/`37m`，7d 窗 `3d04h`）。
- **中转站余额：只显剩余金额**（`$200.00`），不画油表条、不显百分比/总额；计算仍为 `hard_limit_usd − total_usage/100`，无 limit/usage 时的退化在稳健性票处理。
- **显示策略：配置优先，未配置显全，超宽换行**——`display.providers` 过滤 + `display.mode: active|all`；未配置时显示全部完整内容；超宽**换行**而非截断/自动降级（F2 去⏰/F3 bar8 阶梯方案否决）。
- **实现期验证点**：pi `setStatus` 是截断语义，真换行需走 `setFooter` 自定义 footer——实现时验证 pi 多行 footer 支持；若不可行，退化方案 = 每家一行堆叠（信息不丢）。
- 窗口标签按时长动态生成（013 票）；无配额/错误/stale 状态样式按 demo C 区（`usage unavailable (429)`、`⟳ 5h/7d stale·refresh`）。
