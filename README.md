# API Manufacturing Schedule · FY 2026-27

A modern, glassmorphic React webapp that replaces an Excel-based pharmaceutical manufacturing scheduler.

## What it does

Given master data for **20 APIs**, **82 stages**, and **20 reactors** (some shared), the app:

1. Generates **848 batches** sequenced by an equipment-availability algorithm
2. Tags each batch as **FY** (Apr 2026 – Mar 2027) or **Ovr** (overflow)
3. Verifies **zero reactor clashes** by construction
4. Renders a **weekly Gantt chart**, **reactor occupancy heatmap**, **clash report**, and **quarterly summary**
5. Lets you **edit master data** (yellow cells) and recomputes the entire schedule in ~350 ms

## Tabs

| Tab | What you see |
|-----|--------------|
| Master Data | 82-row editable template (yellow = input) |
| Schedule | All 848 batches with start / end / analysis dates, FY & clash flags, CSV export |
| Gantt Chart | Weekly Gantt Apr 26 – Mar 27, color per API, faded tail = analysis window |
| Equipment | 20-reactor × 52-week occupancy heatmap, util bars, weekly fleet trend |
| Clash Report | Zero-clash hero + sequencer explanation + shared-reactor proof |
| Quarterly Summary | Pivot (API × Stage × Q1–Q4 + FY total) + bar chart + treemap |

## Run

```bash
npm install
npm run dev
# open http://localhost:5173
```

## Build

```bash
npm run build
npm run preview
```

## Tech stack

- **Vite + React 18 + TypeScript**
- **Tailwind CSS v3** (custom dark / glass design system)
- **Zustand** (state, debounced re-scheduler)
- **Recharts** (bar / line / treemap)
- **date-fns** (date math)
- **lucide-react** (icons)

## Architecture

```
src/
  data/seed.ts          Deterministic generator (20 APIs, 82 stages, 20 reactors)
  scheduler/scheduler.ts Equipment-availability sequencer -> ScheduleResult
  utils/dates.ts        FY week buckets, quarter mapping
  store.ts              Zustand store + debounced recompute
  components/           UI primitives (Card, Pill, Tag, SectionHeader)
  tabs/                 6 tabs (one file each)
```

## Scheduler algorithm (in 4 lines)

```
for each campaign round:
  for each (API, stage):
    pick reactor in pool with earliest free slot >= max(prev-stage-end, horizon)
    book [start, start + cycleHours], analysis runs after, reactor free
```

That's it. Shared reactors (R105–R108, R205–R206) are auto-queued by the
"earliest free" rule — no special-case logic needed.
