import { scanForSecrets } from './secret-scan.js';
import { recognizeProfileExpressions } from './profile-expressions.js';

/** Keep literal-secret rules; recognize only complete, value-free environment lookups in source files. */
export function assertProfileContentSafe(content: string, source: string): void {
  const documented = content.replace(/\bghp_your_(?:new_)?github_token(?![A-Za-z0-9_-])/g, value => ' '.repeat(value.length));
  const { normalized, rejectedLines } = recognizeProfileExpressions(documented, source);
  // Expression recognition only affects assignment findings. Prefix/Bearer rules
  // still inspect the unmasked text, including variable names and comments.
  const findings = scanForSecrets(documented).filter(f => f.rule !== 'sensitive-assignment');
  findings.push(...scanForSecrets(normalized).filter(f => f.rule === 'sensitive-assignment'));
  for (const line of rejectedLines) if (!findings.some(f => f.rule === 'sensitive-assignment' && f.line === line)) findings.push({ rule: 'sensitive-assignment', line, evidence: '<redacted>' });
  const order = ['authorization-bearer', 'known-token-prefix', 'sensitive-assignment'];
  findings.sort((a, b) => a.line - b.line || order.indexOf(a.rule) - order.indexOf(b.rule));
  if (findings.length) throw new Error(`Secret scan blocked ${source}: ${findings.map(f => `${f.rule}@${f.line}`).join(', ')}`);
}
