import * as fs from "node:fs";
import type { FileSystem } from "../../ports/file-system.js";

export const nodeFileSystem = {
  readText: (filePath) => fs.readFileSync(filePath, "utf-8"),
  writeText: (filePath, content) => fs.writeFileSync(filePath, content),
} satisfies FileSystem;
