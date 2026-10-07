import { backupAll, type BackupAllDependencies } from '../application/backup-all.js';
import { redactString } from '../lib/redact.js';

const HELP = 'uagent-sync backup --all [--dry-run] [--connection <file>] [--workspace-id <id>] [--workspace-files report-all|git-only] [--message <text>] [--target-agent codex] [--json] [--lang en|zh]\nCommit and push projects to their existing origins; publish personal settings, rules, Skills, memories and installed extension content to the registered PRIVATE GitHub registry.\nDry-run does not capture files, commit or upload. Default report-all reports files outside Git as gaps. Explicit git-only excludes these files (including ignored models and sequence data), while project and plugin failures still prevent completion. Credentials and host runtime state are excluded.';
/** Trusted host composition only; no CLI, environment or snapshot policy path. */
export function createBackupCliHandler(dependencies: BackupAllDependencies = {}) {
 return async function backupCliHandler(args: string[]): Promise<number> {
  if (args.some(x => ['--help', '-h', 'help'].includes(x))) { console.log(HELP); return 0; }
  try {
    const values = new Map<string, string | boolean>();
    const booleans = new Set(['all', 'dry-run', 'json']);
    const strings = new Set(['connection', 'workspace-id', 'workspace-files', 'message', 'target-agent', 'lang']);
    for (let i = 0; i < args.length; i++) {
      const match = /^--([^=]+)(?:=(.*))?$/.exec(args[i]);
      if (!match) throw new Error('Expected backup option, got ' + args[i]);
      const [, key, inline] = match;
      if (booleans.has(key)) {
        if (inline !== undefined && !['true', 'false'].includes(inline)) throw new Error('Invalid boolean --' + key);
        values.set(key, inline !== 'false');
      } else if (strings.has(key)) {
        const value = inline ?? args[++i];
        if (!value || value.startsWith('--')) throw new Error('--' + key + ' requires a value');
        values.set(key, value);
      } else throw new Error('Unknown backup option --' + key);
    }
    if (values.get('all') !== true) throw new Error('Use backup --all to select projects, extensions and all supported personal components.');
    if (values.has('target-agent') && values.get('target-agent') !== 'codex') throw new Error('Unified backup currently supports --target-agent codex only.');
    if (values.has('lang') && !['en', 'zh'].includes(String(values.get('lang')))) throw new Error('--lang must be en or zh');
    if (values.has('workspace-files') && !['report-all', 'git-only'].includes(String(values.get('workspace-files')))) throw new Error('--workspace-files must be report-all or git-only');
    const report = await backupAll({ connectionFile: values.get('connection') as string | undefined, workspaceId: values.get('workspace-id') as string | undefined, workspaceFiles: values.get('workspace-files') as 'report-all' | 'git-only' | undefined, message: values.get('message') as string | undefined, dryRun: values.get('dry-run') === true }, dependencies);
    if (values.get('json') === true) console.log(JSON.stringify(report, null, 2));
    else {
      const zh = values.get('lang') === 'zh' || process.env.UAGENT_SYNC_LANG === 'zh';
      console.log(`${zh ? '统一备份' : 'Unified backup'}: ${report.status}`);
      if (report.workspaceRoot) console.log(`${zh ? '工作区' : 'Workspace'}: ${report.workspaceRoot}`);
      console.log(`${zh ? '工作区文件范围' : 'Workspace file policy'}: ${report.workspaceFilePolicy}`);
      if (report.nonGitFilesExcluded) console.log(`${zh ? '按范围排除的非Git文件' : 'Non-Git files excluded by scope'}: ${report.nonGitFilesExcluded.files} (${report.nonGitFilesExcluded.bytes} bytes)`);
      if (report.registry.remote) console.log(`${zh ? '配置仓库' : 'Registry'}: ${report.registry.remote} (${report.registry.verified ? 'verified' : 'unverified'})`);
      for (const project of report.projects) console.log(`${project.path}: ${project.status}${project.remote ? ' -> ' + project.remote : ''}${project.head ? ' @ ' + project.head : ''}`);
      if (report.snapshotDir) console.log(`${zh ? '快照' : 'Snapshot'}: ${report.snapshotDir}`);
      if (report.reportPath) console.log(`${zh ? '报告' : 'Report'}: ${report.reportPath}`);
      for (const error of report.errors) console.log(`${zh ? '失败' : 'Error'}: ${error}`);
      for (const item of report.remaining) console.log(`${zh ? '未覆盖' : 'Remaining'}: ${item}`);
      for (const item of report.excluded) console.log(`${zh ? '排除' : 'Excluded'}: ${item}`);
    }
    return report.ok ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, status: 'failed', error: redactString(error instanceof Error ? error.message : String(error)) }));
    return 1;
  }
 };
}
export async function runBackupCli(args: string[]): Promise<number> {
  return createBackupCliHandler()(args);
}
