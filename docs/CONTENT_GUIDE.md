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

## Interactive labs (`lab` block)

A lab is a deterministic simulation rendered as a cloud or Kubernetes console (`src/lib/labs/`). See `src/lib/content/labs/flash-sale-backlog.ts` for the reference.

- **State** is a flat record. Keys starting with `_` are hidden internals (backlog, timers).
- **Resources** appear in the left nav, grouped by `service`. `fields` edit state keys and land after `applySeconds` (the rollout delay is part of the puzzle). `actions` are buttons (`danger` + `confirm` for destructive ones).
- **`step(s, ctx)`** advances one simulated second and returns only changed keys. **Metrics** are pure functions of state.
- **`win`** must hold for `hold` seconds; **`lose`** conditions end the run (SLA breach, data loss, budget blown).
- **`solution`** (required) and **`trap`** (recommended) are scripted move lists. The validator replays them: the solution must win, doing nothing must not win, and the trap must not win.
- Design rule: **the obvious move must be wrong or insufficient**, and the console must contain the evidence (a status pill, a detail row, an alarm) that points to the real constraint.
- Put labs in `src/lib/content/labs/<name>.ts` (default export) and import them into the assessment. Explain the mechanics in the question's answer (debrief).

## Mock UI (`mock` block)

A mock screen built from `MockEl` specs (`src/lib/mock/MockScreen.svelte`). With `mode: 'spot'` the reader clicks elements they think are wrong, then checks against planted `issue`s (≥3, validator-enforced) and `decoy`s (look wrong, aren't; explain why). Use `look` to plant visual problems: `faint` (low contrast), `tiny` (small tap target), `color` (colour-only status). The answer should still give the full written critique, ranked by user harm.

## Code review (`diff` block)

A pull request with one or more files (`src/lib/review/`). `patch` is a unified-diff body: lines start with ` `, `+` or `-`; `@@ -12 +12 @@ heading` starts a new hunk. `notes` anchor to the single line containing `match` (validator-enforced) and carry an `issue` with `severity` (`blocker` | `major` | `minor` | `nit`) or a `decoy`. In review mode the reader clicks lines, submits, and sees found / missed / noise.

## Terminal (`terminal` block)

A sandboxed shell over an in-memory filesystem (`src/lib/terminal/`). Reusable anywhere.

- `files`: absolute path → content (parents auto-created). Generate big logs with `genLines(n, i => …)`.
- Builtins: ls cd pwd cat head tail grep (-i -v -n -c -l -r -E -o -A/-B/-C) wc sort (-n -r -k -t -u -h) uniq (-c -d -u) cut tr awk sed (s///, -n Np, /re/p) find (-name -type -size -maxdepth -exec) tree du df stat file jq base64 sha256sum xargs tee diff column nl seq echo printf env export history … plus pipes, `&&`, `||`, `;`, `>`, `>>`, `<`, `$VAR`, globs.
- awk subset: `$N`, `$NF`, `NR`, patterns (`/re/`, `$3 > 100`, `$6 ~ /x/`), `print`/`printf`, sums, `count[$1]++` with `END { for (k in count) print k, count[k] }`.
- jq subset: paths, `.[]`, `select`, `map`, `keys`, `length`, `sort_by`, `group_by`, object construction, `test`, `-r`, `-c`.
- `commands`: scenario commands (kubectl, psql, dig, aws, docker, systemctl, journalctl, curl…) built with `routes([[/regex/, output | (m, ctx) => output]])`, `table()`, `pgTable()` from `src/lib/terminal/scenario.ts`. Commands may read/write `ctx.state` to model side effects.
- `answer`: `submit <answer>` checks via `check(answer, state)` (use `oneOf(...)`). `solution` is replayed by the validator: no command may be "not found"/"unsupported", and it must end in a passing submit.
