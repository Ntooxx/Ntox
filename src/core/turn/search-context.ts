import { searchTool } from "../../tools/search.js";
import { webFetchTool } from "../../tools/web.js";
import { RESEARCH_QUESTION_PATTERN } from "./turn-helpers.js";

export interface SearchState {
  cache: Map<string, string>;
  lastEntity: string;
}

export async function resolveSearchContext(userInput: string, state: SearchState): Promise<string> {
  const researchQuestion = RESEARCH_QUESTION_PATTERN.test(userInput);
  if (researchQuestion) {
    const queries = [userInput, `site:arxiv.org ${userInput}`, `site:aclanthology.org ${userInput}`];
    const results = await Promise.all(
      queries.map(async (query) => {
        try {
          const result = await searchTool.execute({ query });
          return result.success && typeof result.data === "string" ? result.data : "";
        } catch {
          return "";
        }
      }),
    );
    const searchResults = results.filter(Boolean);
    if (searchResults.length === 0) {
      return "\n\n## Research Search Status\nA web search for related work was attempted but returned no usable results. Do not make claims that an idea is novel, unexplored, or unsaturated. State that novelty could not be verified and ask for or suggest a literature search.";
    }
    const blocks = searchResults.join("\n---\n").split(/\n---\n/);
    const seenUrls = new Set<string>();
    const candidates = blocks.flatMap((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const url = lines.find((line) => /^https?:\/\//i.test(line));
      if (!url || seenUrls.has(url)) return [];
      seenUrls.add(url);
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return [];
      }
      const scholarlyHost =
        /(^|\.)(arxiv\.org|aclanthology\.org|openreview\.net|acm\.org|ieeexplore\.ieee\.org|doi\.org|proceedings\.neurips\.cc|aaai\.org)$/i.test(
          host,
        );
      return [
        {
          url,
          title: lines[0] ?? url,
          snippet: lines
            .filter((line) => line !== url)
            .slice(1)
            .join(" "),
          scholarlyHost,
        },
      ];
    });
    const toRead = candidates.filter((candidate) => candidate.scholarlyHost).slice(0, 3);
    const opened = await Promise.all(
      toRead.map(async (candidate) => {
        try {
          const result = await webFetchTool.execute({ url: candidate.url, format: "markdown" });
          const data = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {};
          const content = typeof data.content === "string" ? data.content : "";
          if (!result.success || content.length < 200) return "";
          return `Title: ${String(data.title || candidate.title)}\nURL: ${String(data.url || candidate.url)}\nFetched source text (excerpt):\n${content.slice(0, 4500)}`;
        } catch {
          return "";
        }
      }),
    );
    const leads = candidates
      .slice(0, 10)
      .map(
        (candidate) =>
          `Title: ${candidate.title}\nURL: ${candidate.url}\nSearch snippet (unverified; use as a lead only): ${candidate.snippet}`,
      );
    const openedSources = opened.filter(Boolean);
    return `\n\n## Research Evidence\nNTOX searched these queries: ${queries.join(" | ")}\nOpened source excerpts below are direct fetched text; search snippets are unverified leads. Do not cite a snippet as if the paper itself was checked. Search coverage is limited and cannot establish that nobody has done something. For each important claim, identify the evidence that supports it; distinguish source-backed facts from inference and recommendation. For novelty, state the narrow scope searched and leave novelty unverified unless the evidence warrants a stronger conclusion.\n\n### Opened sources\n${openedSources.length ? openedSources.join("\n\n---\n\n") : "No scholarly source page could be opened. Treat all search results as leads and say source verification was unavailable."}\n\n### Search leads\n${leads.join("\n\n---\n\n")}`;
  }

  const searchPatterns = [
    /^(what|who|tell me about|what about|what does|what is|who is)\s+(.+)/i,
    /^(can you|could you|could u|would you|tell me)\s+.*(what|who)\s+(is|are|was)\s+(.+)/i,
    /^(search|look up|find|google)\s+(for\s+)?(.+)/i,
    /^(.+?)\s+(is|are|was|were)\s+(a|an|the)\s/i,
    /^(do you know|what do you know about)\s+(.+)/i,
    /^(what|who|why|when|where|how)\s+(is|are|was|were|do|does|did)\s+(.+)/i,
  ];
  let entityMatch = searchPatterns.reduce((m: RegExpExecArray | null, p) => m || p.exec(userInput.trim()), null);
  if (!entityMatch) {
    const cmd = userInput.match(/(?:search|look up|find|google)\s+(?:for\s+)?(.{3,50})/i);
    if (cmd) entityMatch = cmd as unknown as RegExpExecArray;
  }
  if (!entityMatch && /\b(search|look up|find|google)\b/i.test(userInput) && state.lastEntity) {
    const clean = state.lastEntity;
    const cached = state.cache.get(clean);
    if (cached) return cached;
    try {
      const result = await searchTool.execute({ query: clean });
      if (result.success && typeof result.data === "string") {
        const ctx = `\n\n## Relevant Information (from web search for "${clean}")\n${result.data.slice(0, 1500)}`;
        state.cache.set(clean, ctx);
        return ctx;
      }
    } catch {
      /* search failed */
    }
  }
  if (entityMatch) {
    const groups = entityMatch.slice(1).filter((g) => g && typeof g === "string" && g.length > 2);
    const entity = groups[groups.length - 1];
    const clean = entity
      .replace(/[^a-z0-9\s]/gi, "")
      .trim()
      .toLowerCase();
    const skipWords = new Set([
      "you",
      "your",
      "it",
      "that",
      "this",
      "there",
      "here",
      "how",
      "what",
      "why",
      "when",
      "where",
      "who",
      "which",
      "do",
      "does",
      "did",
      "is",
      "are",
      "was",
      "were",
      "can",
      "could",
      "would",
      "will",
      "shall",
      "may",
      "might",
      "please",
      "thanks",
      "online",
      "now",
      "then",
      "first",
      "next",
      "last",
      "up",
      "down",
      "about",
      "into",
      "with",
      "without",
      "for",
      "from",
      "like",
      "just",
      "also",
    ]);
    if (clean.length > 2 && clean.split(/\s+/).length <= 6 && !skipWords.has(clean)) {
      const cached = state.cache.get(clean);
      if (cached) return cached;
      try {
        const result = await searchTool.execute({ query: clean });
        if (result.success && typeof result.data === "string") {
          const ctx = `\n\n## Relevant Information (from web search for "${clean}")\n${result.data.slice(0, 1500)}`;
          state.cache.set(clean, ctx);
          state.lastEntity = clean;
          return ctx;
        }
      } catch {
        /* search failed, proceed without */
      }
    }
  }
  return "";
}
