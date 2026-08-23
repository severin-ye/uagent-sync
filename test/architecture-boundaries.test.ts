import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import * as publicApi from "../src/sync.js";
import { createAgentAdapterRegistry } from "../src/adapters/agents/registry.js";
import { buildInventoryDiff, scanWorkspaceInventory } from "../src/lib/agent-inventory.js";
import type { AgentPaths } from "../src/lib/agent-paths.js";
import type { AgentCapability, AgentId, AgentInventory } from "../src/lib/agent-inventory-types.js";
import type { AgentAdapter } from "../src/ports/agent-adapter.js";

const ROOT = path.resolve(import.meta.dirname, "..");

interface ImportEdge {
  sourceFile: string;
  modulePath: string;
  importedNames: string[];
  kind: "named" | "default" | "namespace" | "side-effect" | "dynamic";
  localName?: string;
}

function importsFromSource(source: string, filePath: string): ImportEdge[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edges: ImportEdge[] = [];

  const push = (modulePath: string, kind: ImportEdge["kind"], importedNames: string[] = [], localName?: string) => {
    edges.push({ sourceFile: path.relative(ROOT, filePath).replaceAll("\\", "/"), modulePath, importedNames, kind, localName });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const modulePath = node.moduleSpecifier.text;
      if (!node.importClause) push(modulePath, "side-effect");
      if (node.importClause?.name) push(modulePath, "default", [], node.importClause.name.text);
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) push(modulePath, "namespace", [], bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        push(modulePath, "named", bindings.elements.map((element) => element.propertyName?.text ?? element.name.text));
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      const modulePath = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
        ? argument.text
        : "<non-literal>";
      push(modulePath, "dynamic");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return edges;
}

function importsIn(filePath: string): ImportEdge[] {
  return importsFromSource(fs.readFileSync(filePath, "utf8"), filePath);
}

const migratedDomainModules = new Map<string, ReadonlySet<string>>([
  ["lib/workspace.ts", new Set(["verifyEnvironment", "setupWorkspace"])],
  ["lib/update.ts", new Set(["updateExtensions"])],
  ["lib/state.ts", new Set(["importSystemState"])],
  ["lib/codex-restore.ts", new Set(["restoreCodexExtensions"])],
  ["sync.ts", new Set(["verifyEnvironment", "setupWorkspace", "updateExtensions", "importSystemState", "restoreCodexExtensions"])],
]);

function targetWithinSrc(edge: ImportEdge): string | undefined {
  if (!edge.modulePath.startsWith(".")) return undefined;
  const absoluteSource = path.join(ROOT, edge.sourceFile);
  const target = path.resolve(path.dirname(absoluteSource), edge.modulePath.replace(/\.js$/, ".ts"));
  return path.relative(path.join(ROOT, "src"), target).replaceAll("\\", "/");
}

function entrypointDomainViolations(edges: ImportEdge[]): string[] {
  return edges.flatMap((edge) => {
    if (edge.kind === "dynamic" && edge.modulePath === "<non-literal>") {
      return [`${edge.sourceFile} dynamic import target cannot be verified`];
    }
    const target = targetWithinSrc(edge);
    const forbiddenNames = target ? migratedDomainModules.get(target) : undefined;
    if (!forbiddenNames) return [];
    if (edge.kind !== "named") return [`${edge.sourceFile} ${edge.kind} imports ${edge.modulePath}`];
    return edge.importedNames
      .filter((name) => forbiddenNames.has(name))
      .map((name) => `${edge.sourceFile} imports ${name} from ${edge.modulePath}`);
  });
}

function applicationEntrypointViolations(edges: ImportEdge[]): string[] {
  return edges.flatMap((edge) => {
    const target = targetWithinSrc(edge);
    const isEntrypoint = target === "cli.ts"
      || target === "plugin.ts"
      || target === "dsh-plugin.ts"
      || target?.startsWith("entrypoints/");
    const cannotResolveDynamicTarget = edge.kind === "dynamic" && edge.modulePath === "<non-literal>";
    return isEntrypoint || cannotResolveDynamicTarget ? [`${edge.sourceFile} ${edge.kind} imports ${edge.modulePath}`] : [];
  });
}

function productionTsFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTsFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

test("migrated entrypoints depend on Application instead of migrated domain orchestrators", () => {
  const violations = ["src/cli.ts", "src/plugin.ts"].flatMap((relativePath) =>
    entrypointDomainViolations(importsIn(path.join(ROOT, relativePath))),
  );

  assert.deepEqual(violations, []);
});

test("Application never imports presentation entrypoints", () => {
  const applicationRoot = path.join(ROOT, "src", "application");
  const violations = productionTsFiles(applicationRoot).flatMap((filePath) =>
    applicationEntrypointViolations(importsIn(filePath)),
  );

  assert.deepEqual(violations, []);
});

test("import analysis sees and rejects default, namespace, and dynamic import bypasses", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-architecture-imports-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const fixture = path.join(temporaryDirectory, "fixture.ts");
  fs.writeFileSync(fixture, [
    'import workspaceDomain from "./lib/workspace.js";',
    'import * as updateDomain from "./lib/update.js";',
    'void import("./entrypoints/result-formatters.js");',
  ].join("\n"));

  assert.deepEqual(importsIn(fixture).map(({ modulePath, kind, localName }) => ({ modulePath, kind, localName })), [
    { modulePath: "./lib/workspace.js", kind: "default", localName: "workspaceDomain" },
    { modulePath: "./lib/update.js", kind: "namespace", localName: "updateDomain" },
    { modulePath: "./entrypoints/result-formatters.js", kind: "dynamic", localName: undefined },
  ]);

  const entrypointFixture = importsFromSource([
    'import workspaceDomain from "./lib/workspace.js";',
    'import * as updateDomain from "./lib/update.js";',
    'void import("./lib/codex-restore.js");',
    'const domainPath = "./lib/state.js"; void import(domainPath);',
  ].join("\n"), path.join(ROOT, "src", "fixture-entrypoint.ts"));
  const applicationFixture = importsFromSource([
    'import formatter from "../entrypoints/result-formatters.js";',
    'import * as plugin from "../plugin.js";',
    'void import("../cli.js");',
  ].join("\n"), path.join(ROOT, "src", "application", "fixture-application.ts"));

  assert.equal(entrypointDomainViolations(entrypointFixture).length, 4);
  assert.equal(applicationEntrypointViolations(applicationFixture).length, 3);
});

