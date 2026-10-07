import { parser as javascriptParser } from '@lezer/javascript';
import { parser as pythonParser } from '@lezer/python';

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
    // Placeholder text must not suppress unrelated credentials on the same line.
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

/** Project-only source recognition. Default profile/state scanners remain conservative. */
export function assertNoProjectSecrets(content: string, source: string): void {
  const original = scanForSecrets(content);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) throw new Error(`Secret scan blocked ${source}: private-key`);
  if (!original.length) return;
  if (original.some(f => f.rule !== 'sensitive-assignment') || !/\.(?:[cm]?[jt]s|jsx|tsx|py)$/i.test(source)) {
    assertNoSecrets(content, source); return;
  }
  // Parse data without executing it. Literals/comments/regexes keep every byte
  // under scanning; invalid syntax never grants a source-code exception.
  const python = /\.py$/i.test(source);
  const parser = python ? pythonParser : javascriptParser.configure({ dialect: 'ts jsx' });
  const code = new Uint8Array(content.length).fill(1);
  let invalid = false;
  const strings: Array<{ from: number; to: number; environmentKey: boolean }> = [];
  const tree = parser.parse(content);
  tree.iterate({ enter(node) {
    if (node.type.isError) {
      const bareYield = python && node.from === node.to && node.node.parent?.name === 'YieldStatement'
        && content.slice(node.node.parent.from, node.node.parent.to).trim() === 'yield';
      if (!bareYield) invalid = true;
    }
    if (/String|Comment|RegExp/.test(node.name)) {
      if (/String/.test(node.name)) {
        const parent = node.node.parent, call = parent?.name === 'ArgList' ? parent.parent : null;
        const context = call ? content.slice(call.from, call.to) : '';
        const literal = content.slice(node.from + 1, node.to - 1);
        const environmentKey = node.node.prevSibling?.name === '(' && /^[A-Z_][A-Z0-9_]*$/.test(literal)
          && /^(?:os\.getenv|os\.environ\.get)\s*\(/.test(context);
        strings.push({ from: node.from, to: node.to, environmentKey });
      }
      code.fill(0, node.from, node.to);
      const parent = node.node.parent;
      const key = parent?.name === 'Property' && parent.firstChild?.from === node.from
        || parent?.name === 'DictionaryExpression' && node.node.nextSibling?.name === ':';
      if (/String/.test(node.name) && key && !scanForSecrets(content.slice(node.from, node.to)).length) code.fill(1, node.from, node.to);
      return false;
    }
  } });
  if (invalid) { assertNoSecrets(content, source); return; }
  const normalized = content.split('');
  for (const match of content.matchAll(/\b(?:api[_-]?key|token|secret|password|authorization)["']?\s*[=:]\s*((?:\+\+|--|[!~+-])?\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/gi)) {
    const from = match.index, to = from + match[0].length;
    if (!code.subarray(from, to).every(value => value === 1)) continue;
    // Only the nonliteral RHS prefix is hidden. Neighboring literals, comments,
    // and other assignments remain visible with their original line numbers.
    const valueFrom = to - match[1].length;
    let assignment = tree.resolveInner(valueFrom, 1);
    while (assignment.parent && !['VariableDeclaration', 'AssignmentExpression', 'AssignStatement', 'Property'].includes(assignment.name)) assignment = assignment.parent;
    for (const literal of strings) {
      if (literal.from < valueFrom || literal.to > assignment.to || literal.environmentKey) continue;
      const value = content.slice(literal.from + 1, literal.to - 1);
      if (/^[A-Za-z0-9._~+/=-]{8,}$/.test(value)) {
        throw new Error(`Secret scan blocked ${source}: nested-credential-literal`);
      }
    }
    for (let i = valueFrom; i < to; i++) normalized[i] = ' ';
    normalized[valueFrom] = '\0';
  }
  assertNoSecrets(normalized.join(''), source);
}

/** Only explicitly named, wholly placeholder-valued dotenv templates qualify. */
export function assertPlaceholderEnvTemplate(content: string, source: string): void {
  if (!/(?:^|\/)\.env\.(?:example|template)$/i.test(source)) throw new Error(`Credential filename blocked: ${source}`);
  // Prefix/bearer credentials must be blocked even beside a valid placeholder.
  const findings = scanForSecrets(content).filter(f => f.rule !== 'sensitive-assignment');
  if (findings.length || /PRIVATE KEY-----/.test(content)) throw new Error(`Secret scan blocked ${source}: template credential`);
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      assertNoSecrets(raw, source); continue;
    }
    const assignment = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line);
    if (!assignment) throw new Error(`Credential template blocked ${source}: unsupported-line@${index + 1}`);
    let value = assignment[1].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (value && !/^(?:<(?:YOUR_[A-Z0-9_]+|hidden)>|\$\{[A-Z_][A-Z0-9_]*\}|your[-_][A-Za-z0-9_-]+|replace[-_]me|changeme)$/i.test(value)) {
      throw new Error(`Credential template blocked ${source}: non-placeholder@${index + 1}`);
    }
  }
}
