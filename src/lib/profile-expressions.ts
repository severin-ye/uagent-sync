/** A bounded lexical recognizer, not a general source-language parser. */
interface Token { text: string; start: number; end: number; depth: number; call: boolean; close?: string }
interface Region { start: number; end: number; language: string }
const languages: Record<string, string> = { py: 'python', python: 'python', js: 'js', javascript: 'js', ts: 'js', typescript: 'js', cs: 'cs', csharp: 'cs', java: 'java' };

function codeRegions(content: string, source: string): Region[] {
  const extension = /\.([a-z]+)$/i.exec(source)?.[1].toLowerCase();
  if (extension && languages[extension]) return [{ start: 0, end: content.length, language: languages[extension] }];
  if (extension !== 'md') return [];
  const regions: Region[] = [];
  let fence: { marker: string; start: number; language?: string } | undefined;
  let offset = 0;
  for (const line of content.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/.exec(line);
    if (!fence && marker) fence = { marker: marker[1], start: offset + line.length, language: languages[marker[2].trim().toLowerCase()] };
    else if (fence && marker && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2].trim()) {
      if (fence.language) regions.push({ start: fence.start, end: offset, language: fence.language });
      fence = undefined;
    }
    offset += line.length;
  }
  // An unclosed or unknown fence never grants an exception.
  return regions;
}

function lex(content: string, region: Region): Token[] {
  const tokens: Token[] = [];
  const stack: { close: string; call: boolean }[] = [];
  const python = region.language === 'python';
  for (let i = region.start; i < region.end;) {
    const start = i, c = content[i];
    if (python && c === '\\' && /^\\\r?\n/.test(content.slice(i, i + 3))) { i += content[i + 1] === '\r' ? 3 : 2; continue; }
    if (c === '\n') {
      i++;
      if (!stack.length) tokens.push({ text: '\n', start, end: i, depth: 0, call: false });
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if ((python && c === '#') || (!python && content.startsWith('//', i))) {
      while (i < region.end && content[i] !== '\n') i++;
      continue;
    }
    if (!python && content.startsWith('/*', i)) {
      const end = content.indexOf('*/', i + 2);
      const stop = end < 0 ? region.end : Math.min(end + 2, region.end);
      // Keep statement boundaries even when a block comment contains a newline.
      if (!stack.length && content.slice(i, stop).includes('\n')) tokens.push({ text: '\n', start, end: stop, depth: 0, call: false });
      i = stop; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = python && content.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      i += quote.length;
      while (i < region.end) {
        if (content[i] === '\\') { i = Math.min(i + 2, region.end); continue; }
        if (content.startsWith(quote, i)) { i += quote.length; break; }
        i++;
      }
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < region.end && /[A-Za-z0-9_]/.test(content[i])) i++;
    } else {
      const pair = content.slice(i, i + 2);
      i += ['==', '!=', '=>', ':=', '||', '??', '&&', '**', '+='].includes(pair) ? 2 : 1;
    }
    const text = content.slice(start, i);
    tokens.push({ text, start, end: i, depth: stack.length, call: stack.at(-1)?.call ?? false, close: stack.at(-1)?.close });
    if ('([{'.includes(text) && text.length === 1) {
      const previous = tokens.at(-2)?.text ?? '';
      const definition = tokens.at(-3)?.text === 'def';
      stack.push({ close: { '(': ')', '[': ']', '{': '}' }[text]!, call: text === '(' && !definition && /^(?:[A-Za-z_]\w*|\)|\])$/.test(previous) });
    } else if (stack.at(-1)?.close === text) stack.pop();
  }
  return tokens;
}

function atom(tokens: Token[], start: number, language: string, key: Token): { end: number; env: boolean } | undefined {
  const text = (i: number) => tokens[i]?.text;
  const sequence = (parts: string[]) => parts.every((p, i) => text(start + i) === p);
  if (language === 'python' && key.text === 'api_key') {
    if (sequence(['args', '.', 'api_key'])) return { end: start + 3, env: false };
    if (key.call && /^(?:"your-api-key"|'your-api-key')$/.test(text(start) ?? '')) return { end: start + 1, env: false };
  }
  if (language === 'js' && sequence(['process', '.', 'env', '.']) && /^[A-Z_][A-Z0-9_]*$/.test(text(start + 4) ?? '')) return { end: start + 5, env: true };
  const calls = language === 'python' ? [['os', '.', 'environ', '.', 'get', '('], ['os', '.', 'getenv', '(']]
    : language === 'cs' ? [['Environment', '.', 'GetEnvironmentVariable', '(']]
      : language === 'java' ? [['System', '.', 'getenv', '(']] : [];
  for (const parts of calls) {
    if (!sequence(parts)) continue;
    let pos = start + parts.length;
    if (!/^(?:"[A-Z_][A-Z0-9_]*"|'[A-Z_][A-Z0-9_]*')$/.test(text(pos) ?? '')) continue;
    pos++;
    // Only the observed Python environ.get empty default is newly supported.
    if (language === 'python' && key.text === 'api_key' && parts.includes('environ') && text(pos) === ',' && ['""', "''"].includes(text(pos + 1))) pos += 2;
    if (text(pos) === ')') return { end: pos + 1, env: true };
  }
  return undefined;
}

