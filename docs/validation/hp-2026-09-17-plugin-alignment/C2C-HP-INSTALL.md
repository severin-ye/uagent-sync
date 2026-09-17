# 惠普 Codex with ChatGPT 固定安装回执

日期：2026-09-17

## 固定来源

- 仓库：`https://github.com/XiaoDuoYa/codex-with-chatgpt.git`
- 固定提交：`9663b88753e35c76796c5bce000293e0bd22cd9e`
- `package.json` 版本：`0.1.3`
- 运行依赖：Node `>=20`，`pnpm@11.24.0`
- 独立 checkout：`<HP_C2C_CHECKOUT>`
- Skill 安装入口：`<HP_CODEX_SKILL_PATH>`，其中 checkout 路径已替换为惠普实际 checkout

## 安装与验证

| 检查 | 命令/结果 | 退出码 |
|---|---|---:|
| 依赖 | `corepack pnpm install --frozen-lockfile` | 0 |
| 构建 | `corepack pnpm build` | 0 |
| 测试 | `corepack pnpm test`，178 tests passed | 0 |
| 版本 | `node <HP_C2C_CHECKOUT>\\bin\\c2c.js --version`，stdout `0.1.3` | 0 |
| 状态 | `node <HP_C2C_CHECKOUT>\\bin\\c2c.js status --json`，stdout `{"ok":false,"running":false}` | 0 |
| 全局入口 | `where.exe c2c` 未找到；使用 checkout 的 `node ...\\bin\\c2c.js` 入口 | 1（未找到） |
| Cloudflare 依赖 | `cloudflared` 未找到；首次连接前由安装流程按需处理 | — |

`doctor --no-fix --json` 真实结果为：Node `v24.19.0` 可用、工作区可用、沙箱白名单未设置、Bridge 未运行、没有需要修复的连接，退出码 0。`prefs --json` 真实结果为 `developerModeEnabled=false`、`setupMode=null`，因此尚未启动首次连接。

## 用户操作边界

首次连接必须在惠普本机继续：

1. 读取 `prefs --json` 返回的 `setupChoicePrompt`，由用户选择 `1`（自动配置）或 `2`（手动教学配置）。
2. 仅在用户选择后执行对应的 `prefs set --setup-mode auto|manual --json`。
3. 依照 Skill 的 first-time setup，在内置浏览器完成 ChatGPT 登录、验证码、二次验证或明确同意（如页面要求）。不启动第三方浏览器，不从荣耀复制 OAuth、Cookie、配对码或运行状态。
4. 完成用户操作后再运行 `doctor --json`、`status --json` 和工作区读取检查，分别记录连接、加载与可读性。

本轮未运行 setup、未启动 Bridge、未生成配对码、未触发网页登录，也未授权任何 Hook。知行 13 个 Hook 仍需惠普用户在 `/hooks` 审核信任；该 C2C Skill 安装不改变此状态。

## 备份与回退

安装前确认不存在旧 C2C Skill 或本机状态目录；回退记录位于惠普本机的 `hp-c2c-20260917-preinstall-*` 备份目录。回退只需移除本轮新增的 `codex-with-chatgpt` Skill 目录；固定 checkout 可保留供复核，不触及 U同步生产源码、荣耀端或用户既有状态。

## 未完成边界

C2C 的首次连接、宿主信任、ChatGPT 登录和真实工作区读取尚未验收；HTML 6 项失败、持续插件同步缺口、133 项离线资料、207 项研究组合、24 个停用项和完整迁移边界均保持原状态。
