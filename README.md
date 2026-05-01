# API Manufacturing Schedule · FY 2026-27

🔗 **Live demo:** https://raviralavgiri.github.io/manufacturing-schedule/

A modern, glassmorphic React webapp that replaces an Excel-based pharmaceutical manufacturing scheduler. Given master data for **20 APIs**, **82 stages**, and **20 reactors** (some shared across stages), it produces an **848-batch yearly schedule** with **zero reactor clashes**, weekly Gantt, equipment heatmap, clash report, and quarterly summary.

## Table of contents

- [What it does](#what-it-does)
- [Tabs](#tabs)
- [How it works](#how-it-works) ← **the algorithm, with examples**
  - [Domain model](#1-domain-model)
  - [The scheduling algorithm](#2-the-scheduling-algorithm)
  - [Worked example: scheduling API-01](#3-worked-example-scheduling-api-01)
  - [Reactor selection — load-balanced earliest-free](#4-reactor-selection--load-balanced-earliest-free)
  - [FY vs Overflow classification](#5-fy-vs-overflow-classification)
  - [What happens when you edit a value](#6-what-happens-when-you-edit-a-value)
  - [Persistence layers](#7-persistence-layers)
- [Run](#run)
- [Cloud persistence with Supabase](#cloud-persistence-with-supabase-optional-free-tier)
- [Build](#build)
- [Tech stack](#tech-stack)
- [File map](#file-map)

---

## What it does

1. Generates **848 batches** sequenced by an equipment-availability algorithm with priority-aware ordering and load-balanced reactor selection
2. Tags each batch as **FY** (Apr 2026 – Mar 2027) or **Ovr** (overflow)
3. Verifies **zero reactor clashes** by construction
4. Renders a **weekly Gantt chart**, **reactor occupancy heatmap**, **clash report**, and **quarterly summary**
5. Lets you **edit master data** (yellow cells) and recomputes the entire schedule in ~350 ms
6. Persists user edits to **localStorage** (always) + **Supabase** (optional, free tier)

## Tabs

| Tab | What you see |
|-----|--------------|
| Master Data | 82-row editable template (yellow = input, lock = derived) |
| Schedule | All 848 batches with start / end / analysis dates, FY & clash flags, CSV export |
| Gantt Chart | Weekly Apr 26 – Mar 27, color per API, faded tail = analysis window. Three modes: by Stage / by API / by Reactor |
| Equipment | 20-reactor × 52-week occupancy heatmap, util bars, weekly fleet trend |
| Clash Report | Zero-clash hero + sequencer explanation + shared-reactor proof |
| Quarterly Summary | Pivot (API × Stage × Q1–Q4 + FY total) + bar chart + treemap |

---

## How it works

This section is the deepest documentation in the repo. It explains every concept, the algorithm, and walks through one full real schedule trace.

### 1. Domain model

There are exactly four kinds of objects in the system:

```
┌────────┐ 1..*  ┌──────────────┐ 1  *  ┌──────────────────┐ uses 1..*  ┌──────────┐
│  API   │──────▶│ StageMaster   │──────▶│ BatchScheduleEntry │───────────▶│ Reactor  │
│        │       │  (template)   │       │  (computed by      │           │          │
│        │       │               │       │   scheduler)       │           │          │
└────────┘       └──────────────┘       └──────────────────┘           └──────────┘
priority         batchSizeKg            startMs / endMs                  id, class
color            cycleHours              analysisEndMs                    shared flag
                 analysisHours           inFY, clash, outputKg
                 plannedBatches          reactorId
                 reactorPool[]
```

**Concrete TypeScript** (`src/types.ts`):

```ts
export interface API {
  id: string;
  name: string;
  color: string;
  priority: 1 | 2 | 3 | 4 | 5;   // 1 = critical, 5 = lowest
  projectionKg: number;
  stages: StageMaster[];
}

export interface StageMaster {
  id: string;             // e.g. "API-03-S2"
  apiId: string;
  stageNo: number;        // 1, 2, 3, ...
  stageName: string;      // "Intermediate-2", "Final API"
  batchSizeKg: number;
  reactorPool: string[];  // ["R103", "R104", "R105", "R201"]
  cycleHours: number;     // physical reactor occupancy time
  analysisHours: number;  // QC release time AFTER cycle (reactor is free during this)
  plannedBatches: number; // ceil(targetOutputKg / batchSizeKg)  -- derived in UI
}

export interface BatchScheduleEntry {
  batchId: string; apiId: string; stageId: string; batchNo: number;
  reactorId: string;
  startMs: number;        // reactor cycle start
  endMs: number;          // reactor cycle end (reactor free after this)
  analysisEndMs: number;  // analysis window end
  inFY: boolean;          // Apr 1 2026 – Mar 31 2027
  clash: boolean;         // always false (sequencer guarantees this)
  outputKg: number;
}
```

**Why `cycle` and `analysis` are separate:** during the cycle window the reactor is physically occupied. Analysis happens off-reactor (lab). **The reactor is free as soon as cycle ends** — analysis only delays the *next stage* of the same API, not the next batch on the same reactor.

### 2. The scheduling algorithm

The full algorithm runs in `src/scheduler/scheduler.ts → runScheduler(apis, reactors)`. It's an **equipment-availability sequencer** with three nested loops:

```mermaid
flowchart TD
    Start([runScheduler])
    Sort[Sort APIs by priority<br/>P1 → P2 → P3 → P4 → P5]
    Outer[for round = 0 .. maxBatches]
    Mid[for each API in priorityOrder]
    Inner[for each Stage 1..N]
    Skip{round &lt; stage.<br/>plannedBatches?}
    EarlyStart[earliestStart = max<br/>prev-stage-analysis-end + 4h,<br/>scheduleHorizon]
    PickReactor[Scan reactorPool:<br/>pick earliest free<br/>tie-break by least loaded]
    Book[Book reactor:<br/>start, start+cycleHours<br/>analysis tail follows]
    UpdateLast[apiStageLastEnd[stage] =<br/>max prev, analysisEnd]
    Done([848 BatchScheduleEntry rows])

    Start --> Sort --> Outer --> Mid --> Inner --> Skip
    Skip -- Yes --> EarlyStart --> PickReactor --> Book --> UpdateLast --> Inner
    Skip -- No  --> Inner
    Inner -- all stages done --> Mid
    Mid -- all APIs done --> Outer
    Outer -- all rounds done --> Done
```

#### 2.1 The three loops in plain English

| Loop | What it iterates | Why |
|---|---|---|
| Outer: **round** | 0 .. (max planned batches across any stage) | Campaign style — batch #1 of every (API, stage) before any batch #2. Spreads load over the year. |
| Middle: **API in priority order** | P1 → ... → P5 | High-priority APIs grab the earliest free reactor slots in each round. |
| Inner: **stage 1..N** | within each API | Stage N+1's batches require Stage N's batch to have finished analysis (waits with a 4-hour transfer buffer). |

#### 2.2 The two hard constraints

The algorithm never violates these two rules:

1. **No reactor clash** — a reactor's `[start, cycleEnd]` windows are non-overlapping. Each new booking is forced to start `≥ max(reactor.lastCycleEnd, …)`.
2. **Stage ordering inside an API** — Stage N+1's batch B can only start after Stage N's batch B has finished its analysis window plus a 4-hour transfer buffer.

These are encoded in this single line:

```ts
const prevStageReady =
  sIdx === 0 ? HORIZON_MS                                   // Stage 1: just wait for horizon
             : apiStageLastEnd.get(api.id)![sIdx - 1] + bufferMs;  // Stage 2+: wait for prev
const earliestStart = Math.max(prevStageReady, HORIZON_MS);
```

`apiStageLastEnd` is a per-API array tracking the max analysis-end so far at each stage index. After every batch is booked, `apiStageLastEnd[stageIdx] = max(apiStageLastEnd[stageIdx], analysisEnd)` so the next stage knows when it can start.

#### 2.3 Helper functions used inside the loop

The algorithm calls a handful of pure helpers from `src/utils/dates.ts`:

```ts
// Convert hours to milliseconds (scheduler works in epoch ms throughout).
export function hoursToMs(h: number): number {
  return Math.round(h * 3600 * 1000);
}

// Returns true if the timestamp falls within FY 2026-27 (Apr 1 2026 – Mar 31 2027).
// Used to set the `inFY` flag on each booked batch so the UI can show "Ovr" badges.
export function isInFY(ms: number): boolean {
  return ms >= FY_START.getTime() && ms <= FY_END.getTime();
}

// Maps a timestamp to a 0..51 week index aligned to FY start.
// Used to bucket batches into the heatmap's 52-column timeline.
export function weekIndexOf(ms: number): number {
  const diffMs = new Date(ms).getTime() - FY_WEEKS[0].start.getTime();
  if (diffMs < 0) return -1;
  const idx = Math.floor(diffMs / (7 * 24 * 3600 * 1000));
  return idx >= WEEKS_IN_FY ? -1 : idx;
}
```

`FY_WEEKS` is a pre-built array of 52 entries (one per ISO week between Apr 1 2026 and Mar 31 2027) used by the UI for Gantt headers, heatmap columns, and quarterly grouping.

### 3. Worked example: scheduling API-01

API-01 is **P1 priority**, has 4 stages, and lives in this seed (deterministic):

| Stage | Batch Size | Cycle | Analysis | Reactor Pool | Planned Batches |
|---|---|---|---|---|---|
| **S1** Intermediate-1 | 54 kg | 138 h | 70 h | R101..R108 | 11 |
| **S2** Intermediate-2 | 71 kg | 192 h | 84 h | R103..R108, R201, R202 | 11 |
| **S3** Intermediate-3 | 69 kg | 168 h | 60 h | R107, R108, R201..R206 | 11 |
| **S4** Final API     | 163 kg | 264 h | 96 h | R301..R306 | 11 |

The horizon is **Apr 1 2026 08:00**. Below is what the scheduler does for the **first 3 rounds** (showing only API-01's bookings; in reality API-02..API-20 are interleaved between API-01's rounds):

#### Round 0 (each stage's batch #1)

| # | Stage | earliestStart | Pool scan results | Picked | Books cycle |
|---|---|---|---|---|---|
| 1 | S1·b1 | Apr 1 08:00 | R101..R108 all empty → Apr 1 08:00 | **R101** (lowest load score in tie) | Apr 1 08:00 → Apr 6 18:00 (138 h) |
| 2 | S2·b1 | S1 analysis end + 4 h = `Apr 9 16:00 + 4 h = Apr 9 20:00` | R103..R108, R201, R202 all empty | **R103** | Apr 9 20:00 → Apr 17 20:00 (192 h) |
| 3 | S3·b1 | S2 analysis end + 4 h = `Apr 21 08:00 + 4 h = Apr 21 12:00` | R107..R206 empty | **R107** | Apr 21 12:00 → Apr 28 12:00 (168 h) |
| 4 | S4·b1 | S3 analysis end + 4 h = `Apr 30 24:00 + 4 h = May 1 04:00` | R301..R306 empty | **R301** | May 1 04:00 → May 12 04:00 (264 h) |

After round 0 of API-01, the loop moves to **API-02 round 0**, then API-03, … API-20, then back to **API-01 round 1**. Hence by the time API-01 starts batch #2 of S1, R101 is already busy (with API-01's b1 cycle).

#### Round 1 (each stage's batch #2)

| # | Stage | earliestStart | Pool scan | Picked | Why |
|---|---|---|---|---|---|
| 5 | S1·b2 | Apr 1 08:00 (no prev-stage gate; round-0 of all APIs has occupied many R10x reactors) | R101 busy until Apr 6 18:00, R102 busy till …, R104 (less loaded) free Apr 1 08:00 | **R104** | Load-balanced — picks the least-used reactor among the equally-free ones |
| 6 | S2·b2 | S1·b2 analysis end + 4 h | mostly free Mediums | **R204** | R204 was barely used in round 0 |
| 7 | S3·b2 | … | … | **R203** | Same load-balancing rationale |
| 8 | S4·b2 | … | R301 still busy until May 12; R302..R306 free | **R302** | Earliest free among Larges |

This is where the **load-balanced tie-break** matters most. Without it, API-01 would book R101 → R101 → R101 …; with it, the same API uses R101 → R104 → R102 → R105 → … rotating through its pool.

By round 10 (b11 of every stage), all 11 batches of every stage of API-01 have been placed across roughly 6–8 different reactors per pool — visible in the **Gantt "By Reactor" mode** as a multi-color row pattern.

### 4. Reactor selection — load-balanced earliest-free

This is the most important per-batch decision. Inside the inner loop:

```ts
let bestReactor: string | null = null;
let bestStart = Infinity;
let bestScore = Infinity;

stage.reactorPool.forEach((rid, poolIdx) => {
  const slots = reactorBookings.get(rid)!;
  const lastEnd = slots.length === 0 ? HORIZON_MS : slots[slots.length - 1].cycleEndMs;
  const candidateStart = Math.max(lastEnd, earliestStart);
  const score = loadScore(
    reactorLoadHours.get(rid) ?? 0,
    reactorBatchCount.get(rid) ?? 0,
    poolIdx
  );

  // Primary: earliest possible start time
  if (candidateStart < bestStart) {
    bestStart = candidateStart;
    bestReactor = rid;
    bestScore = score;
    return;
  }
  // Tied on start: prefer the lower load score
  if (candidateStart === bestStart && score < bestScore) {
    bestReactor = rid;
    bestScore = score;
  }
});
```

`loadScore` is a deterministic three-key tie-breaker:

```ts
function loadScore(busyHours: number, batchCount: number, poolIdx: number) {
  return busyHours * 1000 + batchCount * 0.001 + poolIdx * 0.000001;
  //     ^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^
  //     primary           secondary            tertiary (deterministic)
}
```

Why this matters: a stage's reactor pool isn't 4 equivalent options where one absorbs all batches — it's a **set of equivalent units that should all carry the load**. Without the tie-breaker the `for...of` loop always picked array-index 0 (R101 absorbing 86 batches while R204 only ran 6). With the tie-breaker:

| Reactor | Without load-balancing | With load-balancing |
|---|---|---|
| R101 | 86 | 68 |
| R102 | 86 | 65 |
| R204 | **6** | **36** |
| R205 | **8** | **36** |
| R206 | **15** | **36** |
| **Spread (max−min)** | **80** | **37** |

### 5. FY vs Overflow classification

After every booking we tag `inFY`:

```ts
inFY: isInFY(startMs) && isInFY(cycleEndMs),
```

So a batch is in-FY only if **both** its cycle start and cycle end fall inside Apr 1 2026 – Mar 31 2027. If a batch starts March 28 2027 with a 14-day cycle, it **straddles** FY boundary → flagged `Ovr`. The Schedule tab shows these in amber and the global KPIs report `In FY: 645 / Overflow: 203`.

### 6. What happens when you edit a value

When you change any yellow cell, this happens (debounced 350 ms):

```mermaid
sequenceDiagram
    User->>Master Data UI: edit Output Target = 1500
    UI->>Store: setStageOutput(stageId, 1500)
    Store->>Store: plannedBatches = ceil(1500 / batchSize)
    Store->>localStorage: persist apis array
    Store->>Supabase: queueCloudSave (debounced 800ms)
    Store->>Scheduler: scheduleRecompute (debounced 350ms)
    Scheduler->>Scheduler: runScheduler(apis, reactors)
    Scheduler-->>Store: ScheduleResult (848 batches)
    Store-->>All Tabs: re-render with new schedule
```

Two debounce timers:
- **350 ms** for re-running the scheduler — coalesces rapid keystrokes during a number edit
- **800 ms** for the Supabase upsert — batches multiple edits into one network call

The complete scheduler runs in **~50 ms** end-to-end on a modern laptop, so 350 ms is plenty.

### 7. Persistence layers

The app has three data sources, in priority order on startup:

```
┌───────────────────────────────┐
│  1. Supabase (cloud)          │  ← if VITE_SUPABASE_URL is set, AND user has not started
│     workspaces.apis JSONB     │     editing in this browser session
├───────────────────────────────┤
│  2. localStorage (browser)    │  ← always read on init; written on every edit
│     "pharma:apis:v1"          │
├───────────────────────────────┤
│  3. Seed (in-source code)     │  ← deterministic mulberry32 PRNG, src/data/seed.ts
│     20 APIs, 82 stages        │
└───────────────────────────────┘
```

**Hydration order** (`src/store.ts`):

1. Read `localStorage["pharma:apis:v1"]` — if found, hydrate immediately so first paint is fast.
2. If Supabase is configured, async-fetch the cloud row. If it differs and the user hasn't started editing yet, swap state.
3. If both are empty, fall back to the deterministic seed.

**Write order on every mutation:**

1. Update React state (sub-millisecond)
2. Write `localStorage` (synchronous, instant)
3. Queue debounced Supabase upsert (~800 ms)
4. Schedule recompute (~350 ms debounce, then re-run scheduler)

---

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

```bash
gh secret set VITE_SUPABASE_URL    --body "https://YOUR.supabase.co"
gh secret set VITE_SUPABASE_ANON_KEY --body "eyJhbGciOi..."
```

Push any commit to main → the Action picks them up at build time and
deploys with cloud sync enabled.

### Sharing a workspace across devices

Each browser generates a UUID stored in `localStorage["pharma:workspaceId:v1"]`. To use the same workspace on another device:

1. Click the **copy** icon in the Sync badge (top-right) on the source browser
2. On the new browser, open DevTools console and run:
   ```js
   localStorage.setItem("pharma:workspaceId:v1", "PASTE-UUID-HERE");
   location.reload();
   ```

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

CI: every push to `main` triggers `.github/workflows/deploy.yml` which builds and publishes to GitHub Pages.

## Tech stack

- **Vite + React 18 + TypeScript**
- **Tailwind CSS v3** (custom dark / glass design system)
- **Zustand** (state, debounced re-scheduler, cloud sync)
- **Recharts** (bar / line / treemap)
- **date-fns** (date math, FY week buckets)
- **lucide-react** (icons)
- **@supabase/supabase-js** (optional cloud persistence)

## File map

```
src/
├── data/
│   └── seed.ts                 Deterministic seed (20 APIs, 82 stages, 20 reactors)
├── scheduler/
│   └── scheduler.ts            Equipment-availability sequencer (Section 2 above)
├── services/
│   ├── supabase.ts             Client init + per-browser workspace UUID
│   └── sync.ts                 Debounced cloud upsert + initial cloud load
├── utils/
│   ├── dates.ts                FY week buckets, hour-to-ms helpers
│   └── storage.ts              Versioned localStorage helpers
├── components/
│   ├── Primitives.tsx          Card, Pill, Tag, SectionHeader
│   ├── PriorityPill.tsx        P1..P5 dropdown badge
│   ├── ReactorPoolEditor.tsx   Popover chip-toggle editor
│   ├── AddStageForm.tsx        Inline form for new stages / new APIs
│   └── SyncBadge.tsx           Cloud-sync status (idle / syncing / synced / error)
├── tabs/
│   ├── MasterDataTab.tsx       Editable template
│   ├── ScheduleTab.tsx         Virtualized 848-row table + CSV export
│   ├── GanttTab.tsx            Weekly Gantt (3 modes)
│   ├── EquipmentTab.tsx        Heatmap + util bars + trend line
│   ├── ClashTab.tsx            Zero-clash hero + sequencer proof
│   └── QuarterlyTab.tsx        Pivot + bar chart + treemap
├── store.ts                    Zustand store (state + actions + sync orchestration)
├── types.ts                    Domain types (API, StageMaster, Reactor, ...)
├── App.tsx                     Top-level shell, header, tab routing
└── main.tsx                    Entry

supabase/schema.sql             One-shot DB migration
.github/workflows/deploy.yml    Build + deploy to GitHub Pages
.env.example                    Documented Supabase env vars
scripts/verify.mjs              Standalone scheduler sanity check (run with: npx tsx scripts/verify.mjs)
```

To run the scheduler standalone (no UI) for sanity-checking after changes:

```bash
npx tsx scripts/verify.mjs
# Output:
#   APIs        : 20
#   Total stages: 82
#   Reactors    : 20
#   Planned bts : 848
#   Scheduled   : 848
#   In FY       : 645
#   Overflow    : 203
#   Clashes     : 0
```
