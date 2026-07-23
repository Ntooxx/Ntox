import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NTOX_DIR = mkdtempSync(join(tmpdir(), "ntox-test-"));
