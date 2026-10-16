# Drillbook

Timed debugging, incident and coding drills with model answers, readable mock dashboards, and a hover glossary.
Static SvelteKit site (no server), deployed to GitHub Pages.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # content validator (broken term links, chart data, duplicate ids, time budgets)
npm run check      # type check
npm run build      # static site in build/
```

## Deploy to GitHub Pages

1. Push to a GitHub repo on the `main` branch.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. `.github/workflows/deploy.yml` tests, builds with `BASE_PATH=/<repo-name>`, and publishes.

For a user/org site (`<name>.github.io`) or a custom domain, set `BASE_PATH: ''` in the workflow.

## Layout

```
src/lib/content/       all content as typed data (see docs/CONTENT_GUIDE.md)
  types.ts             schema: Assessment → Part → Question → Block[]; GlossaryTerm
  assessments/*.ts     one file per assessment, auto-discovered
  glossary/*.ts        glossary terms by domain, auto-discovered
  series.ts            seeded helpers for chart data
  inline.ts            **bold** *em* `code` [[term]] markup parser
  content.test.ts      validator
src/lib/components/    Blocks renderer, QuestionCard, Term popover, search, timer
src/lib/charts/        SVG dashboards (4 skins), time series/bars, heatmap, gauge, logs, traces
src/routes/            /, /a/[id]/, /glossary/, /glossary/[id]/
```

Adding an assessment means adding one file to `src/lib/content/assessments/`. No UI changes needed.

## License

Non-commercial, attribution required.

- **Content** (`src/lib/content/`, `docs/`): [CC BY-NC 4.0](LICENSE-CONTENT). Share and adapt for non-commercial use with credit to **LeOndaz** and a link back.
- **Code**: [PolyForm Noncommercial 1.0.0](LICENSE-CODE).

Commercial use needs written permission. See [LICENSE](LICENSE).
