---

title: Toolchain and scaffold lock
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

工程化基线锁定（含用户追加的代码分层/复用/可维护性/功能测试）：TypeScript 布局与模块分层、测试策略（单测/golden/集成/冒烟）、lint 与 CI、npm 打包与 `pi install npm:` 兼容的 package.json 结构、发版流程（GitHub Release + npm publish 的顺序与自动化程度）。

## Resolution

**架构：一个深模块 + 三条缝**。领域模型 `UsageSnapshot` 贯穿全链，三消费者（footer / `/usage` 视图 / `--usage` JSON）同吃一个模型：

- 缝 1【数据】`providers/facade.ts` 唯一对外接口 `fetchAll(targets, { fetch, now, cache })`（依赖注入）；每家 adapter 内部分"拉取 IO + 解析纯函数"内缝；resets.ts（codex-resets）与 relay.ts 同层。一家报错只污染自己的 snapshot。
- 缝 2【渲染】`render/` 纯函数零 IO：theme（cs 规格移植）/bar 原语/layout（`renderStatus(snapshots, config, width) → string[]` 支持换行）。加 look 只动 render/，加 provider 只动 providers/。
- 缝 3【pi 适配】`src/pi/` 唯一碰 pi API 的地方：footer（setStatus/setFooter/宽度/换行）、usageView、commands、compat（未文档化面隔离）。缝外代码不 import pi 包。
- `detect.ts`（ID/host→PlanKind，含 providerMap，纯函数）、`config.ts`（file < env 合并）、`index.ts` 薄入口（生命周期/定时器/装配）。
- 目录：`src/{index,types,detect,config}.ts + src/{providers,render,pi}/`；`tests/fixtures/` 存研究文档里的真实 payload。

**工具链（均按用户拍板）**：vitest；零运行时依赖（node 22+ 全局 fetch/AbortController，配置校验手写不引 zod）；biome（lint+format 单 dev-dep）；TS 源码直发无构建（hknet 模式，pi jiti 直接加载），CI 内 `tsc --noEmit` strict。

**功能测试四层**：L1 fixture 单测（解析器/格式化/detect 优先级/config 合并，含 429/401/2062/limits[] 变体）→ L2 golden ANSI 快照（cs 规格工作示例为基准）→ L3 集成（假 fetch+假时钟：轮询/缓存/错误隔离/abort）→ L4 手动冒烟（`pi --usage` 真实凭据，不进 CI）。

**CI（GitHub Actions）**：typecheck → vitest → `npm pack --dry-run`。发版细节（npm 查重、publish 自动化）留给发布票（雾区）。
