import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = fileURLToPath(new URL("../dist/server/", import.meta.url));
if (resolve(target) !== resolve(root, "dist", "server")) throw new Error("Unexpected server build path");
rmSync(target, { recursive: true, force: true });
