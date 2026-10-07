import fs from 'node:fs';
import path from 'node:path';
import { assertNoSecrets, assertPlaceholderEnvTemplate } from './secret-scan.js';

/** Public templates remain content-checked; this never accepts a real credential file. */
export function validatePluginPublicConfig(relative: string, bytes: Buffer): boolean {
  if (!/(?:^|\/)\.env\.(?:example|template)$/i.test(relative) && !/(?:^|\/)\.npmrc$/i.test(relative)) return false;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw Error('Invalid public configuration template');
  if (/(?:^|\/)\.npmrc$/i.test(relative)) {
    assertNoSecrets(text, 'public npm configuration');
    for (const line of text.split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#') && !x.startsWith(';'))) {
      if (!/^(?:audit|fund|update-notifier)\s*=\s*(?:true|false)$/i.test(line)) throw Error('Npm configuration contains unsupported or credential fields');
    }
  } else {
    // The Hugging Face example's repeated-x sentinel is a placeholder, not an
    // exemption for hf_ tokens or arbitrary opaque values.
    const normalized = text.replace(/^(\s*HF_TOKEN\s*=\s*)(["']?)(hf_x{8,})\2\s*$/gm, '$1<YOUR_TOKEN>')
      .replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(["']?)replace[-_](?:this[-_])?with[-_](?:your[-_])?[A-Za-z0-9_-]+\2\s*$/gm, '$1<YOUR_EXAMPLE>');
    const withPublicDefaults = normalized.split(/\r?\n/).map(line => {
      const match = /^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)(.*)$/.exec(line);
      if (!match || /key|token|secret|pass|authorization|credential|private|session|signature|(?:^|_)pin(?:_|$)/i.test(match[2])) return line;
      let value = match[3].trim(); if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      assertNoSecrets(value, 'public configuration default');
      const url = /^https?:\/\//i.test(value) ? new URL(value) : undefined;
      if (url && !url.username && !url.password && !/token|key|secret|pass|auth/i.test(url.search)) return match[1] + '<YOUR_PUBLIC_DEFAULT>';
      if (/^(?:[A-Za-z0-9_.-]+|\/[A-Za-z0-9_./-]+)$/.test(value)) return match[1] + '<YOUR_PUBLIC_DEFAULT>';
      return line;
    }).join('\n');
    assertPlaceholderEnvTemplate(withPublicDefaults, relative);
  }
  return true;
}

const development = new Set(['test', 'tests', 'benchmark', 'benchmarks', '.github', '.gitnexus', '.agent-status', '.serena', 'docs']);
/** Keep explicitly referenced development documents; do not follow external links. */
export function runtimeDevelopmentExclusions(root: string): (relative: string) => boolean {
  const excludedDirectories = new Set(development);
  const outsideRuntime = (relative: string) => relative.split('/').some(part => development.has(part))
    || excludedDirectories.has(relative.split('/')[0]);
  const referenced = new Set<string>(), queue: string[] = [];
  const inside = (full: string) => { const rel = path.relative(root, full); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
  const packagePath = path.join(root, 'package.json');
  let pkg: Record<string, unknown> = {};
  if (fs.existsSync(packagePath) && fs.lstatSync(packagePath).isFile() && fs.statSync(packagePath).size <= 65536) {
    pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    // A compiled, existing main plus a restrictive published file list is
    // affirmative evidence that an unpacked src tree is development material.
    // Missing metadata, source entrypoints and broad globs remain conservative.
    const main = typeof pkg.main === 'string' ? path.resolve(root, pkg.main) : undefined;
    const files = pkg.files;
    if (main && inside(main) && !path.relative(root, main).replaceAll('\\', '/').startsWith('src/') && /\.[cm]?js$/i.test(main)
      && fs.existsSync(main) && fs.lstatSync(main).isFile() && Array.isArray(files) && files.length
      && files.every(file => typeof file === 'string' && !/^(?:src(?:\/|$)|[^/]*[*?\[])/.test(file.replace(/^\.\//, '')))) {
      excludedDirectories.add('src');
    }
  }
  const retainEntrypoint = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(retainEntrypoint); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(retainEntrypoint); return; }
    if (typeof value !== 'string' || /^(?:[a-z]+:|\/)/i.test(value)) return;
    const target = path.resolve(root, value), rel = path.relative(root, target).replaceAll('\\', '/');
    if (inside(target) && outsideRuntime(rel) && fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink()) {
      referenced.add(rel); queue.push(rel);
    }
  };
  for (const key of ['main', 'module', 'browser', 'bin', 'exports', 'imports']) retainEntrypoint(pkg[key]);
  // Declared entrypoint directories are required content. Prose links to an
  // output/history directory do not establish the same dependency.
  const manifest = path.join(root, '.codex-plugin/plugin.json');
  if (fs.existsSync(manifest) && fs.lstatSync(manifest).isFile() && fs.statSync(manifest).size <= 65536) {
    const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    for (const key of ['skills', 'commands', 'hooks', 'mcpServers']) {
      retainEntrypoint(data[key]);
    }
  }
  const inspected = new Set<string>();
  const inspect = (relative: string) => {
    if (inspected.has(relative)) return;
    inspected.add(relative);
    const full = path.resolve(root, relative);
    if (!inside(full) || !fs.existsSync(full)) return;
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(full)) if (!['node_modules', '.git', '__pycache__'].includes(entry)) queue.push(`${relative}/${entry}`);
      return;
    }
    if (!stat.isFile() || stat.size > 100_000_000) return;
    if (!/\.(?:md|json|[cm]?js|[cm]?ts|tsx|jsx|py)$/i.test(relative)) return;
    const text = fs.readFileSync(full, 'utf8');
    const links = [...text.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)].map(m => m[1]);
    // Manifest entrypoint paths and existing relative document paths in code
    // spans are included too; prose task output paths that do not exist are not.
    for (const match of text.matchAll(/["'`]((?:\.{1,2}\/|src\/|docs\/|tests\/|test\/|\.github\/)[^"'`\r\n]+)["'`]/g)) links.push(match[1]);
    for (const link of links) {
      if (/^(?:[a-z]+:|\/|#)/i.test(link)) continue;
      let target: string; try { target = decodeURIComponent(link.split('#')[0]); } catch { continue; }
      let destination = path.resolve(path.dirname(full), target);
      if (!fs.existsSync(destination) && !path.extname(destination)) {
        const resolved = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx'].map(extension => destination + extension).find(candidate => fs.existsSync(candidate));
        if (resolved) destination = resolved;
      }
      if (!inside(destination) || !fs.existsSync(destination) || fs.lstatSync(destination).isSymbolicLink()) continue;
      const rel = path.relative(root, destination).replaceAll('\\', '/');
      if (!outsideRuntime(rel) || referenced.has(rel)) continue;
      // Relative directories in executable source can be CommonJS package/index
      // dependencies. Retain their closure conservatively; prose output/history
      // directory links still do not make archives required runtime content.
      if (!fs.lstatSync(destination).isFile() && !/\.(?:[cm]?[jt]sx?|py)$/i.test(relative)) continue;
      referenced.add(rel); queue.push(rel);
    }
  };
  const seed = (directory: string, relative: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (outsideRuntime(rel) || entry.name === '.git' || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!['node_modules', '.git', '__pycache__'].includes(entry.name)) seed(path.join(directory, entry.name), rel); }
      else if (relative || !/^(?:readme|changelog|contributing)(?:\.[a-z-]+)?\.md$/i.test(entry.name)) inspect(rel);
    }
  };
  seed(root, ''); while (queue.length) inspect(queue.shift()!);
  return relative => outsideRuntime(relative) && ![...referenced].some(ref => ref === relative || ref.startsWith(relative + '/') || relative.startsWith(ref + '/'));
}
