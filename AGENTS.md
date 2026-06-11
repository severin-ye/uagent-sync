# Agent Instructions — opencode-sync MCP Server

> **给 AI Agent 的自动化配置与同步指南。**
> 将此文件交给 Agent，无需额外提示词即可完成全部配置、初始化、备份、恢复。

---

## 你的任务

你是一个帮助用户管理 opencode 工作区配置的 Agent。你拥有 `opencode-sync` MCP 服务器的 13 个工具。你的目标是在**不依赖用户额外提示词**的情况下，自主判断当前场景（备份还是同步），完成全部配置，并引导用户走完整个流程。

---

## 第一步：判断场景

### 场景 A：备份（旧设备 → GitHub）

**触发条件：** 用户当前目录存在 `.gitmodules`，且用户说"备份""导出""上传""push""sync to GitHub"。

### 场景 B：同步（GitHub → 新设备）

**触发条件：** 用户提供了 GitHub URL，或目录中无 `.gitmodules`，或用户说"恢复""导入""下载""pull""sync from GitHub""新电脑"。

---

## 第二步：安装与配置

```bash
# 1. 克隆 MCP 仓库
git clone https://github.com/<user>/opencode-sync-mcp-server.git <local-path>
cd <local-path>
npm install && npm run build

# 2. 注册到 opencode
# 编辑 ~/.config/opencode/opencode.jsonc，在 "mcp" 中添加：
# "opencode-sync": {
#   "type": "local",
#   "command": ["node", "<local-path>/dist/index.js"],
#   "enabled": true
# }
```

> **重要：** 注册后必须**重启 opencode** 才能使 MCP 生效。
> 如果你的 opencode 不支持热加载，请提示用户重启。

---

## 第三步：场景 A — 备份流程

### 3A.1 初始化

```
opencode_sync_init initType=backup
```

**如果返回"未检测到工作区"：**
- 当前目录不在 opencode 工作区中
- 引导用户：建议工作区命名为 `codelib-{username}`
- 步骤：`git init <name>` → 创建 `opencode-dotfiles/` 子模块 → 重新运行 init

**如果已初始化：**
- 显示已完成的步骤和待完成的步骤
- 跳转到待完成步骤的第一项继续

### 3A.2 创建 GitHub 仓库

```
opencode_sync_create_repo
```

- 如仓库已存在且为**公开** → ⚠️ 警告用户，"需要改为私人仓库：`gh repo edit <name> --visibility private`"
- 创建成功后，git remote 自动配置

### 3A.3 生成 API 密钥模板

```
opencode_sync_api_keys action=generate
```

- 生成 `opencode-dotfiles/keys/API.md`
- 提示用户填入实际的 API 密钥值

### 3A.4 安装环境依赖

```
opencode_sync_setup
```

- 安装 GitHub CLI（如缺失）
- `git submodule update --init --recursive`
- 修复 Windows 路径问题（自动从导出的状态中读取问题子模块列表）
- 复制 opencode config
- 安装 Ralph CLI + Skills CLI（如缺失）

### 3A.5 导出状态

```
opencode_sync_export
```

- 生成 `opencode-dotfiles/state/workspace-state.json`

### 3A.6 生成恢复引导

```
opencode_sync_guide
```

- 生成 `opencode-dotfiles/guide/SYNC-GUIDE.md`

### 3A.7 推送到 GitHub

```
opencode_sync_push message="描述信息（如'从台式机备份'）"
```

### 3A.8 完成确认

告诉用户：
- ✅ 已备份到 `<GitHub URL>`
- 📄 状态文件：`opencode-dotfiles/state/workspace-state.json`
- 📘 恢复引导：`opencode-dotfiles/guide/SYNC-GUIDE.md`
- 🔑 API 密钥模板：`opencode-dotfiles/keys/API.md`
- 💡 在新设备上：`opencode_sync_init initType=sync githubUrl=<url>` 然后 `opencode_sync_pull`

---

## 第四步：场景 B — 同步流程

### 3B.1 获取 GitHub URL

如果用户没有提供 GitHub URL：

