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
7. **015 要求的 `pi.image` 预览图尚未产出**（仓库目前无图片文件），画廊收录需要时随 0.1.1 补：图片入库并加进 `package.json` 的 `files` 白名单。
