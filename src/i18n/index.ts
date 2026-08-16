/**
 * 轻量 i18n 核心（零依赖）。
 *
 * 语言解析优先级（CLI / 插件场景）：
 *   1. 显式 --lang flag（由调用方传入）
 *   2. 环境变量 UAGENT_SYNC_LANG=en|zh
 *   3. 系统 locale（LANG/LC_ALL，zh* → zh）
 *   4. 默认 en（用户明确要求：下载/安装后默认英文）
 *
 * dashboard 前端不使用本模块（浏览器环境，见 src/dashboard/i18n.js）。
 */

import { lookup, type Lang, type Messages } from "./messages.js";

let currentLang: Lang = resolveLangFromEnv();

export type { Lang, Messages };
export { messages } from "./messages.js";

/** 从环境变量与系统 locale 解析语言（不抛错，永远返回合法值）。 */
export function resolveLangFromEnv(): Lang {
  const fromEnv = process.env.UAGENT_SYNC_LANG?.trim().toLowerCase();
  if (fromEnv === "zh" || fromEnv === "zh-cn" || fromEnv === "zh_cn" || fromEnv === "cn") return "zh";
  if (fromEnv === "en" || fromEnv === "en-us") return "en";
  const locale = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").trim().toLowerCase();
  if (locale.startsWith("zh")) return "zh";
  return "en";
}

/** 显式设置语言（返回是否有效）。 */
export function setLang(lang: string | undefined | null): Lang {
  const normalized = normalizeLang(lang);
  currentLang = normalized;
  return normalized;
}

export function getLang(): Lang {
  return currentLang;
}

export function normalizeLang(lang: string | undefined | null): Lang {
  const v = String(lang ?? "").trim().toLowerCase();
  if (v === "zh" || v === "zh-cn" || v === "zh_cn" || v === "cn") return "zh";
  return "en";
}

/** 翻译：t("cli.exported", { path })；支持 {param} 插值。 */
export function t(key: string, params?: Record<string, string | number | boolean>): string {
  const template = lookup(currentLang, key);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** 便捷：按指定语言翻译（不改变全局语言）。 */
export function translate(lang: Lang, key: string, params?: Record<string, string | number | boolean>): string {
  const prev = currentLang;
  currentLang = lang;
  try {
    return t(key, params);
  } finally {
    currentLang = prev;
  }
}

/** 在指定语言上下文中执行回调（不改变全局语言）。 */
export function withLang<T>(lang: Lang, fn: () => T): T {
  const prev = currentLang;
  currentLang = lang;
  try {
    return fn();
  } finally {
    currentLang = prev;
  }
}
