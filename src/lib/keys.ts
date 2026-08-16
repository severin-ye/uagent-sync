import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stripJsonComments } from "./state.js";
import type { ApiKeyInfo } from "./types.js";
import { DOTFILES_DIR } from "./dotfiles.js";
import { ensureSecretGitignore } from "./crystallize-commit.js";
import { t } from "../i18n/index.js";

export function detectApiKeys(workspaceRoot: string): ApiKeyInfo {
  const dotfilesDir = path.join(workspaceRoot, DOTFILES_DIR);
  const apiKeyPath = path.join(dotfilesDir, "keys", "API.md");
  const envPath = path.join(dotfilesDir, ".env");
  const keys: string[] = [];

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const name = trimmed.split("=")[0].trim();
      if (name && (name.includes("API_KEY") || name.includes("TOKEN") || name.includes("SECRET"))) keys.push(name);
    }
  }

  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const clean = stripJsonComments(content);
      const config = JSON.parse(clean) as Record<string, unknown>;
      const mcp = config.mcp as Record<string, { url?: string; environment?: Record<string, string> }> | undefined;
      if (mcp) {
        for (const [name, mcpConfig] of Object.entries(mcp)) {
          if (mcpConfig.url && mcpConfig.url.includes("token=")) keys.push(`${name.toUpperCase()}_URL`);
          if (mcpConfig.environment) for (const envKey of Object.keys(mcpConfig.environment)) { if (!keys.includes(envKey)) keys.push(envKey); }
        }
      }
    } catch { /* ignore */ }
  }

  return { path: apiKeyPath, exists: fs.existsSync(apiKeyPath), keys: [...new Set(keys)] };
}

export function initApiKeyFile(workspaceRoot: string, options?: { additionalKeys?: string[]; githubToken?: string }): { path: string; created: boolean; detail: string } {
  const dotfilesDir = path.join(workspaceRoot, DOTFILES_DIR);
  if (!fs.existsSync(dotfilesDir)) fs.mkdirSync(dotfilesDir, { recursive: true });
  // 代码层保证：写真实值前确保 keys/、.env 一定被 dotfiles 仓库 ignore，
  // 不依赖用户预先配置 .gitignore（README "never values" 承诺由此强制执行）。
  ensureSecretGitignore(dotfilesDir);
  const apiKeyPath = path.join(dotfilesDir, "keys", "API.md");
  const keyInfo = detectApiKeys(workspaceRoot);
  const allKeys = [...new Set([...keyInfo.keys, ...(options?.additionalKeys || [])])];

  const sections = [t("lib.apiKeyHeader"), ``, t("lib.apiKeyWarning"), t("lib.apiKeyGeneratedAt", { time: new Date().toISOString().slice(0, 19) }), t("lib.apiKeyHostname", { hostname: os.hostname() }), ``, t("lib.apiKeyEnvSection", { count: allKeys.length }), ``, t("lib.apiKeyTableHead"), t("lib.apiKeyTableSep")];

  for (const key of allKeys) {
    const desc = key.includes("GITHUB") ? "GitHub Personal Access Token" : key.includes("NOTION") ? "Notion Integration Token" : key.includes("ZAPIER") ? "Zapier MCP Connect URL" : key.includes("DEEPSEEK") ? "DeepSeek API Key" : key.includes("DASHSCOPE") ? "DashScope (Qwen) API Key" : key.includes("KIMI") ? "Kimi/Moonshot API Key" : key.includes("ANTHROPIC") ? "Anthropic API Key" : key.includes("OPENAI") ? "OpenAI API Key" : key.includes("WAKATIME") ? "WakaTime API Key" : key.includes("SUPERMEMORY") ? "Supermemory API Key" : key.includes("TOKEN_PLAN") ? "Token Plan API Key" : "";
    sections.push(`| \`${key}\` | \`<YOUR_${key}>\` | ${desc} |`);
  }

  // 真实 token 仅写入本地文件：usync-dotfiles/keys/ 已在 .gitignore 中（2026-07-17 安全清理），
  // crystallize/push 的 git add -A 不会带上它，保证真实值永不进入 Git 历史。
  // README 承诺 "names + descriptions (never values)" 依赖此忽略规则。
  if (options?.githubToken) { sections.push(``, `## GitHub Token`, ``, `\`\`\``, options.githubToken, `\`\`\``); }

  fs.writeFileSync(apiKeyPath, sections.join("\n") + "\n");
  return { path: apiKeyPath, created: !keyInfo.exists, detail: `API key template written with ${allKeys.length} keys` };
}
