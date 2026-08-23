import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import * as publicApi from "../src/sync.js";
import { createAgentAdapterRegistry } from "../src/adapters/agents/registry.js";
import type { AgentPaths } from "../src/lib/agent-paths.js";

const ROOT = path.resolve(import.meta.dirname, "..");

interface ImportEdge {
  sourceFile: string;
  modulePath: string;
  importedNames: string[];
}

function importsIn(filePath: string): ImportEdge[] {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edges: ImportEdge[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const bindings = node.importClause?.namedBindings;
    const importedNames = bindings && ts.isNamedImports(bindings)
      ? bindings.elements.map((element) => element.propertyName?.text ?? element.name.text)
      : [];
    edges.push({
      sourceFile: path.relative(ROOT, filePath).replaceAll("\\", "/"),
      modulePath: node.moduleSpecifier.text,
      importedNames,
    });
  });

  return edges;
}

function productionTsFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTsFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

test("migrated entrypoints depend on Application instead of migrated domain orchestrators", () => {
  const migratedDomainOrchestrators = new Set([
    "verifyEnvironment",
    "setupWorkspace",
    "updateExtensions",
    "importSystemState",
    "restoreCodexExtensions",
  ]);
  const violations = ["src/cli.ts", "src/plugin.ts"].flatMap((relativePath) =>
    importsIn(path.join(ROOT, relativePath)).flatMap((edge) =>
      edge.importedNames
        .filter((name) => migratedDomainOrchestrators.has(name))
        .map((name) => `${edge.sourceFile} imports ${name} from ${edge.modulePath}`),
    ),
  );

  assert.deepEqual(violations, []);
});

test("Application never imports presentation entrypoints", () => {
  const applicationRoot = path.join(ROOT, "src", "application");
  const violations = productionTsFiles(applicationRoot).flatMap((filePath) =>
    importsIn(filePath)
      .filter((edge) => {
        if (!edge.modulePath.startsWith(".")) return false;
        const target = path.resolve(path.dirname(filePath), edge.modulePath.replace(/\.js$/, ".ts"));
        const relativeTarget = path.relative(path.join(ROOT, "src"), target).replaceAll("\\", "/");
        return relativeTarget === "cli.ts"
          || relativeTarget === "plugin.ts"
          || relativeTarget === "dsh-plugin.ts"
          || relativeTarget.startsWith("entrypoints/");
      })
      .map((edge) => `${edge.sourceFile} imports ${edge.modulePath}`),
  );

  assert.deepEqual(violations, []);
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

test("the Agent registry accepts a fourth adapter without changing core flows", () => {
  const fourthAdapter = {
    id: "future-agent" as never,
    scan: () => ({ id: "future-agent", displayName: "Future Agent", available: true, capabilities: [] }) as never,
  };
  const registry = createAgentAdapterRegistry([fourthAdapter]);

  assert.deepEqual(registry.adapters, [fourthAdapter]);
  assert.equal(registry.scan({} as AgentPaths)[0]?.displayName, "Future Agent");
});
