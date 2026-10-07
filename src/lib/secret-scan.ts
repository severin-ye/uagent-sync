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
  const dialect = /\.[cm]?ts$/i.test(source) ? 'ts' : /\.tsx$/i.test(source) ? 'ts jsx' : /\.jsx$/i.test(source) ? 'jsx' : '';
  const parser = python ? pythonParser : javascriptParser.configure({ dialect });
  const code = new Uint8Array(content.length).fill(1);
  let invalid = false;
  const strings: Array<{ from: number; to: number; environmentKey: boolean; structuralKey: boolean }> = [];
  const tree = parser.parse(content);
  tree.iterate({ enter(node) {
    if (node.type.isError) {
      const bareYield = python && node.from === node.to && node.node.parent?.name === 'YieldStatement'
        && content.slice(node.node.parent.from, node.node.parent.to).trim() === 'yield';
      // Lezer misparses this valid JS array-element swap as a member access.
      // Accept only the exact, literal-free swap shape and its single '=' error;
      // any other parse error still disables all source recognition.
      const statement = node.node.parent?.parent;
      const arraySwap = !python && node.node.parent?.name === 'MemberExpression' && statement?.name === 'ExpressionStatement'
        && content.slice(node.from, node.to) === '='
        && /^\[\s*([A-Za-z_$][\w$]*)\[\s*([A-Za-z_$][\w$]*)\s*\]\s*,\s*\1\[\s*([A-Za-z_$][\w$]*)\s*\]\s*\]\s*=\s*\[\s*\1\[\s*\3\s*\]\s*,\s*\1\[\s*\2\s*\]\s*\]\s*;?$/.test(content.slice(statement.from, statement.to));
      if (!bareYield && !arraySwap) invalid = true;
    }
    if (/String|Comment|RegExp/.test(node.name)) {
      if (/String/.test(node.name)) {
        const parent = node.node.parent, call = parent?.name === 'ArgList' ? parent.parent : null;
        const context = call ? content.slice(call.from, call.to) : '';
        const literal = content.slice(node.from + 1, node.to - 1);
        const environmentKey = node.node.prevSibling?.name === '(' && /^[A-Z_][A-Z0-9_]*$/.test(literal)
          && /^(?:os\.getenv|os\.environ\.get)\s*\(/.test(context);
        const structuralKey = parent?.name === 'Property' && parent.firstChild?.from === node.from
          || parent?.name === 'DictionaryExpression' && node.node.nextSibling?.name === ':'
          || parent?.name === 'MemberExpression' && node.node.prevSibling?.name === '[' && node.node.nextSibling?.name === ']';
        strings.push({ from: node.from, to: node.to, environmentKey, structuralKey });
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
    let annotation = assignment;
    while (annotation.parent && annotation.name !== 'TypeAnnotation') annotation = annotation.parent;
    const typeOnly = annotation.name === 'TypeAnnotation';
    // A return/interface property type has no runtime initializer. A typed
    // variable still scans its real declaration, including string defaults.
    const declaration = typeOnly && annotation.parent?.name === 'VariableDeclaration' ? annotation.parent : null;
    if (declaration) assignment = declaration;
    else if (!typeOnly) while (assignment.parent && !['VariableDeclaration', 'AssignmentExpression', 'AssignStatement', 'Property'].includes(assignment.name)) assignment = assignment.parent;
    // A condition's ':' may be followed by an identifier on the next line.
    // It is not an assignment: never widen its literal search to the script,
    // and leave any unmatched text under the original conservative scanner.
    if (!typeOnly && !['VariableDeclaration', 'AssignmentExpression', 'AssignStatement', 'Property'].includes(assignment.name)) continue;
    for (const literal of strings) {
      if (typeOnly && !declaration || literal.from < valueFrom || literal.to > assignment.to || literal.environmentKey || literal.structuralKey) continue;
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

/** Credential values stay placeholders; noncredential defaults may be numeric or boolean. */
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
    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!assignment) throw new Error(`Credential template blocked ${source}: unsupported-line@${index + 1}`);
    const key = assignment[1];
    let value = assignment[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    const credentialKey = /key|token|secret|pass|authorization|credential|private|session|signature|(?:^|_)pin(?:_|$)/i.test(key);
    const publicScalar = !credentialKey && /^(?:true|false|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/i.test(value);
    if (value && !publicScalar && !/^(?:<(?:YOUR_[A-Z0-9_]+|hidden)>|\$\{[A-Z_][A-Z0-9_]*\}|your[-_][A-Za-z0-9_-]+|replace[-_]me|changeme)$/i.test(value)) {
      throw new Error(`Credential template blocked ${source}: non-placeholder@${index + 1}`);
    }
  }
}
