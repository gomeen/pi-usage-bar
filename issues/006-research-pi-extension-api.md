---
title: Research pi extension API and packaging surface
labels: [wayfinder:research]
status: open
assignee: research-subagent
blocked-by: []
---

## Question

pi 扩展开发的完整 API 面与打包发布方式：扩展生命周期与 `ctx` 各能力、`ui.setStatus` 的语义（多扩展 key 排序、各 mode 行为）、斜杠命令注册、自定义 TUI 组件（做 /usage 列表+详情）、配置文件读写惯例（settings 位置）、provider 凭据解析（如何不直接读 auth.json 拿到 OAuth token，hknet 用 createProvider/envApiKeyAuth 的做法）、主题 token 与 truecolor 转换、`pi install npm:` / GitHub 安装对 package.json 结构与打包的要求、定时轮询约束。产出 `research/pi-extension-api.md`。
