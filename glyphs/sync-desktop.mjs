import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import "./catalog.js";
import "./geometry.js";

const source = fileURLToPath(new URL(".", import.meta.url));
const destination = fileURLToPath(new URL("../desktop/glyphs/", import.meta.url));
mkdirSync(join(destination, "artwork"), { recursive: true });
for (const name of ["catalog.js", "geometry.js"]) copyFileSync(join(source, name), join(destination, name));
for (const item of globalThis.NTOXGlyphs.items) writeFileSync(join(destination, "artwork", item.id + ".svg"), globalThis.NTOXGlyphs.svg(item));
writeFileSync(join(destination, "manifest.json"), JSON.stringify(globalThis.NTOXGlyphs.items.map(({ id }) => id), null, 2) + "\n");
console.log(`Synced ${globalThis.NTOXGlyphs.items.length} glyphs into the desktop application.`);
