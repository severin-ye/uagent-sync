import { scanForSecrets } from './secret-scan.js';
import { recognizeProfileExpressions } from './profile-expressions.js';
import { analyze } from './profile-m2-docstrings.js';
import { isM2Enabled, hasPublicSourceReview, matchesPublicSource, type ProfileM2Context } from './profile-m2-provider.js';
import type { SecretFinding } from './secret-scan.js';

export interface ProfileScanResult { findings: SecretFinding[]; m2: string; publicSourceMatched?: boolean }

/** Keep literal-secret rules; recognize only complete, value-free environment lookups in source files. */
export function scanProfileContent(content: string, source: string, context?: ProfileM2Context): ProfileScanResult {
  const documented = content.replace(/\bghp_your_(?:new_)?github_token(?![A-Za-z0-9_-])/g, value => ' '.repeat(value.length));
  const recognized = recognizeProfileExpressions(documented, source);
  let normalized = recognized.normalized;
  const { rejectedLines } = recognized;
  let m2 = 'disabled';
  if (isM2Enabled(context) && /\.py$/i.test(source)) {
    // Catch only the M2 recognition/validation boundary. Base/M13 failures propagate.
    try {
      // M2's layout/residual grammar supports only space, tab, CR and LF.
      // In particular Python form feed is legal between assignment tokens, but
      // is not covered by that grammar. Revoke every M2 span, even when the
      // unsupported whitespace occurs after a candidate or inside a comment.
      if (/[^\S \t\r\n]|\u0085/u.test(content)) throw Error();
      const result = analyze(content, context.template);
      m2 = result.reason;
      let end = 0;
      if (normalized.length !== content.length || [...content.matchAll(/[\r\n]/g)].some(x => normalized[x.index!] !== x[0]) || [...normalized.matchAll(/[\r\n]/g)].some(x => content[x.index!] !== x[0])) throw Error();
      for (const span of result.spans) {
        if (!Number.isInteger(span.from) || !Number.isInteger(span.to) || span.from < end || span.to > content.length || span.to - span.from !== 7 || content.slice(span.from, span.to) !== 'api_key' || normalized.slice(span.from, span.to) !== 'api_key') throw Error();
        end = span.to;
      }
      const units = normalized.split('');
      for (const span of result.spans) units.fill(' ', span.from, span.to);
      const candidate = units.join('');
      // Do not let a docstring exemption expose a pre-existing assignment blind
      // spot (for example PASSWORD=("...")). M13-approved tokens are already
      // masked. Residual value syntax is unproven, so revoke ALL M2 spans.
      // None is the one inert default used by the admitted synthetic signature.
      const residual = /["']?\b(?:api[_-]?key|token|secret|password|authorization)\b["']?[ \t]*[=:][ \t]*(?=[^\s])/gi;
      for (const match of candidate.matchAll(residual)) {
        const lineStart = candidate.lastIndexOf('\n', match.index! - 1) + 1;
        const inSignature = /^[ \t]*def [A-Za-z_]\w*\(/.test(candidate.slice(lineStart, match.index));
        const rhs = candidate.slice(match.index! + match[0].length).split(/[\r\n]/,1)[0];
        if (!/^None[ \t]*(?:#.*)?$/.test(rhs) && !(inSignature && /^None(?=[ \t]*[,)])/.test(rhs))) throw Error();
      }
      normalized = candidate;
    } catch { m2 = 'unavailable'; }
  }
  // Expression recognition only affects assignment findings. Prefix/Bearer rules
  // still inspect the unmasked text, including variable names and comments.
  const findings = scanForSecrets(documented).filter(f => f.rule !== 'sensitive-assignment');
  findings.push(...scanForSecrets(normalized).filter(f => f.rule === 'sensitive-assignment'));
  for (const line of rejectedLines) if (!findings.some(f => f.rule === 'sensitive-assignment' && f.line === line)) findings.push({ rule: 'sensitive-assignment', line, evidence: '<redacted>' });
  const order = ['authorization-bearer', 'known-token-prefix', 'sensitive-assignment'];
  findings.sort((a, b) => a.line - b.line || order.indexOf(a.rule) - order.indexOf(b.rule));
  // Run normal detection first. A separate trusted host review may resolve
  // findings only for this exact, independently obtained public Skill artifact.
  if(matchesPublicSource(content,source,context))return {findings:[],m2,publicSourceMatched:true};
  return { findings, m2 };
}

export function assertProfileContentSafe(content: string, source: string, context?: ProfileM2Context): void {
  const {findings} = scanProfileContent(content, source, context);
  if (findings.length) throw new Error(`Secret scan blocked ${source}: ${findings.map(f => `${f.rule}@${f.line}`).join(', ')}`);
}

/** Decode once, before any lossy conversion, and never rewrite the payload. */
export function assertProfileBytesSafe(bytes: Uint8Array, source: string, context?: ProfileM2Context): void {
  let content: string;
  if ((isM2Enabled(context) && /\.py$/i.test(source)) || hasPublicSourceReview(context,source)) {
    try { content = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes); }
    catch { throw new Error('Profile UTF8 validation failed'); }
  } else content = Buffer.from(bytes).toString('utf8');
  assertProfileContentSafe(content, source, context);
}
