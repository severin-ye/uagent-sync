import { scanForSecrets } from './secret-scan.js';

/** Keep literal-secret rules; recognize only complete, value-free environment lookups in source files. */
export function assertProfileContentSafe(content: string, source: string): void {
  const lookup = String.raw`(?:os\.(?:environ\.get|getenv)|Environment\.GetEnvironmentVariable|System\.getenv)\(["'][A-Z_][A-Z0-9_]*["']\)|process\.env\.[A-Z_][A-Z0-9_]*`;
  const expression = String.raw`(?:${lookup})(?:\s+(?:or|\|\||\?\?)\s+(?:${lookup}))*`;
  const envAssignment = new RegExp(String.raw`\b(?:token|secret|password|api_key|apiKey)\s*=\s*${expression}(?=\s*(?:[,;)\r\n]|$))`, 'gi');
  // Remove only the known lookup expression, not the rest of its line: an adjacent literal still fails.
  const normalized = content.replace(envAssignment, '_environment_lookup_').replace(/\bghp_your_(?:new_)?github_token(?![A-Za-z0-9_-])/g, '_documented_placeholder_');
  const findings = scanForSecrets(normalized);
  if (findings.length) throw new Error(`Secret scan blocked ${source}: ${findings.map(f => `${f.rule}@${f.line}`).join(', ')}`);
}
