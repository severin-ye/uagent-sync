import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "dashboard");
const target = path.join(root, "dist", "dashboard");
fs.mkdirSync(target, { recursive: true });
for (const legacy of ["extension-conflicts.html", "extension-conflicts.js"]) {
  const file = path.join(target, legacy);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
for (const name of ["index.html", "styles.css", "app.js", "i18n.js", "migration-analysis.js"]) fs.copyFileSync(path.join(source, name), path.join(target, name));
