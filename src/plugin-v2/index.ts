/** OpenCode v2 entry: shares all business behavior with the retained v1 entry. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { tool, type ToolContext } from "@opencode-ai/plugin";
import legacyPlugin from "../plugin.js";

interface Editor<T> { add(value: T): void }
interface V2Context {
  tool: { transform(apply: (editor: Editor<{
    name: string; description: string; input: Record<string, unknown>;
    execute(input: unknown): Promise<{ content: string; title?: string; metadata?: Record<string, unknown> }>;
  }>) => void): Promise<unknown> };
  skill: { transform(apply: (editor: Editor<{
    id: string; name: string; description: string; path: string; content: string;
  }>) => void): Promise<unknown> };
}

const plugin = {
  id: "uagent-sync",
  async setup(ctx: V2Context) {
    // The legacy factory only constructs definitions; it does not execute tools.
    const legacy = await legacyPlugin({} as Parameters<typeof legacyPlugin>[0]);
    const definitions = Object.entries(legacy.tool ?? {}).map(([name, definition]) => {
      const schema = tool.schema.object(definition.args);
      return {
        name,
        description: definition.description,
        input: tool.schema.toJSONSchema(schema, { io: "input" }),
        async execute(input: unknown) {
          const result = await definition.execute(schema.parse(input), {} as ToolContext);
          if (typeof result === "string") return { content: result };
          return { content: result.output, title: result.title, metadata: result.metadata };
        },
      };
    });
    const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
    const skills = fs.readdirSync(skillsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith("uagent-sync-"))
      .map(entry => {
        const skillPath = path.join(skillsRoot, entry.name, "SKILL.md");
        const source = fs.readFileSync(skillPath, "utf8");
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
        if (!match) throw new Error(`Missing packaged skill frontmatter: ${entry.name}`);
        const description = /^description:\s*(.+)$/m.exec(match[1])?.[1];
        if (!description) throw new Error(`Missing packaged skill description: ${entry.name}`);
        return { id: entry.name, name: entry.name, description, path: skillPath, content: match[2] };
      });
    await ctx.tool.transform(editor => { for (const definition of definitions) editor.add(definition); });
    await ctx.skill.transform(editor => { for (const skill of skills) editor.add(skill); });
  },
};

export default plugin;
