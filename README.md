# API Manufacturing Schedule · FY 2026-27

🔗 **Live demo:** https://raviralavgiri.github.io/manufacturing-schedule/

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

## Cloud persistence with Supabase (optional, free tier)

The app works without any setup (localStorage only). To make your edits sync
across browsers / devices, plug in a free Supabase project:

### 1. Create a free Supabase project

1. Sign up at [supabase.com](https://supabase.com) (free tier: 500 MB DB, no credit card)
2. Create a new project and pick any password (you won't need it)
3. Wait ~30 seconds for it to provision

### 2. Run the schema migration

1. In your Supabase dashboard, go to **SQL Editor → New query**
2. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql) and run it
3. Verify the `workspaces` table appears under **Table Editor**

### 3. Grab your project URL + anon key

In your dashboard go to **Settings → API**:
- Copy **Project URL** → `VITE_SUPABASE_URL`
- Copy **anon / public** key → `VITE_SUPABASE_ANON_KEY`

### 4. Configure local dev

```bash
cp .env.example .env.local
# then edit .env.local with your values
npm run dev
```

You should see the **"Cloud ready"** badge in the top-right; edits will show
**"Syncing… → Synced"**.

### 5. Configure the deployed site (GitHub Pages)

Add the same two values as **GitHub repo secrets**:

```
gh secret set VITE_SUPABASE_URL    --body "https://YOUR.supabase.co"
gh secret set VITE_SUPABASE_ANON_KEY --body "eyJhbGciOi..."
```

Push any commit to main → the Action picks them up at build time and
deploys with cloud sync enabled.

### How it works

- Each browser generates a UUID once → stored in `localStorage["pharma:workspaceId:v1"]`
- That UUID is the row key in the `workspaces` table
- Click the **workspace ID copy** button in the header to share the same
  workspace across browsers (paste the UUID into the new browser's localStorage
  under the same key)
- Every edit writes to localStorage immediately + queues a debounced (~800ms)
  upsert to Supabase
- On startup, the cloud version takes precedence over localStorage if you
  haven't started editing yet

### Security notes

The `anon` key is embedded in the public JS bundle (this is normal for any
client-only Supabase app). The default RLS policies in `schema.sql` allow
anonymous CRUD — fine for a personal demo. For multi-user production, add
Supabase Auth and tighten the RLS policies to `auth.uid() = owner_uuid`.

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
