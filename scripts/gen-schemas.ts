import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildJsonSchemas } from "../src/domain/json-schemas";

const dir = join(process.cwd(), "schemas");
mkdirSync(dir, { recursive: true });
for (const [file, schema] of Object.entries(buildJsonSchemas())) {
  writeFileSync(join(dir, file), JSON.stringify(schema, null, 2) + "\n");
  console.log(`schemas/${file}`);
}
