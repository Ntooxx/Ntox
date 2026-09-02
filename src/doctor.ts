import { accessSync, constants, existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, CONFIG_PATH, NTOX_DIR, validateConfig } from "./core/config.js";
import { detectLocalProviders, providerRequiresKey } from "./core/llm.js";

const execFileAsync = promisify(execFile);

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
}

function pass(id: string, label: string, detail: string): DoctorCheck {
  return { id, label, status: "pass", detail };
}

function warn(id: string, label: string, detail: string, fix?: string): DoctorCheck {
  return { id, label, status: "warn", detail, fix };
}

function fail(id: string, label: string, detail: string, fix?: string): DoctorCheck {
  return { id, label, status: "fail", detail, fix };
}

export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const config = loadConfig();
  const validation = validateConfig(config);

  checks.push(validation.valid
    ? pass("config-schema", "Config schema", "config.json is valid")
    : fail("config-schema", "Config schema", validation.errors.join("; "), "Run ntox setup or edit the invalid config fields."));

  checks.push(existsSync(CONFIG_PATH)
    ? pass("config-file", "Config file", CONFIG_PATH)
    : warn("config-file", "Config file", "No config file exists yet", "Run ntox setup."));

  if (existsSync(CONFIG_PATH)) {
    try {
      const mode = statSync(CONFIG_PATH).mode & 0o777;
      checks.push((mode & 0o077) === 0
        ? pass("config-permissions", "Config permissions", `mode ${mode.toString(8)}`)
        : warn("config-permissions", "Config permissions", `mode ${mode.toString(8)} is broader than 600`, "Run ntox setup or save config again to apply 0600 permissions."));
    } catch (e) {
      checks.push(warn("config-permissions", "Config permissions", e instanceof Error ? e.message : String(e)));
    }
  }

  checks.push(providerRequiresKey(config.provider) && !config.apiKey
    ? fail("provider-auth", "Provider auth", `${config.provider} requires an API key`, "Run ntox setup or /config set apiKey <key>.")
    : pass("provider-auth", "Provider auth", providerRequiresKey(config.provider) ? `${config.provider} key configured` : `${config.provider} does not require an API key`));

  try {
    const local = await detectLocalProviders();
    if (config.provider === "ollama") {
      checks.push(local.ollama
        ? pass("local-provider", "Local provider", `Ollama detected with ${local.ollamaModels.length} model(s)`)
        : fail("local-provider", "Local provider", "Ollama is not reachable at localhost:11434", "Start Ollama or switch provider."));
    } else if (config.provider === "lmstudio") {
      checks.push(local.lmstudio
        ? pass("local-provider", "Local provider", `LM Studio detected with ${local.lmstudioModels.length} model(s)`)
        : fail("local-provider", "Local provider", "LM Studio is not reachable at localhost:1234", "Start LM Studio server or switch provider."));
    } else {
      const detected = [
        local.ollama ? `Ollama (${local.ollamaModels.length})` : "",
        local.lmstudio ? `LM Studio (${local.lmstudioModels.length})` : "",
      ].filter(Boolean).join(", ");
      checks.push(detected
        ? pass("local-provider", "Local provider", detected)
        : warn("local-provider", "Local provider", "No local providers detected"));
    }
  } catch (e) {
    checks.push(warn("local-provider", "Local provider", e instanceof Error ? e.message : String(e)));
  }

  checks.push(await checkBrowser());
  checks.push(await checkDocker(config.dockerEnabled));

  const defaultProfile = config.profiles.find((p) => p.id === config.defaultProfileId) || config.profiles[0];
  if (defaultProfile) {
    const missingRoots = [defaultProfile.workspaceRoot, ...defaultProfile.readRoots, ...defaultProfile.writeRoots]
      .filter((path, index, arr) => arr.indexOf(path) === index)
      .filter((path) => !existsSync(path));
    checks.push(missingRoots.length === 0
      ? pass("workspace-roots", "Workspace roots", defaultProfile.workspaceRoot)
      : fail("workspace-roots", "Workspace roots", `Missing: ${missingRoots.join(", ")}`, "Update the active profile paths."));
  }

  try {
    accessSync(NTOX_DIR, constants.R_OK | constants.W_OK);
    checks.push(pass("ntox-dir", "Ntox directory", `${NTOX_DIR} is readable and writable`));
  } catch (e) {
    checks.push(fail("ntox-dir", "Ntox directory", e instanceof Error ? e.message : String(e), "Fix directory permissions or set NTOX_DIR."));
  }

  checks.push(config.webHost === "127.0.0.1" || config.webHost === "localhost"
    ? pass("web-binding", "Web binding", `${config.webHost}:${config.webPort}`)
    : warn("web-binding", "Web binding", `${config.webHost}:${config.webPort} may be reachable from your network`, "Use webHost 127.0.0.1 unless you intentionally expose it."));

  return checks;
}

async function checkBrowser(): Promise<DoctorCheck> {
  try {
    await import("playwright-core");
    return pass("browser-package", "Browser package", "playwright-core is installed");
  } catch {
    try {
      const runtimeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
      await runtimeImport("playwright");
      return pass("browser-package", "Browser package", "playwright is installed");
    } catch {
      return warn("browser-package", "Browser package", "No Playwright package is available", "Install playwright-core and Chromium for browser fallback.");
    }
  }
}

async function checkDocker(enabled: boolean): Promise<DoctorCheck> {
  try {
    await execFileAsync("docker", ["--version"], { timeout: 2500 });
    return enabled
      ? pass("docker", "Docker sandbox", "Docker is available and enabled")
      : warn("docker", "Docker sandbox", "Docker is available but disabled", "Set dockerEnabled true for safer shell execution.");
  } catch {
    return enabled
      ? fail("docker", "Docker sandbox", "Docker is enabled but not available", "Install/start Docker or set dockerEnabled false.")
      : warn("docker", "Docker sandbox", "Docker is not available");
  }
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const icon: Record<DoctorStatus, string> = { pass: "OK", warn: "WARN", fail: "FAIL" };
  const lines = ["Ntox doctor", ""];
  for (const check of checks) {
    lines.push(`${icon[check.status].padEnd(4)} ${check.label}: ${check.detail}`);
    if (check.fix) lines.push(`     fix: ${check.fix}`);
  }
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  lines.push("");
  lines.push(`Summary: ${failures} fail, ${warnings} warn, ${checks.length - failures - warnings} pass`);
  return lines.join("\n");
}

export default async function doctor(): Promise<void> {
  console.log(formatDoctorReport(await runDoctorChecks()));
}
