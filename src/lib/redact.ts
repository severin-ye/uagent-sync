/**
 * 自动脱敏：导出状态 / 生成文档时，把密钥类内容替换为 <hidden>。
 *
 * `<hidden>` 同时充当 importSystemState deepMerge 的"保留本地值"哨兵：
 * 拉取方合并配置时，若同步值包含 <hidden> 且本地已有非空字符串，则保留本地真实值。
 */

export const REDACTED = "<hidden>";

/** 按序全局替换的密钥模式。 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // URL query 参数：?token= / &api_key= / &apiKey= / &key= / &secret= / &access_token= / &auth=
  [/([?&](?:token|api[_-]?key|key|secret|access[_-]?token|auth)=)[^\s"&#]+/gi, `$1${REDACTED}`],
  // Authorization: Bearer xxx
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  // Notion token
  [/ntn_[A-Za-z0-9]+/g, `ntn_${REDACTED}`],
  // GitHub fine-grained PAT
  [/github_pat_[A-Za-z0-9_]+/g, `github_pat_${REDACTED}`],
  // GitHub classic PAT
  [/ghp_[A-Za-z0-9]+/g, `ghp_${REDACTED}`],
  // OpenAI 风格 sk-（lookbehind 防止误伤 risk-assessment 这类词）
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9]{8,}/g, `sk-${REDACTED}`],
  // Slack token
  [/xox[baprs]-[A-Za-z0-9-]+/g, `xox-${REDACTED}`],
  // Google API key
  [/AIza[A-Za-z0-9_-]{10,}/g, `AIza${REDACTED}`],
  // AWS access key id
  [/AKIA[A-Z0-9]{16}/g, `AKIA${REDACTED}`],
];

/** 对单个字符串按 SECRET_PATTERNS 顺序全局替换。幂等：已含 <hidden> 的串再脱敏不变。 */
export function redactString(s: string): string {
  let out = s;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * 纯函数深映射脱敏：string → redactString；数组 → 逐项；普通对象 → 逐 key；其余原样返回。
 * 不修改入参。
 */
export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSecretsDeep(item)) as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSecretsDeep(v);
    }
    return out as T;
  }
  return value;
}
