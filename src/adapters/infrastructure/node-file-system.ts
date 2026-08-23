import * as fs from "node:fs";
import * as path from "node:path";
import type { FileSystem } from "../../ports/file-system.js";

export const nodeFileSystem = {
  exists: (filePath) => fs.existsSync(filePath),
  joinPath: (...parts) => path.join(...parts),
  readText: (filePath) => fs.readFileSync(filePath, "utf-8"),
  writeText: (filePath, content) => fs.writeFileSync(filePath, content),
} satisfies FileSystem;
