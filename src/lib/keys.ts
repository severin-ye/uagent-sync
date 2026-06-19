import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stripJsonComments } from "./state.js";
import type { ApiKeyInfo } from "./types.js";

export function detectApiKeys(workspaceRoot: string): ApiKeyInfo {
  const dotfilesDir = path.join(workspaceRoot, "opencode-dotfiles");
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

  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
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
  const dotfilesDir = path.join(workspaceRoot, "opencode-dotfiles");
  if (!fs.existsSync(dotfilesDir)) fs.mkdirSync(dotfilesDir, { recursive: true });
  const apiKeyPath = path.join(dotfilesDir, "keys", "API.md");
  const keyInfo = detectApiKeys(workspaceRoot);
  const allKeys = [...new Set([...keyInfo.keys, ...(options?.additionalKeys || [])])];

  const sections = [`# API Key 配置`, ``, `> ⚠️ 此文件包含 API 密钥配置模板，仅上传到**私有仓库**。`, `> 生成日期: ${new Date().toISOString().slice(0, 19)}`, `> 主机名: ${os.hostname()}`, ``, `## 环境变量 (${allKeys.length} 个)`, ``, `| 变量名 | 值 | 说明 |`, `|--------|----|------|`];

  for (const key of allKeys) {
    const desc = key.includes("GITHUB") ? "GitHub Personal Access Token" : key.includes("NOTION") ? "Notion Integration Token" : key.includes("ZAPIER") ? "Zapier MCP Connect URL" : key.includes("DEEPSEEK") ? "DeepSeek API Key" : key.includes("DASHSCOPE") ? "DashScope (Qwen) API Key" : key.includes("KIMI") ? "Kimi/Moonshot API Key" : key.includes("ANTHROPIC") ? "Anthropic API Key" : key.includes("OPENAI") ? "OpenAI API Key" : key.includes("WAKATIME") ? "WakaTime API Key" : key.includes("SUPERMEMORY") ? "Supermemory API Key" : key.includes("TOKEN_PLAN") ? "Token Plan API Key" : "";
    sections.push(`| \`${key}\` | \`<YOUR_${key}>\` | ${desc} |`);
  }

  if (options?.githubToken) { sections.push(``, `## GitHub Token`, ``, `\`\`\``, options.githubToken, `\`\`\``); }

  fs.writeFileSync(apiKeyPath, sections.join("\n") + "\n");
  return { path: apiKeyPath, created: !keyInfo.exists, detail: `API key template written with ${allKeys.length} keys` };
}
