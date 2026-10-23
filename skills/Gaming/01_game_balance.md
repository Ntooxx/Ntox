# Game Balance

## Triggers
- "balance this weapon"
- "game balancing"
- "time to kill"
- "difficulty curve"
- "this feels overpowered"
- "nerf or buff"
- "balance spreadsheet"

## Purpose
Balances numeric game systems — weapons, characters, economies, difficulty curves — using spreadsheet modeling, goal-first design, and playtest feedback loops instead of gut nudges.

## Core Principle

Balance is not equality. It is distinct options that each win in the situations they are meant to win, with counterplay available. Perfect symmetry is a spreadsheet fantasy; meaningful tradeoffs are the goal.

## Workflow

1. Name the feeling you want players to have (sniper feels patient, shotgun feels decisive), then the numbers that serve it.
2. Build the model first: one table with every comparable stat — damage, rate, reload, ammo, mobility penalty.
3. Reduce to comparable metrics: DPS, time-to-kill at reference ranges, damage-per-mag, mobility-adjusted DPS.
4. Check the relationships, not the absolutes:
   - TTK band: too narrow (everything same) → boring; too wide (one-shot outliers) → frustrating.
   - Every strategy needs a weakness priced as heavily as its strength.
   - No dominant strategy: if pick rate > 50% in its slot, it wins without conditions.
5. Simulate extremes before players do: max-stat builds, spam strategies, corner cases — if one build is strictly best, the curve is wrong.
6. Change one variable at a time, ~5-10% steps, and predict the outcome before the test.
7. Validate with data: pick/win rates by skill bracket, not forum outrage — high-skill and low-skill imbalances are different bugs.

## Balance Table

| Option | DPS | TTK | Strength | Counterplay | Verdict |
|--------|-----|-----|----------|-------------|---------|
| (fill) | | | one clear identity | what beats it | buff / hold / nerf |

## Common Errors

- Buffing the weak until everything is a stat blob — nerf the outlier instead sometimes.
- Averaging away skill gaps: a weapon balanced at pro play can be useless in casual, or vice versa.
- Patching numbers when the problem is information (players do not know the counter).
- Changing three things in one patch and learning nothing from the result.

## Output Format

Present: the intended feeling, the model table, the specific ratios that violate the rules above, the recommended change with predicted effect, and the metric you will check in two weeks to confirm it worked.