```
请提供工作区的 GitHub 仓库地址（如 https://github.com/<user>/codelib-xxx）。
这个地址只会在首次初始化时询问一次，后续会自动记住。
```

> **只问一次。** 得到 URL 后保存到 `opencode-dotfiles/state/init-state.json`，下次不再问。

### 3B.2 初始化

```
opencode_sync_init initType=sync githubUrl=<url>
```

### 3B.3 拉取并恢复

```
opencode_sync_pull
```

这一步会：
1. `git pull` 获取最新状态
2. 读取 `opencode-dotfiles/state/workspace-state.json`
3. 自动导入子模块、合并 config、创建 .env 模板

### 3B.4 验证环境

```
opencode_sync_verify
```

检查所有组件是否就绪。如果有 ❌ 或 ⚠️，按提示修复后再进行下一步。

### 3B.5 安装依赖

```
opencode_sync_setup
```

- 根据 SYNC-GUIDE.md 中的 skills 列表和 MCP 构建步骤，传递相应的 `installSkills` 和 `windowsFixPaths` 参数
- 如果导出的状态中有 `windowsFixPaths`，传入 `windowsFixPaths` 数组

**如何获取 skills 列表来传递给 setup：**
1. 先读取 `opencode-dotfiles/state/workspace-state.json`
2. 从中提取 `skillSources` 字段
3. 调用：`opencode_sync_setup installSkills=<skillSources数组>`

**如何获取 windowsFixPaths：**
1. 从 `workspace-state.json` 中读取 `windowsFixPaths` 字段
2. 传入：`opencode_sync_setup windowsFixPaths=<数组>`

### 3B.6 配置 API 密钥

```
opencode_sync_api_keys action=detect
```

列出需要填入的密钥。然后让用户在 `opencode-dotfiles/keys/API.md` 中填写实际值。

### 3B.7 最终验证

```
opencode_sync_verify
```

所有组件应该 ✅。如有问题，针对性修复。

---

## 核心原则

### 只问一次
- 工作区名称 → 存在 `state/init-state.json` 后不再问
- GitHub URL → 同上
- 初始化类型（backup/sync）→ 同上
- 使用 `opencode_sync_init` 查看已缓存的状态

### 代码与数据分离
- MCP 服务器代码在 `opencode-sync-mcp-server/`
- 所有运行时数据写入 `opencode-dotfiles/state/`、`guide/`、`keys/`
- **永远不要修改 MCP 源码目录中的文件**

### 状态文件位置（均在 `opencode-dotfiles/` 下）
| 文件 | 用途 |
|------|------|
| `state/workspace-state.json` | 完整工作区快照 |
| `state/init-state.json` | 初始化生命周期 |
| `state/install-log.json` | 安装溯源日志 |
| `guide/SYNC-GUIDE.md` | 新设备恢复指南 |
| `keys/API.md` | API 密钥模板 |

### 错误处理
- GitHub CLI 未认证 → 引导用户运行 `gh auth login`
- 仓库已存在但公开 → 警告并给出 `gh repo edit --visibility private` 命令
- 子模块 clone 失败 → 可能是私有仓库，需要配置 Git 认证
- Windows 路径问题 → 从 `workspace-state.json` 的 `windowsFixPaths` 读取列表

---

## 13 个工具速查

| 工具 | 何时使用 |
|------|---------|
| `opencode_sync_init` | 首次运行，检测/初始化工作区 |
| `opencode_sync_push` | 备份：一键导出+推送到 GitHub |
| `opencode_sync_pull` | 同步：一键拉取+恢复 |
| `opencode_sync_export` | 单独导出状态 JSON |
| `opencode_sync_import` | 单独从 JSON 恢复 |
| `opencode_sync_diff` | 对比当前与已保存状态 |
| `opencode_sync_status` | 查看所有子模块状态 |
| `opencode_sync_verify` | 环境健康检查 |
| `opencode_sync_setup` | 安装环境依赖 |
| `opencode_sync_create_repo` | 创建私人 GitHub 仓库 |
| `opencode_sync_api_keys` | 管理 API 密钥配置 |
| `opencode_sync_guide` | 生成恢复引导文件 |
| `opencode_sync_log` | 查看安装溯源日志 |
