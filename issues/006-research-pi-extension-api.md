---

title: Research pi extension API and packaging surface
labels: [wayfinder:research]
status: closed
assignee: research-pi-api
blocked-by: []
---

## Question

pi 扩展开发的完整 API 面与打包发布方式：扩展生命周期与 `ctx` 各能力、`ui.setStatus` 的语义（多扩展 key 排序、各 mode 行为）、斜杠命令注册、自定义 TUI 组件（做 /usage 列表+详情）、配置文件读写惯例（settings 位置）、provider 凭据解析（如何不直接读 auth.json 拿到 OAuth token，hknet 用 createProvider/envApiKeyAuth 的做法）、主题 token 与 truecolor 转换、`pi install npm:` / GitHub 安装对 package.json 结构与打包的要求、定时轮询约束。产出 `research/pi-extension-api.md`。

## Resolution

研究完成，产物：[research/pi-extension-api.md](../research/pi-extension-api.md)（331 行，pi 1.4.0 文档 + .d.ts + 运行时 bundle + hknet 0.7.1 四重验证）。

要点：
- 生命周期：默认导出工厂函数，TS 经 jiti 直接加载无需打包；定时器必须在 `session_start` 启动，`session_shutdown` 幂等清理（reload/new/resume/fork 都会走）。
- `setStatus(key, text)`：key 排序后拼接进 footer 单行、超宽截断、支持 ANSI、实时重渲染；RPC 模式转发；非 TUI 模式要守卫。**注意：所有扩展共享一行 footer，无宽度保证**——cs 式长布局可能需要 `setFooter` 替代，这是样式原型票要验证的点。
- 凭据：`ctx.modelRegistry` 是 sanctioned 路径（不读 auth.json）；hknet 的 host 白名单路由（`PROVIDER_HOSTS` + gateway 特例）是检测票的直接参考。
- 四家的内置 provider ID 全表已拿到：`anthropic` / `openai`（含 ChatGPT 订阅 OAuth）/ `openai-codex`（1.4.0 标 legacy！）/ `zai` / `zai-coding-cn` / `minimax` / `minimax-cn`。
- 打包：`pi` manifest 字段、peerDependencies 规则、npm/GitHub 安装与 ref 钉死部已成文。

关键疑点（留给检测票 008）：pi 1.4.0 里 ChatGPT 订阅 OAuth 到底挂在 `openai` 还是 legacy 的 `openai-codex`，需要在本机 `/login` 实测；另 `AuthResult.source == "OAuth"` 是未文档化契约，有更稳的替代候选。
