import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import "./catalog.js";
import "./geometry.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
const { items, svg, icon } = globalThis.NTOXGlyphs;
for (const folder of ["artwork", "icons"]) mkdirSync(join(directory, folder), { recursive: true });
for (const item of items) {
  writeFileSync(join(directory, "artwork", `${item.id}.svg`), svg(item));
  writeFileSync(join(directory, "icons", `${item.id}.svg`), icon(item));
}
writeFileSync(join(directory, "manifest.json"), JSON.stringify(items.map(({ icon, ...item }) => ({ ...item, artwork: `artwork/${item.id}.svg`, navigation: `icons/${item.id}.svg` })), null, 2));
console.log(`Created ${items.length} artwork glyphs and ${items.length} navigation glyphs.`);
