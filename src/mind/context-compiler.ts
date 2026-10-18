import type { ContextItem } from "./types.js";
import { estimateTokens } from "./util.js";

export interface CompilableItem extends ContextItem {
  text?: string;
  pinned?: boolean;
  order?: number;
}

export interface CompiledContext {
  included: CompilableItem[];
  dropped: CompilableItem[];
  usedTokens: number;
}

export function compileContext(items: CompilableItem[], budgetTokens: number): CompiledContext {
  const tokensOf = (item: CompilableItem) => item.tokens || (item.text ? estimateTokens(item.text) : 1);

  const pinned = items.filter((item) => item.pinned);
  const volatile = items.filter((item) => !item.pinned);

  const included: CompilableItem[] = [];
  const dropped: CompilableItem[] = [];
  let usedTokens = 0;

  for (const item of pinned) {
    const tokens = tokensOf(item);
    if (included.length === 0 || usedTokens + tokens <= budgetTokens) {
      included.push(item);
      usedTokens += tokens;
    } else {
      dropped.push(item);
    }
  }

  const scored = volatile.map((item) => {
    const tokens = tokensOf(item);
    const relevance = item.relevance ?? 0.5;
    const reliability = item.reliability ?? 0.5;
    return { item, tokens, utility: (relevance * (0.5 + 0.5 * reliability)) / Math.max(1, tokens) };
  });
  scored.sort((a, b) => b.utility - a.utility);

  for (const entry of scored) {
    if (included.length === 0 || usedTokens + entry.tokens <= budgetTokens) {
      included.push(entry.item);
      usedTokens += entry.tokens;
    } else {
      dropped.push(entry.item);
    }
  }

  included.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
  dropped.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

  return { included, dropped, usedTokens };
}