test("the public barrel exposes the implemented architecture contracts", () => {
  for (const name of [
    "defaultWorkspaceApplication",
    "createDefaultWorkspaceApplication",
    "parseWorkspaceStateArtifact",
    "CURRENT_WORKSPACE_STATE_SCHEMA_VERSION",
    "createAgentAdapterRegistry",
    "defaultAgentAdapterRegistry",
  ] as const) {
    assert.ok(name in publicApi, `src/sync.ts must export ${name}`);
  }
});

test("the runtime Agent registry carries a fourth scanner through inventory diff", () => {
  const sharedCapability: AgentCapability = { kind: "skills", name: "shared-review", portability: "portable" };
  const adapter = (id: AgentId, label: string, capabilities: AgentCapability[]): AgentAdapter => ({
    id,
    scan: (): AgentInventory => ({ id, label, status: "detected", sources: [], capabilities, warnings: [] }),
  });
  const futureId = "future-agent" as AgentId;
  const futureAdapter = adapter(futureId, "Future Agent", []);
  const registry = createAgentAdapterRegistry([
    adapter("codex", "Codex", [sharedCapability]),
    adapter("opencode", "OpenCode", [sharedCapability]),
    adapter("deepseek", "DeepSeek Harness", [sharedCapability]),
    futureAdapter,
  ]);

  const inventory = scanWorkspaceInventory({ paths: {} as AgentPaths, adapters: registry.adapters });
  const sharedDiff = buildInventoryDiff(inventory).find((item) => item.name === "shared-review");

  assert.equal(inventory.agents.length, 4);
  assert.deepEqual(sharedDiff?.presentIn, ["codex", "opencode", "deepseek"]);
  assert.deepEqual(sharedDiff?.missingFrom, [futureId]);
});
