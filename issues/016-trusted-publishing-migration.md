---

title: Trusted publishing (OIDC) migration for npm release
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

015 定的发版链路是「tag → CI → npm publish」，前置条件是仓库 secret 配 granular access token（bypass 2FA，仅授权该包）。npm 2025-09-29 与 2026-07-08 两次公告之后这条路线的成本变了：新发的 write token 默认 7 天过期、最长 90 天；bypass-2FA token 自 2026-08 起不能再做账号身份/治理动作，2027-01 起失去直接发布能力（只剩 stage）。是否改用 OIDC 可信发布？首次发布（包尚未存在于 registry）怎么发？

## Resolution

1. **改用 trusted publishing (OIDC)**，`release.yml` 去掉 `NODE_AUTH_TOKEN`，加 `id-token: write`、`node-version: 24` + `npm install -g npm@latest`（OIDC 要求 npm CLI ≥ 11.5.1）、`package-manager-cache: false`。发版仍是 tag → CI → publish 全自动（015 的「全自动」目标不变），但不再有 token 轮换负担，public 仓库还自动带 provenance。
2. **首次发布必须交互式**：`@gomeen/pi-usage-bar` 2026-10-26 查为 404，Trusted Publisher 配置位于包的设置页，包必须先存在才能配。首次用 `npm login --auth-type=web` + `npm publish --access public`，浏览器内 WebAuthn（Touch ID）确认，不产生任何长期凭据。
3. **npm 12 安装期默认变更对本包无影响**：依赖树只有 `@google/genai`（preinstall 仅 echo）与 `protobufjs`（postinstall 仅打印提示），无 `binding.gyp` / node-gyp 原生构建，`allowScripts` 默认关闭不影响 `npm ci`。
4. **配好 Trusted Publisher 后 2 天内必须完成一次成功发布**，否则配置过期需删除重建。验证版本用 0.1.1（0.1.0 已被交互式发布占用，同版本不能重发）。
5. **发布后收紧**：包 Settings → Publishing access → “Require two-factor authentication and disallow tokens”；账号设置 Link with GitHub 作为账号找回通道。
6. **2FA 只有 WebAuthn 一条路**：npm 自 2025-10 起永久禁用新的 TOTP（Authenticator app）配置，新账号只能用 security key / passkey。
7. **015 要求的 `pi.image` 预览图尚未产出**（仓库目前无图片文件），画廊收录需要时补：图片入库并加进 `package.json` 的 `files` 白名单。

## 实测记录（2026-10-27）

- **首次发布走的是 staged publishing**：registry 自动公开占位版本 `0.0.0-stage`（`stub: true`，2 文件），真实版本在暂存队列待 2FA 批准。该占位版本永久留在版本列表里，不是错误产物，无需处理。
- **发布后 registry 落地有延迟**：`npm publish` 返回 202 后约 2 分钟内 `npm view <pkg>` 仍报 E404（包尚未可读），并非权限问题。
- **0.1.1 走 OIDC 真实发布成功**：CI 走 `npm publish --access public`（无 token），registry 返回 SLSA v1 provenance attestations，透明日志 `search.sigstore.dev/?logIndex=3501953180`；`gitHead` 与 tag `v0.1.1` 一致。Trusted Publisher 绑定完成，2 天窗口条件满足。
- **0.1.0 无 provenance**：交互式发布不生成 attestations，属预期；provenance 只在 OIDC 发布时自动产生。
- **`npm version patch` 自带 commit + tag**（message 仅为版本号），发版时需 amend 成描述性英文 message 并重打 tag。
- **发布工作流加幂等保护**：`release.yml` 先匿名读 registry 判断版本是否已存在，已存在则跳过 `npm publish`，重推同一 tag 不会撞版本冲突。
- **npm 12 在 CI 中实测通过**：`npm ci` 仅提示 `@google/genai`（preinstall echo）与 `protobufjs`（postinstall 提示）脚本被拦截，无 `binding.gyp`/node-gyp 构建，`tsc --noEmit` 与 216 个 vitest 用例全绿，无需配置 `allowScripts`。
- **npmjs.com 的 Trusted Publisher 表单页可能显示过期状态**（版本号、版本计数、发布时间都是旧的），刷新后确认已有条目，勿重复创建——创建后 provider 与必填字段不可修改。
