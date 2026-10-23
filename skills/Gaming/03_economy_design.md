# Game Economy Design

## Triggers
- "in game economy"
- "currency balance"
- "inflation in game"
- "loot drop rates"
- "gold sink"
- "reward pacing"
- "gacha odds"

## Purpose
Designs and audits in-game economies: currency loops, faucet/sink balance, reward pacing, and monetization odds — keeping the economy stable, the progression readable, and the monetization defensible.

## Core Principle

Every currency is a promise about time. If earning feels slower than the promise, trust breaks; if sinks are too weak, inflation breaks the promise for everyone. Model the flow before tuning the numbers.

## Workflow

1. List all currencies and resources, and the loop each one sits in (earn -> spend -> gated by -> converts to).
2. Map faucets (where it enters) and sinks (where it leaves) with per-day rates at three player tiers: casual, regular, whale-adjacent.
3. Run the balance: sinks must exceed faucets over a season once the player is established, or prices inflate.
4. Check pacing against the promise: time-to-next-meaningful-unlock should fit the session length (minutes for casual unlocks, days for milestones).
5. Audit acquisition curves: diminishing returns on infinite farms, escalating prices with escalating income, no dead zones where nothing is affordable.
6. For randomized rewards: publish odds, cap bad-luck protection, and never sell the only path to a competitive item without saying so.
7. Simulate a bot player: 30 days of daily caps, no purchases — if they can break the economy, so can a no-life player.

## Faucet/Sink Table

| Source/Use | Casual/day | Regular/day | Whale cap | Verdict |
|------------|-----------|-------------|-----------|---------|
| (fill) | | | | healthy / hot / dead |

## Ethics Floor

- Odds are published and honored; pity timers exist and are stated.
- Spending accelerates convenience or cosmetics, not silent competitive locks — or disclose it loudly.
- No dark patterns: friction to cancel, fear-based timers, and fake discounts destroy long-term trust and retention.

## Output Format

Deliver: the loop diagram in text, the faucet/sink table with the three imbalances ranked by economic damage, the tuning change per imbalance with its predicted player-visible effect, and the metric that proves the fix in one patch cycle.
