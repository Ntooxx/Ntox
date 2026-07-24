import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";

const SIGNALS_PATH = join(NTOX_DIR, "external-signals.json");

export interface RepoSignal {
  repo: string;
  stars: number;
  starsDelta: number;
  forks: number;
  openIssues: number;
  lastCommit: string;
  fetchedAt: number;
}

export interface CompetitorSignal {
  name: string;
  repo: string;
  stars: number;
  starsDelta: number;
  lastActivity: string;
  fetchedAt: number;
}

export interface ExternalSignalData {
  repos: RepoSignal[];
  competitors: CompetitorSignal[];
  lastFetchAt: number;
}

const GITHUB_API = "https://api.github.com";
const FETCH_INTERVAL_MS = 60 * 60 * 1000;

export class ExternalSignals {
  private data: ExternalSignalData;
  private dirty = false;

  constructor() {
    this.data = this.load();
  }

  private load(): ExternalSignalData {
    if (!existsSync(SIGNALS_PATH)) return this.defaultData();
    try {
      return { ...this.defaultData(), ...JSON.parse(readFileSync(SIGNALS_PATH, "utf-8")) };
    } catch {
      return this.defaultData();
    }
  }

  private defaultData(): ExternalSignalData {
    return { repos: [], competitors: [], lastFetchAt: 0 };
  }

  private save(): void {
    const tmp = SIGNALS_PATH + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      writeFileSync(SIGNALS_PATH, readFileSync(tmp, "utf-8"));
    } catch { }
    try { unlinkSync(tmp); } catch { }
  }

  private persist(): void {
    if (this.dirty) { this.save(); this.dirty = false; }
  }

  flush(): void {
    if (this.dirty) this.save();
  }

  async fetchRepo(owner: string, repo: string): Promise<RepoSignal | null> {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
        headers: { "Accept": "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as Record<string, unknown>;

      const existing = this.data.repos.find((r) => r.repo === `${owner}/${repo}`);
      const stars = (data.stargazers_count as number) || 0;
      const starsDelta = existing ? stars - existing.stars : 0;
      const forks = (data.forks_count as number) || 0;
      const openIssues = (data.open_issues_count as number) || 0;
      const lastCommit = (data.pushed_at as string) || "";

      const signal: RepoSignal = {
        repo: `${owner}/${repo}`,
        stars,
        starsDelta,
        forks,
        openIssues,
        lastCommit,
        fetchedAt: Date.now(),
      };

      const idx = this.data.repos.findIndex((r) => r.repo === `${owner}/${repo}`);
      if (idx >= 0) {
        this.data.repos[idx] = signal;
      } else {
        this.data.repos.push(signal);
      }
      this.data.lastFetchAt = Date.now();
      this.dirty = true;
      this.persist();

      return signal;
    } catch {
      return null;
    }
  }

  async fetchCompetitor(owner: string, repo: string, name: string): Promise<CompetitorSignal | null> {
    const repoSignal = await this.fetchRepo(owner, repo);
    if (!repoSignal) return null;

    const signal: CompetitorSignal = {
      name,
      repo: `${owner}/${repo}`,
      stars: repoSignal.stars,
      starsDelta: repoSignal.starsDelta,
      lastActivity: repoSignal.lastCommit,
      fetchedAt: Date.now(),
    };

    const idx = this.data.competitors.findIndex((c) => c.repo === `${owner}/${repo}`);
    if (idx >= 0) {
      this.data.competitors[idx] = signal;
    } else {
      this.data.competitors.push(signal);
    }
    this.dirty = true;
    this.persist();

    return signal;
  }

  shouldFetch(): boolean {
    return Date.now() - this.data.lastFetchAt > FETCH_INTERVAL_MS;
  }

  getRepos(): RepoSignal[] {
    return [...this.data.repos];
  }

  getCompetitors(): CompetitorSignal[] {
    return [...this.data.competitors];
  }

  getLastFetchAt(): number {
    return this.data.lastFetchAt;
  }

  buildContext(): string {
    const parts: string[] = [];

    if (this.data.repos.length > 0) {
      const repoLines = this.data.repos.map((r) => {
        const delta = r.starsDelta > 0 ? ` (+${r.starsDelta})` : "";
        return `  - ${r.repo}: ${r.stars} stars${delta}`;
      }).join("\n");
      parts.push(`Repos:\n${repoLines}`);
    }

    if (this.data.competitors.length > 0) {
      const compLines = this.data.competitors.map((c) => {
        const delta = c.starsDelta > 0 ? ` (+${c.starsDelta})` : "";
        return `  - ${c.name}: ${c.stars} stars${delta}`;
      }).join("\n");
      parts.push(`Competitors:\n${compLines}`);
    }

    return parts.length > 0 ? `\n\n## External Signals\n${parts.join("\n")}` : "";
  }

  clearAll(): void {
    this.data = this.defaultData();
    this.dirty = true;
    this.persist();
  }
}