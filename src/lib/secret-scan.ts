export interface SecretFinding {
  rule: string;
  line: number;
  evidence: string;
}

const RULES: Array<[string, RegExp]> = [
  ["authorization-bearer", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
  ["known-token-prefix", /\b(?:gh[pousr]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{16,}/i],
  ["sensitive-assignment", /["']?\b(?:api[_-]?key|token|secret|password|authorization)\b["']?\s*[=:]\s*["']?(?!<(?:hidden|YOUR_))[A-Za-z0-9._~+/=-]{8,}/i],
];

export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (/<hidden>|<YOUR_[A-Z0-9_]+>/.test(line)) continue;
    for (const [rule, pattern] of RULES) {
      if (pattern.test(line)) findings.push({ rule, line: index + 1, evidence: "<redacted>" });
    }
  }
  return findings;
}

export function assertNoSecrets(content: string, source = "content"): void {
  const findings = scanForSecrets(content);
  if (findings.length > 0) throw new Error(`Secret scan blocked ${source}: ${findings.map((item) => `${item.rule}@${item.line}`).join(", ")}`);
}
