import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { messages } from "../dist/i18n/messages.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserMessages = Object.fromEntries(["en", "zh"].map((lang) => [lang, Object.fromEntries(
  Object.entries(messages[lang]).filter(([key]) => key.startsWith("dash.") || key.startsWith("analysis.")),
)]));

const source = `/* GENERATED FROM src/i18n/messages.ts — DO NOT EDIT BY HAND. */
(() => {
  const messages = ${JSON.stringify(browserMessages)};
  let currentLang = "en";
  const t = (key, params) => {
    const template = messages[currentLang][key] ?? messages.en[key] ?? key;
    return params ? template.replace(/\\{(\\w+)\\}/g, (match, name) => params[name] == null ? match : String(params[name])) : template;
  };
  const applyStatic = () => {
    document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((element) => { const key = element.getAttribute("data-i18n"); if (key) element.textContent = t(key); });
    document.querySelectorAll("[data-i18n-attr]").forEach((element) => {
      for (const pair of (element.getAttribute("data-i18n-attr") ?? "").split(",")) { const [attribute, key] = pair.trim().split(":"); if (attribute && key) element.setAttribute(attribute, t(key)); }
    });
    const toggle = document.getElementById("lang-toggle"); if (toggle) { toggle.textContent = t("dash.langToggle"); toggle.setAttribute("aria-label", t("dash.langAria")); }
  };
  window.DSH_I18N = { getLang: () => currentLang, t, applyStatic, setLang(lang) {
    currentLang = lang === "zh" ? "zh" : "en"; applyStatic(); window.dispatchEvent(new CustomEvent("uagent:language-change", { detail: { lang: currentLang } })); return currentLang;
  }};
  window.addEventListener("DOMContentLoaded", () => { applyStatic(); document.getElementById("lang-toggle")?.addEventListener("click", () => window.DSH_I18N.setLang(currentLang === "zh" ? "en" : "zh")); });
})();
`;

fs.writeFileSync(path.join(root, "src", "dashboard", "i18n.js"), source, "utf8");