function terminated(tokens: Token[], end: number, key: Token): boolean {
  const next = tokens[end];
  if (!next) return key.depth === 0;
  if (next.text === '\n') {
    let pos = end;
    while (tokens[pos]?.text === '\n') pos++;
    // A newline is not a terminator before a binary/conditional operator,
    // member/call/index/tag tail, or an unproven TS type continuation.
    // Include operator families (not just ||/??): &&, bitwise, comparison,
    // equality, shifts and remainder can all continue a JS expression.
    const following = tokens[pos]?.text ?? '';
    return !/^[.([+*\/|?`"'&^%<>=!,-]/.test(following)
      && !['or', 'and', 'in', 'instanceof', 'as', 'satisfies'].includes(following);
  }
  if (next.depth !== key.depth) return false;
  if (next.text === ',') return key.call; // Otherwise this may be a tuple RHS.
  if (next.text === ';') return key.depth === 0;
  return key.depth > 0 && next.text === key.close;
}

/** Only the observed, complete TS constructor statement; no generic object exemption. */
function typescriptPlaceholders(content: string, source: string, region: Region, tokens: Token[]): Map<Token, Token> | undefined {
  const ts = /\.ts$/i.test(source) || (/\.md$/i.test(source)
    && /(?:^|\n) {0,3}(?:`{3,}|~{3,})(?:ts|typescript)[ \t]*\r?\n$/i.test(content.slice(0, region.start)));
  if (!ts || region.language !== 'js') return undefined;
  const accepted = new Map<Token, Token>();
  const significant = tokens.filter(t => t.text !== '\n');
  const pattern = ['const', 'client', '=', 'new', 'Anthropic', '(', '{', 'apiKey', ':', '', '}', ')', ';'];
  for (let i = 0; i < significant.length; i++) {
    const first = significant[i];
    // Start of an unnested physical line: never match a fragment in another
    // expression, a same-line regex, or a surrounding string/template token.
    if (first.depth !== 0 || !/^[ \t]*$/.test(content.slice(Math.max(region.start, content.lastIndexOf('\n', first.start - 1) + 1), first.start))) continue;
    if (!pattern.every((text, j) => j === 9
      ? /^(?:"your-api-key"|'your-api-key')$/.test(significant[i + j]?.text ?? '')
      : significant[i + j]?.text === text)) continue;
    accepted.set(significant[i + 7], significant[i + 9]);
  }
  return accepted;
}

export function recognizeProfileExpressions(content: string, source: string): { normalized: string; rejectedLines: number[] } {
  // split('') retains UTF-16 code units; do not replace code points or line breaks.
  const output = content.split('');
  const rejectedLines = new Set<number>();
  for (const region of codeRegions(content, source)) {
    const tokens = lex(content, region);
    const placeholders = typescriptPlaceholders(content, source, region, tokens);
    for (let i = 0; i < tokens.length; i++) {
      const key = tokens[i];
      if (placeholders && key.text === 'apiKey' && tokens[i + 1]?.text === ':') {
        const literal = placeholders.get(key);
        if (literal) {
          // Only the exact literal is masked; comments and neighboring fields
          // remain visible to the original scanners with their original lines.
          for (let p = literal.start; p < literal.end; p++) output[p] = ' ';
        } else rejectedLines.add(content.slice(0, key.start).split('\n').length);
        continue;
      }
      if (!/^(?:token|secret|password|api_key|apiKey)$/i.test(key.text) || tokens[i - 1]?.text === '.' || tokens[i + 1]?.text !== '=') continue;
      const start = i + 2;
      let value = atom(tokens, start, region.language, key);
      if (value?.env) {
        while (['or', '||', '??'].includes(tokens[value.end]?.text)) {
          const right = atom(tokens, value.end + 1, region.language, key);
          if (!right?.env) break;
          value = right;
        }
      }
      if (value && terminated(tokens, value.end, key)) {
        // Mask only recognized tokens, never comments, whitespace or other values.
        for (const token of tokens.slice(i, value.end)) for (let p = token.start; p < token.end; p++) {
          if (!/[\r\n\u2028\u2029]/.test(content[p])) output[p] = ' ';
        }
        i = value.end - 1;
      } else {
        // Parenthesized/continued lookalikes may evade the baseline assignment regex.
        // Refuse them explicitly rather than treating an unparsed tail as safe.
        let stop = start;
        while (stop < tokens.length && !(tokens[stop].depth === key.depth && [',', ';', ')', ']', '}', '\n'].includes(tokens[stop].text))) stop++;
        const attempted = tokens.slice(start, stop).map(t => t.text).join('');
        if (value || /args\.api_key|os\.(?:environ\.get|getenv)|process\.env\.|your-api-key/.test(attempted)) {
          rejectedLines.add(content.slice(0, key.start).split('\n').length);
        }
      }
    }
  }
  return { normalized: output.join(''), rejectedLines: [...rejectedLines] };
}
