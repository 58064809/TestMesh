import { cpSync, mkdirSync } from "node:fs";
import { URL } from "node:url";

// tsc emits JavaScript only; Deep Agents reads these skill files at runtime.
const target = new URL("../dist/server/requirement-analysis/skills/", import.meta.url);
mkdirSync(target, { recursive: true });
cpSync(new URL("../server/requirement-analysis/skills/", import.meta.url), target, { recursive: true });
