import ts from 'typescript';
import { scanForSecrets } from './secret-scan.js';

const sensitive = /(?:^|[-_])(?:api[_-]?key|token|secret|password|authorization)$/i;
const opaqueLiteral = /^[A-Za-z0-9._~+/=-]{8,}$/;
// Categories observed in the installed code-review CSS, not arbitrary values.
const iconCategories = new Set(['bootstrap', 'browserslist', 'database', 'javascript',
  'markdown', 'prettier', 'tailwind', 'terraform', 'typescript']);
interface Edit { from: number; to: number; value: string }

/** Non-executing recognition only; callers still scan original nonassignment rules.
 * The snapshot reader enforces its 100 MB byte limit before calling this helper.
 * A cheap assignment check avoids constructing an AST for ordinary files.
 */
export function normalizePluginSource(relative: string, text: string, embeddedDepth = 0): string {
  if (!/\.(?:[cm]?[jt]s|jsx|tsx)$/i.test(relative)) return text;
  if (Buffer.byteLength(text, 'utf8') > 100 * 1024 * 1024) return text;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    throw new Error('Secret content refused: private-key');
  const findings = scanForSecrets(text);
  if (findings.some(f => f.rule !== 'sensitive-assignment')) return text;
  if (!findings.some(f => f.rule === 'sensitive-assignment') &&
      !/\b(?:api[_-]?key|token|secret|password|authorization)["']?\s*[=:]\s*`/i.test(text) &&
      !text.includes('Runtime.evaluate')) return text;
  const kind = /\.tsx$/i.test(relative) ? ts.ScriptKind.TSX : /\.jsx$/i.test(relative)
    ? ts.ScriptKind.JSX : /\.[cm]?ts$/i.test(relative) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const file = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, kind);
  if ((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return text;
  const edits: Edit[] = [];
  if (embeddedDepth < 3 && text.includes('Runtime.evaluate')) edits.push(...embeddedScriptEdits(file, text, embeddedDepth));
  const nameOf = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
    return undefined;
  };
  const inspectAssignment = (name: ts.Node, rhs: ts.Expression) => {
    if (!sensitive.test(nameOf(name) ?? '')) return;
    const start = rhs.getStart(file);
    const prefix = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(text.slice(start, rhs.end));
    const literalRhs = ts.isStringLiteral(rhs) || ts.isNoSubstitutionTemplateLiteral(rhs);
    // Validate only an exemption candidate. An unrelated short local variable
    // must not cause literals in a large expression to become new scan rules.
    if (!literalRhs && (!prefix || !scanForSecrets(text.slice(name.getStart(file), start + prefix[0].length)).length)) return;
    let unsafe = false;
    const inspect = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        // An object field name is structure, while literal call arguments,
        // defaults and branch values can contain a real credential.
        const structural = ts.isPropertyAssignment(node.parent) && node.parent.name === node;
        const encoding = ts.isCallExpression(node.parent) && node.parent.arguments.length === 1 &&
          ts.isPropertyAccessExpression(node.parent.expression) && node.parent.expression.name.text === 'toString' &&
          ['hex', 'base64', 'base64url', 'utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le'].includes(node.text);
        if (!structural && !encoding && opaqueLiteral.test(node.text)) unsafe = true;
      }
      ts.forEachChild(node, inspect);
    };
    inspect(rhs);
    if (unsafe) throw new Error('Secret content refused: nested-credential-literal');
    // Only an AST-confirmed initializer's nonliteral prefix can be hidden.
    // No blanket mask for a parse-successful file, ternary text or comments.
    if (prefix && !ts.isStringLiteral(rhs) && !ts.isNoSubstitutionTemplateLiteral(rhs))
      edits.push({ from: start, to: start + prefix[0].length, value: '\0' });
  };
  const visit = (node: ts.Node) => {
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node) || ts.isPropertySignature(node)) &&
        sensitive.test(nameOf(node.name) ?? '') && node.type && ts.isTypeReferenceNode(node.type)) {
      const start = node.type.getStart(file);
      const prefix = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(text.slice(start, node.type.end));
      if (prefix) edits.push({ from: start, to: start + prefix[0].length, value: '\0' });
    }
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node)) && node.initializer)
      inspectAssignment(node.name, node.initializer);
    else if (ts.isPropertyAssignment(node)) inspectAssignment(node.name, node.initializer);
    else if (ts.isConditionalExpression(node)) inspectAssignment(node.whenTrue, node.whenFalse);
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind))
      inspectAssignment(node.left, node.right);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      // Never join a literal's trailing word to an operator outside the literal.
      edits.push({ from: node.end, to: node.end, value: '\0' });
      const raw = text.slice(node.getStart(file), node.end);
      // Complete, single CSS selector followed by a declaration block. This
      // cannot recognize DOM attributes, JSON fields, an incomplete selector,
      // an unknown category, or neighboring credentials.
      for (const match of raw.matchAll(/\[data-icon-token=(['"])([a-z]+)\1\]\s*\{\s*((?:[-a-z]+\s*:\s*[^{};]+;\s*)+)\}/g)) {
        if (!iconCategories.has(match[2]) || scanForSecrets(match[3]).length || /PRIVATE KEY/.test(match[3])) continue;
        const from = node.getStart(file) + match.index + match[0].indexOf(match[2]);
        edits.push({ from, to: from + match[2].length, value: '<hidden>' });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  let result = '', cursor = 0;
  for (const edit of edits.sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (edit.from < cursor) continue;
    result += text.slice(cursor, edit.from) + edit.value;
    cursor = edit.to;
  }
  return result + text.slice(cursor);
}

/** Recognize only immutable local string flows to a CDP Runtime.evaluate payload.
 * No code is executed, and a parseable string alone never grants an exception.
 */
function embeddedScriptEdits(file: ts.SourceFile, text: string, depth: number): Edit[] {
  const host = ts.createCompilerHost({ noLib: true, noResolve: true });
  host.getSourceFile = name => name === file.fileName ? file : undefined;
  const checker = ts.createProgram([file.fileName], { noLib: true, noResolve: true, allowJs: true }, host).getTypeChecker();
  const calls: ts.CallExpression[] = [];
  const methods: ts.MethodDeclaration[] = [];
  const walk = (node: ts.Node, action: (node: ts.Node) => void) => { action(node); ts.forEachChild(node, child => walk(child, action)); };
  walk(file, node => { if (ts.isCallExpression(node)) calls.push(node); if (ts.isMethodDeclaration(node)) methods.push(node); });
  const binding = (node: ts.Node) => checker.getSymbolAtLocation(node)?.valueDeclaration;
  const written = new Set<ts.Symbol>();
  const markWrite = (node: ts.Node) => {
    if (ts.isIdentifier(node)) { const symbol = checker.getSymbolAtLocation(node); if (symbol) written.add(symbol); }
    else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) markWrite(node.expression);
    else ts.forEachChild(node, markWrite);
  };
  walk(file, node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) markWrite(node.left);
    else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) markWrite(node.operand);
    else if (ts.isDeleteExpression(node)) markWrite(node.expression);
    else if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) markWrite(node.initializer);
  });
  const initializer = (node: ts.Identifier): ts.Expression | undefined => {
    const symbol = checker.getSymbolAtLocation(node), declaration = symbol?.valueDeclaration;
    // Bundlers often use var. A unique lexical declaration with no assignment,
    // update or property mutation is the same bounded static source evidence.
    if (!declaration || !ts.isVariableDeclaration(declaration) || !ts.isVariableDeclarationList(declaration.parent)
      || symbol?.declarations?.length !== 1 || written.has(symbol)) return undefined;
    return declaration.initializer;
  };
  const isCdp = (node: ts.Expression, budget = 0): boolean => {
    if (budget > 6) return false;
    if (ts.isPropertyAccessExpression(node)) return node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === 'cdp';
    if (ts.isIdentifier(node)) { const value = initializer(node); return !!value && isCdp(value, budget + 1); }
    return false;
  };
  const directTransport = (call: ts.CallExpression) => ts.isPropertyAccessExpression(call.expression)
    && ['call', 'callTarget'].includes(call.expression.name.text) && isCdp(call.expression.expression);
  const owner = (node: ts.Node): ts.ClassLikeDeclaration | undefined => {
    let current: ts.Node | undefined = node.parent;
    while (current) { if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) return current; current = current.parent; }
    return undefined;
  };
  const localMethod = (call: ts.CallExpression) => {
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
    const name = call.expression.name.text, cls = owner(call);
    return methods.find(method => owner(method) === cls && method.name && ts.isIdentifier(method.name) && method.name.text === name);
  };
  const transports = new Map<ts.MethodDeclaration, { method: number; payload: number }>();
  for (const method of methods) {
    if (!method.body) continue;
    walk(method.body, node => {
      if (!ts.isCallExpression(node) || !directTransport(node)) return;
      const methodIndex = method.parameters.findIndex(param => node.arguments[1] && binding(node.arguments[1]) === param);
      const payloadIndex = method.parameters.findIndex(param => node.arguments[2] && binding(node.arguments[2]) === param);
      if (methodIndex >= 0 && payloadIndex >= 0) transports.set(method, { method: methodIndex, payload: payloadIndex });
    });
  }
  const evaluationPayload = (call: ts.CallExpression): ts.Expression | undefined => {
    const transport = localMethod(call), route = transport && transports.get(transport);
    const methodIndex = route ? route.method : 1, payloadIndex = route ? route.payload : 2;
    if (!route && !directTransport(call)) return undefined;
    const command = call.arguments[methodIndex];
    return command && ts.isStringLiteral(command) && command.text === 'Runtime.evaluate' ? call.arguments[payloadIndex] : undefined;
  };
  const evaluators = new Map<ts.MethodDeclaration, number>();
  for (const method of methods) {
    if (!method.body) continue;
    walk(method.body, node => {
      if (!ts.isCallExpression(node)) return;
      const payload = evaluationPayload(node);
      if (!payload) return;
      const expressions = ts.isObjectLiteralExpression(payload)
        ? payload.properties.filter(ts.isSpreadAssignment).map(item => item.expression) : [payload];
      for (const expression of expressions) {
        const index = method.parameters.findIndex(param => binding(expression) === param);
        if (index >= 0) evaluators.set(method, index);
      }
    });
  }
  const literals = new Set<ts.StringLiteral | ts.NoSubstitutionTemplateLiteral>();
  const collectSource = (node: ts.Expression, seen: Set<ts.Node>, budget: number): void => {
    if (budget > 12 || seen.has(node)) return;
    const next = new Set(seen).add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node);
    else if (ts.isIdentifier(node)) { const value = initializer(node); if (value) collectSource(value, next, budget + 1); }
    else if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) collectSource(span.expression, next, budget + 1);
    else if (ts.isParenthesizedExpression(node)) collectSource(node.expression, next, budget + 1);
  };
  const collectPayload = (node: ts.Expression, seen: Set<ts.Node>, budget: number): void => {
    if (budget > 12 || seen.has(node)) return;
    const next = new Set(seen).add(node);
    if (ts.isIdentifier(node)) { const value = initializer(node); if (value) collectPayload(value, next, budget + 1); }
    else if (ts.isObjectLiteralExpression(node)) {
      // Duplicate expression fields or computed keys make the payload ambiguous.
      const fields = node.properties.filter(ts.isPropertyAssignment).filter(item =>
        (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === 'expression');
      if (fields.length === 1) collectSource(fields[0].initializer, next, budget + 1);
      else if (!fields.length) for (const item of node.properties) if (ts.isSpreadAssignment(item)) collectPayload(item.expression, next, budget + 1);
    }
  };
  for (const call of calls) {
    const payload = evaluationPayload(call), method = localMethod(call), parameter = method && evaluators.get(method);
    if (payload) collectPayload(payload, new Set(), 0);
    else if (parameter !== undefined && call.arguments[parameter]) collectPayload(call.arguments[parameter], new Set(), 0);
  }
  const edits: Edit[] = [];
  for (const literal of literals) {
    if (Buffer.byteLength(literal.text, 'utf8') > 2 * 1024 * 1024) continue;
    const parsed = ts.createSourceFile('embedded.js', literal.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if ((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) continue;
    const normalized = normalizePluginSource('embedded.js', literal.text, depth + 1);
    if (scanForSecrets(normalized).length || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(literal.text))
      throw new Error('Secret content refused: embedded-credential-content');
    if (normalized !== literal.text) edits.push({ from: literal.getStart(file), to: literal.end, value: JSON.stringify(normalized) });
  }
  return edits;
}
