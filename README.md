# Parish Health Explorer

A static lookup tool for the 209 parishes of the **Archdiocese of Detroit**, built
from the archdiocese's own public restructuring workbooks. It accompanies the free
Substack series in `Substack Articles/detroit-parish-health/`, which is where the
data pipeline lives.

Plain HTML/CSS/JS — no framework, no build step, no dependencies.

## Views

| Tab | What it does |
|---|---|
| **Find a parish** | Type-ahead over all 209 parishes (and their cities) → a scorecard: money, balance sheet, people, decade change, the five distress flags as an explicit checklist, and planning-area context. Every figure is shown against the archdiocese-wide median. |
| **All 209** | Sortable, filterable table (planning area, finances, attendance bucket, flag count) with a **Download this view as CSV** button. |
| **Planning areas** | The 15 areas compared — inline bar charts plus a full table. |
| **About the numbers** | What each measure means, what the at-risk flags are and explicitly are not, and the caveats. |

## Data

Everything comes from one file, `data/parishes.json` (~200–400 KB): all 209 parish
records plus a `meta` block with archdiocese-wide medians, attendance buckets and the
planning-area rollups. One fetch, no per-parish requests.

Regenerate it after re-running the analysis pipeline:

```
cd "../../Substack Articles/detroit-parish-health"
python analyze.py            # rebuilds output/analysis/parish_master.csv
python build_webtool_data.py # writes ../../Coding Projects/Parish Health Explorer/data/parishes.json
```

`build_webtool_data.py` reuses `analyze.py`'s parish-name matcher, because the
archdiocese labels the same parish differently in its comparison tables and its
listing page.

## Run locally

`fetch()` needs HTTP, so opening `index.html` from the filesystem will not work
(the page says so if you try):

```
python -m http.server 8000
# then open http://localhost:8000/
```

## Analytics

Anonymous, cookieless [GoatCounter](https://www.goatcounter.com/) (account
`epzmckee`), following the same pattern as the other tools here: the script tag in
`<head>` plus a guarded `trackEvent()` in `app.js` that no-ops when GoatCounter is
absent and never throws. Events: `view-<tab>`, `search-parish`, `view-parish`,
`sort-<column>`, `filter-<type>`, `download-csv`. No parish name is ever sent — a
parish view is counted, not identified.

GoatCounter ignores `localhost`, so locally the check is "script present,
`trackEvent` defined, no console errors"; real counts appear only once deployed.

## Deploy to GitHub Pages

Copy this folder into a public repo, then in **Settings → Pages** set
**Source** to *Deploy from a branch* and pick the branch and root. No build step.

## Accessibility

Built to WCAG 2.2 AA practice, consistent with the teaching tools in this folder,
though as a personal-publication tool it does not carry the formal conformance
report those require (see `../CLAUDE.md` for which tools do):

- semantic landmarks and headings; a skip link
- a real ARIA tabs pattern (arrow/Home/End keys) and combobox
  (`aria-expanded` / `aria-activedescendant`, arrow keys, Enter, Escape)
- real `<table>` markup with `<th scope>` and `aria-sort` on sortable columns
- status never encoded by colour alone — every badge and flag pairs colour with a
  glyph **and** a word
- ≥44px targets, visible focus rings, light and dark themes both contrast-checked
- wide tables scroll inside their own container so the page never scrolls sideways
- `prefers-reduced-motion` respected
