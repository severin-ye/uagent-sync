type Language = 'php' | 'ruby';
interface Region { start: number; end: number; language: Language }
interface Token { text: string; start: number; end: number }

function exampleRegions(content: string, source: string): Region[] {
  const extension = /\.([a-z]+)$/i.exec(source)?.[1].toLowerCase();
  if (extension === 'php' || extension === 'rb') return [{ start: 0, end: content.length, language: extension === 'php' ? 'php' : 'ruby' }];
  if (extension !== 'md') return [];
  const regions: Region[] = [];
  let fence: { marker: string; start: number; language?: Language } | undefined;
  let offset = 0;
  for (const line of content.split(/(?<=\n)/)) {
    const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/.exec(line);
    if (!fence && match) {
      const label = match[2].trim().toLowerCase();
      fence = { marker: match[1], start: offset + line.length, language: label === 'php' ? 'php' : label === 'ruby' ? 'ruby' : undefined };
    } else if (fence && match && match[1][0] === fence.marker[0] && match[1].length >= fence.marker.length && !match[2].trim()) {
      if (fence.language) regions.push({ start: fence.start, end: offset, language: fence.language });
      fence = undefined;
    }
    offset += line.length;
  }
  return regions;
}

/** Deliberately incomplete: unsupported lexical modes invalidate the whole region. */
function lexExample(content: string, region: Region): { tokens: Token[]; comments: Token[] } | undefined {
  const tokens: Token[] = [], comments: Token[] = [];
  const php = region.language === 'php';
  let depth = 0;
  for (let i = region.start; i < region.end;) {
    const start = i, c = content[i];
    if (/\s/.test(c)) {
      if (!php && c === '\n' && !depth) tokens.push({ text: '\n', start, end: i + 1 });
      i++; continue;
    }
    if (php && !tokens.length && content.startsWith('<?php', i) && /\s/.test(content[i + 5] ?? '')) { i += 5; continue; }
    if (php && content.startsWith('#[', i)) return undefined; // Attribute, not a comment.
    if (c === '#' || (php && content.startsWith('//', i))) {
      while (i < region.end && content[i] !== '\n') i++;
      if (php && content.slice(start, i).includes('?>')) return undefined;
      comments.push({ text: content.slice(start, i), start, end: i }); continue;
    }
    if (php && content.startsWith('/*', i)) {
      const close = content.indexOf('*/', i + 2);
      if (close < 0 || close + 2 > region.end) return undefined;
      i = close + 2; comments.push({ text: content.slice(start, i), start, end: i }); continue;
    }
    // PHP heredoc/nowdoc; Ruby heredoc, percent literals and document blocks.
    // Do not resume scanning inside or after a mode we cannot prove closed.
    if (content.startsWith('<<', i) || c === '%' || (!php && content.startsWith('=begin', i)) || c === '`' || c === '\\') return undefined;
    if (c === '"' || c === "'") {
      i++;
      let closed = false;
      while (i < region.end) {
        if (content[i] === '\\') { i += 2; continue; }
        if (c === '"' && (php ? content[i] === '$' : content.startsWith('#{', i))) return undefined;
        if (content[i] === c) { i++; closed = true; break; }
        i++;
      }
      if (!closed) return undefined;
    } else if (php && content.startsWith('Anthropic\\Client', i)) {
      // One exact qualified identifier; no escape decoding or general imports.
      i += 'Anthropic\\Client'.length;
      if (i < region.end && /[A-Za-z0-9_\\]/.test(content[i])) return undefined;
    } else if (/[$A-Za-z_]/.test(c)) {
      i++; while (i < region.end && /[A-Za-z0-9_]/.test(content[i])) i++;
    } else if (content.startsWith('::', i)) i += 2;
    else if ('=().:;,'.includes(c)) {
      if (c === '(') depth++;
      if (c === ')' && --depth < 0) return undefined;
      i++;
    } else return undefined;
    tokens.push({ text: content.slice(start, i), start, end: i });
  }
  if (depth) return undefined;
  while (tokens[0]?.text === '\n') tokens.shift();
  while (tokens.at(-1)?.text === '\n') tokens.pop();
  return { tokens, comments };
}

export function recognizePhpRubyExamples(content: string, source: string): { normalized: string; rejectedLines: number[] } {
  const output = content.split(''), rejectedLines = new Set<number>();
  const reject = (offset: number) => rejectedLines.add(content.slice(0, offset).split('\n').length);
  for (const region of exampleRegions(content, source)) {
    const parsed = lexExample(content, region);
    const pattern = region.language === 'php'
      ? ['$client', '=', 'new', 'Client', '(', 'apiKey', ':', '', ')', ';']
      : ['client', '=', 'Anthropic', '::', 'Client', '.', 'new', '(', 'api_key', ':', '', ')'];
    const valueIndex = region.language === 'php' ? 7 : 10;
    // Collapse only repeated statement terminators (blank/comment-only lines).
    // Token positions remain original; no line is classified or masked alone.
    const tokens = parsed?.tokens.filter((token, i, all) => token.text !== '\n' || all[i - 1]?.text !== '\n') ?? [];
    const prefixes = region.language === 'php'
      ? [['use', 'Anthropic\\Client', ';', '$client', '=', 'new', 'Client', '(', ')', ';']]
      : ['"anthropic"', "'anthropic'"].map(name => ['require', name, '\n', 'client', '=', 'Anthropic', '::', 'Client', '.', 'new', '\n']);
    const patterns = [{ pattern, valueIndex }, ...prefixes.map(prefix => ({ pattern: [...prefix, ...pattern], valueIndex: prefix.length + valueIndex }))];
    const match = parsed && patterns.find(candidate => tokens.length === candidate.pattern.length && candidate.pattern.every((text, i) => i === candidate.valueIndex
      ? /^(?:"your-api-key"|'your-api-key')$/.test(tokens[i].text)
      : tokens[i].text === text));
    if (!match) {
      // No partial masks: an adjacent unknown statement cannot ride along with
      // a newly allowed example. This guard is conservative, not string decoding.
      for (const match of content.slice(region.start, region.end).matchAll(/\b(?:apiKey|api_key)\b/g)) reject(region.start + match.index!);
      continue;
    }
    const literal = tokens[match.valueIndex];
    for (let p = literal.start; p < literal.end; p++) output[p] = ' ';
    // Comments remain raw. Also reject assignment-like sensitive comment text
    // even when a value prefix would evade the baseline line-oriented rule.
    for (const comment of parsed.comments) {
      for (const match of comment.text.matchAll(/\b(?:api[_-]?key|token|secret|password|authorization)\b["']?\s*[:=]/gi)) reject(comment.start + match.index!);
    }
  }
  return { normalized: output.join(''), rejectedLines: [...rejectedLines] };
}
