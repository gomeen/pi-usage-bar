---

title: Release process (npm name, pi community, automation)
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

发布流程定稿（toolchain 已关）：npm 包名查重与 scope 选择（`pi-usage-bar`/`@gomeen/pi-usage-bar` 等，`@hk_net/pi-usage-bars` 已存在需避开）、pi 社区收录途径（pi packages 生态的正式入口是什么、awesome 列表？）、发版自动化程度（tag→GitHub Release→npm publish 手动/半自动/全自动）、README 中英双语结构与致谢（hknet/cs/cxs MIT）。

## Resolution

1. **包名：`@gomeen/pi-usage-bar`**（实测可用；裸名 `pi-usage-bar`/`pi-usage-bars` 已被占）。安装：`pi install npm:@gomeen/pi-usage-bar`。
2. **社区收录**：package.json 加 `pi-package` 关键字 + `pi.image` 预览图，进入官方画廊 pi.dev/packages。
3. **发版全自动（用户指定，覆盖半自动建议）**：打 tag → GitHub Actions 自动跑全部检查 → 自动 `npm publish`。前置条件：仓库 secret 配 NPM_TOKEN（granular access token，仅授权该包）；hknet 的 2FA 人工确认问题用 granular token 规避。
4. **README 双文件（用户指定）**：`README.md` 纯英文 + `README.zh.md` 纯中文，顶部互链；致谢节带仓库链接：[hknet/pi-usage-bars](https://github.com/hknet/pi-usage-bars)、[leeguooooo/claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar)、[leeguooooo/codex-statebar](https://github.com/leeguooooo/codex-statebar)（均 MIT）。
