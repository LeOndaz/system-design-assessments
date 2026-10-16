# Content guide

All content is typed data in `src/lib/content/`. The UI renders whatever is there.

```
src/lib/content/
  types.ts          ← the schema (read this first)
  inline.ts         ← inline markup parser for Rich strings
  series.ts         ← seeded helpers for chart data (timeAxis, shape, step, ramp, …)
  index.ts          ← auto-discovers files below; never needs editing
  content.test.ts   ← validator: `npm run validate`
  assessments/
    a1-full-stack.ts        default export: Assessment
    a2-microservices.ts
    …
  glossary/
    core.ts                 default export: GlossaryTerm[]
    microservices.ts
    …
```

## Inline markup (`Rich` strings)

`**bold**` · `*em*` · `` `code` `` · `[[term-id]]` · `[[term-id|shown text]]` · `[text](https://…)`

Escape a literal `*` or `[` with a backslash (in a TS string: `'\\*'`).

`[[term-id]]` shows the term's display name with a dotted underline; hovering or tapping shows the definition. Use `[[id|label]]` when the sentence needs different wording, e.g. `[[n-plus-one|N+1 queries]]`.

**Link a term the first time it appears in a question** (prompt or answer), not every time. Link anything a mid-level engineer might only half-know.

## Writing rules

- **No company or employer names.** Assessments are generic. Fictional products and people are fine ("Ledgerly", "Sara from Finance").
- **The answer shows reasoning.** Use a `ranked` block for hypotheses: `title` = the claim, `body` = why the evidence points there, `confirm` = the single check that proves or kills it. Then say what you'd **rule out** and why, then **mitigate now** vs **fix properly**.
- **Make the evidence do the work.** In chart questions the answer must cite specific panels and numbers ("the 14:02 step in *Pool wait* precedes the p99 rise by 40 s"). Include at least one **red herring** in harder chart questions and say why it's a red herring.
- **Tricky means tricky.** Prefer scenarios where the obvious first guess is wrong, and say so in the answer ("The tempting answer is X. It's wrong because…").
- **Non-technical reports** (`ticket` block) use the reporter's real vocabulary: vague, sometimes wrong about the cause, no jargon. The answer should (1) restate as a testable claim, (2) list clarifying questions you'd ask back, (3) rank hypotheses, (4) include a model reply to the reporter in plain language.
- Keep code snippets short (≤ 25 lines) and realistic. Python, TypeScript, Go, SQL, YAML are all fine.
- Tags: `core` standard, `tricky` non-obvious, `variant` twist on a previous one, `template` model write-up, `teaser` 1–2 minute rapid fire, `design` open design question, `coding` implement-it task.

## Glossary entries

```ts
{
  id: 'littles-law',
  term: "Little's law",
  category: 'latency & capacity',
  short: 'In any stable system, the number of requests in flight equals arrival rate × time each one spends inside (L = λ × W). …',
  analogy: 'A coffee shop with 10 customers arriving per minute who each stay 3 minutes always has about 30 people inside.',
  related: ['worker-pool', 'connection-pool'],
  page: [ /* optional Block[]: dedicated page with worked examples */ ]
}
```

- `short` explains for **understanding**, not recall: what it is, *why* it happens, why it matters for debugging. 2–4 sentences. No circular definitions. Avoid jargon inside the definition; if unavoidable, link it.
- Add a `page` when the idea needs a worked example, a chart, or a "how to spot it" section. Pages can use any block type, including dashboards.
- Before adding a term, search `src/lib/content/glossary/` for an existing id. The validator fails on duplicates.

## Chart data

Use the helpers in `series.ts` so charts are deterministic:

```ts
import { timeAxis, shape, step, ramp, bump, periodic, sawtooth, wave } from '../series';
const x = timeAxis('13:30', 60);                       // 60 one-minute labels
const p95 = shape(60, { base: 180, noise: 0.08, seed: 1 }, step(30, 5200));
```

Every series must have exactly `x.length` points (the validator checks). Typical sizes: 40–90 points. Panels sit in a 6-column grid: `span: 6` full width, `3` half, `2` third, `1` a small stat.

Dashboard styles: `grafana` (dark), `cloudwatch` (light, AWS-console-like), `kibana` (light, log analytics), `datadog` (light/purple APM). Pick the style that matches the story (CloudWatch for AWS resources, Kibana for logs, Grafana for Prometheus metrics).
