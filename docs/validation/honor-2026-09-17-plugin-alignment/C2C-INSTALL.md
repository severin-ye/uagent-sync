# C2C 固定来源与安装说明

## 固定版本

- 仓库：`https://github.com/XiaoDuoYa/codex-with-chatgpt.git`
- 提交：`9663b88753e35c76796c5bce000293e0bd22cd9e`
- 包版本：`0.1.3`
- Node.js：`>=20`
- pnpm：`11.24.0`（由 `packageManager` 字段固定）

## 惠普安装步骤

下面的 `<checkout>` 使用惠普自己的长期目录，例如 `C:\Users\severin\codex-with-chatgpt`。

```powershell
git clone https://github.com/XiaoDuoYa/codex-with-chatgpt.git <checkout>
git -C <checkout> checkout --detach 9663b88753e35c76796c5bce000293e0bd22cd9e
Set-Location <checkout>
corepack pnpm install --frozen-lockfile
corepack pnpm build
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills\codex-with-chatgpt" | Out-Null
Copy-Item "<checkout>\skill\SKILL.md" "$env:USERPROFILE\.codex\skills\codex-with-chatgpt\SKILL.md" -Force
```

复制后，只把安装 Skill 中下面一行的占位路径替换为惠普实际 `<checkout>`：

```text
The codex-with-chatgpt checkout lives at: `<ACTUAL_CHECKOUT_PATH>`
```

验证命令：

```powershell
node "<checkout>\bin\c2c.js" --version
node "<checkout>\bin\c2c.js" status --json
```

首次连接在惠普本机按安装 Skill 的 first-time setup 执行。不要从荣耀复制 ChatGPT/Cloudflare 登录、OAuth、Cookie、配对码或 `%LOCALAPPDATA%\codex-with-chatgpt` 运行状态。

