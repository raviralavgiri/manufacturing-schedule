# API Manufacturing Schedule · FY 2026-27

🔗 **Live demo:** <https://raviralavgiri.github.io/manufacturing-schedule/>

A modern, glassmorphic React webapp that replaces an Excel-based pharmaceutical manufacturing scheduler. Given master data for **more than 20 APIs**, **100+ stages**, and **more than 20 reactors in a production block** (some shared across stages), it produces a **clash-free yearly schedule** with weekly Gantt, equipment heatmap, clash report, and a multi-granularity dashboard.

## Table of contents

- [What it does](#what-it-does)
- [Tabs](#tabs)
- [How it works](#how-it-works) ← **the algorithm, with examples**
  - [Domain model](#1-domain-model)
  - [DAG stage dependencies](#2-dag-stage-dependencies)
  - [Cascade planning](#3-cascade-planning)
  - [Topology presets](#4-topology-presets)
  - [The scheduling algorithm](#5-the-scheduling-algorithm)
  - [Quarterly distribution vs ASAP](#5a-quarterly-distribution-vs-asap--api-stages-vs-intermediates)
  - [Reactor selection — gap-packing](#6-reactor-selection--gap-packing)
  - [PCO and campaign cleaning](#7-pco-and-campaign-cleaning)
  - [FY vs Overflow classification](#8-fy-vs-overflow-classification)
  - [What happens when you edit a value](#9-what-happens-when-you-edit-a-value)
  - [Persistence layers](#10-persistence-layers)
- [Run](#run)
- [Cloud persistence with Supabase](#cloud-persistence-with-supabase-optional-free-tier)
- [Build](#build)
- [Tech stack](#tech-stack)
- [File map](#file-map)

---

## What it does

1. Generates a **clash-free schedule** using a DAG-aware equipment-availability algorithm with priority ordering, load-balanced reactor selection, and gap-packing
2. Tags each batch as **FY** or **Ovr** (overflow) relative to each API's own plan window
3. **Cascades `plannedBatches`** backwards from a per-API `targetKg` through any DAG topology — linear chains, parallel convergence, and side-chains with a multiplier factor
4. Verifies **zero reactor clashes** by construction
5. Renders a **weekly Gantt**, **reactor occupancy heatmap**, **clash report**, and **multi-granularity dashboard**
6. Lets you **edit master data** (yellow cells) and recomputes the entire schedule in ~350 ms
7. Persists user edits to **localStorage** (always) + **Supabase** (optional, free tier)
8. Exports schedule data to **Excel (.xlsx)** and allows **image/PNG snapshots** of charts
9. Supports **multiple projects** with independent APIs, reactors, and plan windows via a project switcher

---

## Tabs

| Tab | What you see |
| --- | --- |
| APIs | One row per API: name, plan window (per-API start/end), stage count, target output (kg), topology badge (linear / parallel / side-chains), reset button |
| Stages | Full editable stage template — BCF, BCT, process hours, analysis hours, PCO, batch size, input kg/batch, reactor pool, DAG predecessors |
| Master Reactors | Reactor records: name, MOC (SS / GL / Hastelloy / Halar lined), agitator type, capacity |
| Schedule | All batches with start / end / analysis dates, FY & clash flags, reactor column, Excel & CSV export |
| Gantt Chart | Weekly Gantt, color per API, faded tail = PCO/wait period. Three modes: by Stage / by API / by Reactor |
| Equipment | >20-reactor × 52-week occupancy heatmap, util bars, weekly fleet trend |
| Clash Report | Zero-clash hero + sequencer explanation + shared-reactor proof |
| Dashboard | KPI strip + time-series chart (monthly / quarterly / yearly, kg or batches) + per-API performance table + API × Stage × Q1–Q4 pivot |

---

## How it works

### Mental model: pool = fungible reactor set, not a fixed train

> **Key change from earlier architecture:** when a stage's `reactorPool` lists multiple reactors, the scheduler picks the **single earliest-free** reactor from that pool for each batch. The pool is a set of equivalent interchangeable reactors, not a production train that locks all reactors simultaneously.

This means two batches of the same stage can run on different reactors in parallel (if the reactors are free), dramatically increasing throughput compared to the old train model.

---

### 1. Domain model

There are five kinds of objects in the system:

```
┌─────────┐         ┌──────────┐ 1..*  ┌─────────────┐ 1  *  ┌────────────────────┐
│ Project │────────▶│   API    │──────▶│ StageMaster │──────▶│ BatchScheduleEntry │
│         │         │          │       │  (template)  │       │  (computed)        │
└─────────┘         └──────────┘       └─────────────┘       └────────────────────┘
  id, name           targetKg           bcfHours                startMs / endMs
  window             window             bctHours                analysisEndMs
  apis[]             topology           processHours            inFY, clash
  reactors[]         stages[]           pcoHours                reactorId
                                        inputStageIds[]         cleaningBeforeMs
                                        cascadePolicy?          cleaningType
```

**Concrete TypeScript** (`src/types.ts`):

```typescript
export interface API {
  id: string;
  name: string;
  color: string;
  targetKg: number;        // drives cascade — final stage demand
  window: PlanWindow;      // per-API plan window (start/end Ms)
  topology?: ApiTopology;  // "linear" | "parallel" | "side_chains"
  stages: StageMaster[];
}

export interface StageMaster {
  id: string;
  apiId: string;
  stageNo: number;
  stageName: string;
  batchSizeKg: number;      // output produced per batch (kg)
  inputKgPerBatch: number;  // input consumed per batch (kg) — may differ (yield ≠ 100%)
  reactorPool: string[];    // equivalent reactor ids; scheduler picks earliest-free
  bcfHours: number;         // Batch Charging Frequency — interval between same-campaign starts
  bctHours: number;         // Batch Cycle Time — slot duration (reactor locked for this long)
  processHours: number;     // active processing within slot (bctHours − processHours = leading wait)
  analysisHours: number;    // QC release time after cycle (reactor free during analysis)
  pcoHours: number;         // Product Change Over cleaning before a new campaign on this reactor
  plannedBatches: number;   // derived by cascade from targetKg
  inputStageIds: string[];  // DAG predecessors — empty = source, list = convergence or chain
  cascadePolicy?: SideChainCascadePolicy; // side-chain anchor policy
}

export interface Reactor {
  id: string;
  name: string;
  moc: MOC;                    // "SS" | "GL" | "Hastelloy" | "Halar lined"
  agitatorType: AgitatorType;  // "Anchor" | "RCI" | "PBT" | "MIG" | "Hydrofoil"
  capacityKg: number;
}
```

**Why `bcfHours`, `bctHours`, and `processHours` are separate:**

- `bctHours` is the full reactor slot — from when the reactor is claimed to when it's released.
- `processHours` is the active production time within that slot. The leading `bctHours − processHours` is a wait period (e.g. waiting for a temperature ramp on a shared utility).
- `bcfHours` is the **start-to-start interval** between consecutive batches of the same stage: batch *n* may start one BCF after batch *n−1* (`start_n = start_(n-1) + BCF`). The scheduler treats this as the primary cadence and always tries to place the next batch exactly one BCF later. For a bottleneck reactor `bcfHours ≈ bctHours`; when `bcfHours < bctHours` a single reactor can't keep up, so the pool runs consecutive batches on parallel reactors to hold the cadence.
- `analysisHours` is **off-reactor** QC: it runs in parallel after the cycle, frees the reactor for the next batch immediately, and only delays the *downstream* stage. It is **not** added to BCF.

**Why `batchSizeKg` and `inputKgPerBatch` are separate:** reactions aren't 100% yield. A crystallisation step may consume 120 kg input to produce 100 kg output (`batchSizeKg = 100, inputKgPerBatch = 120`). The cascade uses `inputKgPerBatch` to propagate demand backwards through the DAG.

---

### 2. DAG stage dependencies

Each stage declares its **predecessors** via `inputStageIds`:

```
Linear chain (legacy default):
  S1 → S2 → S3 → S4

Parallel convergence:
  A1 → A2 ─┐
             ├─▶ Merge → Final
  B1 → B2 ─┘

Side-chain (reagent sub-stream):
  S1 → S2 → S3 → S4 (main backbone)
        ↑
       S2i        (side chain feeds S2)
```

The scheduler enforces: **batch N of stage S cannot start until batch N's analysis-end on every predecessor of S has passed** (plus a 4-hour transfer buffer). This replaces the old "previous stageNo" linear assumption.

---

### 3. Cascade planning

`src/scheduler/cascade.ts → cascadePlannedBatches(api)` derives `plannedBatches` for every stage from the API's `targetKg` using a two-pass DAG traversal:

**Pass 1 — main-stage reverse-topo cascade (sinks → roots):**
```
sink(s) demand   = api.targetKg  (split equally if multiple sinks)
for each stage in reverse-topo order:
  plannedBatches = ⌈ outputDemand ÷ batchSizeKg ⌉
  actualOutput   = plannedBatches × batchSizeKg
  for each predecessor p:
    p.outputDemand += plannedBatches × inputKgPerBatch
```

**Pass 2 — side-chain forward cascade (anchors → continuations):**
```
for each side-chain anchor a (has cascadePolicy.kind === "side-chain"):
  a.outputDemand = baseStage.actualOutput × factor
  a.plannedBatches = ⌈ a.outputDemand ÷ a.batchSizeKg ⌉
  forward-propagate actual output to any continuation stages
```

Side-chain stages are identified by a fixed-point closure: a stage is in the side-chain set if it has `cascadePolicy` (anchor), or if every one of its predecessors is already in the side-chain set (continuation). Their demand is driven by the factor, not by the merge stage's input demand.

A cycle in `inputStageIds` triggers a graceful fallback to the legacy linear cascade (sorted by `stageNo`) with a console warning.

---

### 4. Topology presets

Three named topology shapes can be scaffolded onto any API via the topology editor in the APIs tab:

| Preset | Shape | Use case |
| --- | --- | --- |
| **linear** | S1 → S2 → … → SN | Standard sequential synthesis |
| **parallel** | A-chain + B-chain → Merge → post-merge tail | Convergent synthesis with two or more routes |
| **side_chains** | Main backbone + reagent sub-streams | Side-stream reagents sized by a factor of the backbone's output |

`src/utils/topologyPresets.ts → applyTopologyPresetToApi()` runs in **PRESERVE_THEN_ADD** mode: existing stage rows are kept with their custom batch sizes, reactor pools, and hour fields; only missing scaffold positions are added and all `inputStageIds` + `cascadePolicy` links are re-derived from the spec.

---

### 5. The scheduling algorithm

`src/scheduler/scheduler.ts → runScheduler(apis, reactors)` — **equipment-availability sequencer** with three nested loops:

```
flowchart TD
    Start([runScheduler])
    Sort[Sort APIs by priority P1 → P5]
    Outer[for round = 0 .. maxBatches]
    Mid[for each API in priorityOrder]
    Inner[for each Stage in topo order of DAG]
    Skip{round < stage.plannedBatches?}
    EarlyStart[earliestStart = max(all-pred-analysis-ends + 4h, API.window.startMs)]
    PCO[add pcoHours if new campaign on this reactor]
    PickReactor[pick earliest-free reactor in pool via gap-finder]
    Book[Book reactor: startMs, endMs, analysisEndMs]
    Done([Clash-free BatchScheduleEntry rows])
```

#### The three loops

| Loop | What it iterates | Why |
| --- | --- | --- |
| Outer: **round** | 0 .. (max planned batches across any stage) | Campaign style — batch #1 of every (API, stage) before any batch #2. Spreads load over the year. |
| Middle: **API in priority order** | P1 → … → P5 | High-priority APIs grab the earliest free reactor slots in each round. |
| Inner: **stage in DAG topo order** | topological order respects `inputStageIds` | Ensures predecessors are booked before successors within each round. |

#### The hard constraints

1. **No reactor clash** — each reactor's `[start, cycleEnd]` windows are non-overlapping. Each new booking is forced to start `≥ reactor.lastCycleEnd`.
2. **DAG material gate** — to start batch K of stage S, **every** predecessor must have accumulated enough *approved* output (cumulative ≥ K × `inputKgPerBatch`). "Approved" = the predecessor batch's analysis (QC) window has ended (+ 4-hour transfer buffer). One large upstream batch can feed several downstream batches.
3. **BCF cadence** — consecutive batches of the *same* stage are spaced by Batch Charging Frequency: `start_n = start_(n-1) + BCF`. This is the primary spacing rule and the scheduler **always tries to place the next batch exactly one BCF after the previous start** (it only slips later when a reactor is busy, the material gate is not yet satisfied, or a cleaning gap intervenes). When `BCF < BCT` a single reactor cannot keep the cadence, so the scheduler routes the next batch onto another free reactor in the pool to preserve the BCF rhythm.

> **BCF, BCT, and analysis are independent.** BCF is the *start-to-start* interval. BCT is how long the reactor is *locked*. `analysisHours` is **off-reactor** QC — it never locks the reactor and never gates BCF; it only delays the *downstream* stage's material gate. Setting `BCF = BCT + analysis` by mistake injects artificial idle gaps between batches; keep BCF at the true charging interval.

---

### 5a. Quarterly distribution vs ASAP — API stages vs intermediates

Not every stage is scheduled the same way. The engine classifies each stage as a **sink (API / final) stage** — one with no downstream successors in the DAG — or an **intermediate (IM) stage**, and applies a different placement policy:

| Stage type | Placement policy | Why |
| --- | --- | --- |
| **API / sink** | **Quarterly soft-cap.** Planned batches are spread roughly evenly (≈ ⌈planned / 4⌉ per quarter) across the API's four plan-window quarters. A batch is deferred to a later quarter *only* when its quarter has already taken its share — otherwise it starts as soon as the reactor frees. | Keeps every API "live" in the shared cleanroom every quarter instead of one API monopolising a quarter. Final-product output is what the plan commits to per quarter. |
| **Intermediate (IM)** | **As fast as possible**, then **auto right-aligned.** No quarterly cap. Each IM stage is automatically anchored as close to its downstream API stage as the BCF cadence allows, so its last batch's analysis finishes *just in time* to feed the API stage's first batch. | A quarterly cap on an intermediate would only create artificial idle gaps on intermediate reactors. Packing IM batches against their consumer minimises work-in-progress hold time. |

The right-align anchor for an IM stage back-propagates from its successor:

```
IM last-batch start  = successor first-batch start − BCT(IM) − analysis(IM)
IM first-batch start = IM last-batch start − (planned − 1) × BCF(IM)
```

This runs as a fixed-point pre-pass (`rightAlignStart` map in `scheduler.ts`): seed every API sink stage from its window end, then propagate the anchor upstream through every IM predecessor until stable. Right-aligned stages also opt out of the quarterly cap so it never scatters their packed batches back into earlier quarters.

---

### 6. Reactor selection — gap-packing

The pool model picks the **single earliest-free** reactor from a stage's pool, using a gap-finder that scans existing bookings to pack batches into idle windows:

```typescript
function findEarliestFreeSlot(pool: string[], earliest: number, cycleMs: number): { reactorId: string; startMs: number } {
  let best = { reactorId: pool[0], startMs: Infinity };
  for (const rid of pool) {
    const t = findGapStart(reactorBookings.get(rid)!, earliest, cycleMs);
    if (t < best.startMs) best = { reactorId: rid, startMs: t };
  }
  return best;
}
```

`findGapStart` walks the reactor's sorted booking list, skipping past any overlapping slots to find the earliest opening of length `≥ cycleMs`. This fills idle gaps between future bookings rather than always appending at the tail.

**Why gap-finding matters (real bug story):** without it, a high-priority API's late stage forced all subsequent bookings into the far future, wasting all idle time before that booking. The gap-finder more than **doubled** in-FY throughput on the same equipment.

---

### 7. PCO and campaign cleaning

When a reactor switches from one `(apiId, stageId)` campaign to a different one, a **Product Change Over (PCO)** cleaning period is inserted before the next batch starts:

```typescript
const needsPco = lastCampaign.apiId !== batch.apiId || lastCampaign.stageId !== batch.stageId;
if (needsPco) startMs += stage.pcoHours * MS_PER_HOUR;
```

Each batch records `cleaningBeforeMs` (the enforced gap) and `cleaningType` (`"none"` / `"pco"` / `"campaign"`). The Gantt chart renders this as a faded bar segment at the start of the batch's slot.

---

### 8. FY vs Overflow classification

Each API has its own `window: PlanWindow` (per-API start and end dates). A batch is `inFY` when **both** its cycle start and cycle end fall within that window:

```typescript
inFY: startMs >= api.window.startMs && endMs <= api.window.endMs,
```

The Dashboard KPI strip reports in-FY and overflow counts; the Schedule tab highlights overflow batches in amber.

---

### 9. What happens when you edit a value

When you change any yellow cell, this happens (debounced 350 ms):

```
sequenceDiagram
    User->>Stages UI: edit BCT = 96 h
    UI->>Store: setStageField(stageId, "bctHours", 96)
    Store->>Cascade: cascadePlannedBatches(api)  ← recomputes all plannedBatches
    Store->>localStorage: persist apis array
    Store->>Supabase: queueCloudSave (debounced 800 ms)
    Store->>Scheduler: scheduleRecompute (debounced 350 ms)
    Scheduler->>Scheduler: runScheduler(apis, reactors)
    Scheduler-->>Store: ScheduleResult (batches)
    Store-->>All Tabs: re-render with new schedule
```

Two debounce timers:

- **350 ms** for re-running the scheduler — coalesces rapid keystrokes
- **800 ms** for the Supabase upsert — batches multiple edits into one network call

The complete scheduler runs in **~50 ms** end-to-end on a modern laptop.

---

### 10. Persistence layers

The app has three data sources, in priority order on startup:

```
┌───────────────────────────────┐
│  1. Supabase (cloud)          │  ← if VITE_SUPABASE_URL is set AND user hasn't started
│     workspaces.apis JSONB     │     editing in this browser session
├───────────────────────────────┤
│  2. localStorage (browser)    │  ← always read on init; written on every edit
│     "pharma:apis:v1"          │
├───────────────────────────────┤
│  3. Seed (in-source code)     │  ← deterministic mulberry32 PRNG, src/data/seed.ts
│     20 APIs, 100+ stages      │
└───────────────────────────────┘
```

**Multi-project support:** each `Project` bundles APIs, reactors, and a plan window. The project switcher in the app header lets you create, rename, duplicate, and delete projects. Each project is independently persisted.

---

## Run

```bash
npm install
npm run dev
# open http://localhost:5173
```

## Cloud persistence with Supabase

Cloud sync uses Supabase free tier. Credentials are baked into the source bundle in **obfuscated form** (XOR + hex), so the deployed site is self-contained and works without GitHub Actions secrets injection.

### What ships in the bundle

- `src/config/supabaseConfig.ts` contains `ENCODED_URL` and `ENCODED_KEY` — hex blobs that are XOR-decoded at runtime against a salt that's also in the bundle.
- The decoder runs once at app startup; the resulting plain values never appear as a literal string in the source.

### ⚠️ Important: this is obfuscation, not encryption

The salt and algorithm are in the same bundle as the encoded blobs, so a determined inspector can recover the plaintext (one debugger statement is enough). The actual security boundary is **Supabase Row-Level Security** policies defined in `supabase/schema.sql`. With the publishable key, the worst anyone can do is read/write the `workspaces` table — exactly what's allowed by the schema.

### Setting up your own Supabase project (one-time)

1. Sign up at [supabase.com](https://supabase.com) — free tier, 500 MB DB, no credit card.
2. Create a new project; wait ~30 seconds for provisioning.
3. **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, click **Run**.
4. **Settings → API**, copy the **Project URL** and **anon / publishable** key.

### Bake credentials into the bundle (obfuscated)

```bash
npm run obfuscate-credentials -- \
  "https://YOUR.supabase.co" \
  "sb_publishable_YOUR_KEY"

# Paste the printed ENCODED_URL and ENCODED_KEY into
# src/config/supabaseConfig.ts (top-level export const lines).
```

Commit the change, push to main → site auto-deploys with cloud sync enabled.

### Local dev override

```bash
cp .env.example .env.development.local
# edit .env.development.local with your URL + key
npm run dev
```

> ⚠️ Don't use `.env.local` (without `.development`) — Vite reads that for **both** dev and production builds. The repo's `.gitignore` blocks both, but the naming matters for build hygiene.

Resolution order in `getSupabaseConfig()`:

1. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars (local dev)
2. Obfuscated `ENCODED_URL` / `ENCODED_KEY` from `src/config/supabaseConfig.ts` (deployed builds)
3. `null` → cloud sync disabled, app falls back to localStorage only

### Sharing a workspace across devices

Each browser generates a UUID stored in `localStorage["pharma:workspaceId:v1"]`. To use the same workspace on another device:

1. Click the **copy** icon in the Sync badge (top-right) on the source browser.
2. On the new browser, open DevTools console and run:

```javascript
localStorage.setItem("pharma:workspaceId:v1", "PASTE-UUID-HERE");
location.reload();
```

---

## Build

```bash
npm run build
npm run preview
```

CI: every push to `main` triggers `.github/workflows/deploy.yml` which builds and publishes to GitHub Pages.

To run the scheduler standalone (no UI) for sanity-checking after changes:

```bash
npx tsx scripts/verify.mjs
```

---

## Tech stack

| Package | Version | Purpose |
| --- | --- | --- |
| **React** | ^18.3.1 | UI framework |
| **TypeScript** | ^5.6.3 | Type safety across the entire codebase |
| **Vite** | ^5.4.10 | Dev server and production bundler |
| **Tailwind CSS v3** | ^3.4.14 | Custom dark / glass design system |
| **Zustand** | ^5.0.1 | Global state, debounced re-scheduler, cloud sync orchestration |
| **Recharts** | ^2.13.3 | Bar / line / treemap charts |
| **date-fns** | ^3.6.0 | Date math, FY week bucket generation |
| **lucide-react** | ^0.453.0 | Icon set |
| **exceljs** | ^4.4.0 | Excel (.xlsx) export of schedule data |
| **html-to-image** | ^1.11.13 | PNG snapshot / image export of charts and views |
| **clsx** | ^2.1.1 | Conditional CSS class name utility |
| **@supabase/supabase-js** | ^2.105.1 | Optional cloud persistence (free tier) |

**Dev dependencies:** `@vitejs/plugin-react ^4.3.3`, `autoprefixer ^10.4.20`, `postcss ^8.4.49`, `@types/react ^18.3.12`

---

## File map

```
src/
├── config/
│   └── supabaseConfig.ts         XOR-obfuscated Supabase credentials
├── data/
│   └── seed.ts                   Deterministic seed (20 APIs, 100+ stages, 20 reactors)
├── scheduler/
│   ├── scheduler.ts              Equipment-availability sequencer (Section 5 above)
│   └── cascade.ts                DAG cascade — derives plannedBatches from targetKg (Section 3)
├── services/
│   ├── supabase.ts               Client init + per-browser workspace UUID
│   └── sync.ts                   Debounced cloud upsert + initial cloud load
├── utils/
│   ├── dates.ts                  FY week buckets, hour-to-ms helpers
│   ├── storage.ts                Versioned localStorage helpers
│   ├── topologyPresets.ts        Topology spec types + applyTopologyPresetToApi()
│   ├── validation.ts             DAG cycle detection + topological sort helpers
│   ├── exporters.ts              Excel / CSV export helpers
│   ├── chartTheme.ts             Shared Recharts theme tokens
│   └── theme.ts                  Dark / light theme utilities
├── components/
│   ├── Primitives.tsx            Card, Pill, Tag, SectionHeader
│   ├── ReactorPoolEditor.tsx     Popover chip-toggle editor for reactor pools
│   ├── StageInputsEditor.tsx     DAG predecessor editor (inputStageIds)
│   ├── ParallelTopologyEditor.tsx  Spec panel for parallel convergence topologies
│   ├── SideChainsTopologyEditor.tsx  Spec panel for side-chain topologies
│   ├── ExportMenu.tsx            Dropdown for Excel / CSV / PNG export actions
│   ├── MultiSelectPopover.tsx    Reusable multi-select popover
│   ├── ProjectSwitcher.tsx       Project create / rename / duplicate / delete picker
│   ├── AddStageForm.tsx          Inline form for new stages / new APIs
│   ├── SyncBadge.tsx             Cloud-sync status (idle / syncing / synced / error)
│   ├── ThemeToggle.tsx           Dark / light theme toggle button
│   └── WelcomeGuide.tsx          First-time onboarding guide (reopenable via help button)
├── tabs/
│   ├── ApisTab.tsx               Per-API editor: name, plan window, target kg, topology
│   ├── StagesTab.tsx             Full stage template editor (BCF, BCT, process, PCO, DAG links)
│   ├── MasterReactorTab.tsx      Reactor records: MOC, agitator type, capacity
│   ├── ScheduleTab.tsx           Virtualized batch table + Excel & CSV export
│   ├── GanttTab.tsx              Weekly Gantt (3 modes) + PNG image export
│   ├── EquipmentTab.tsx          Heatmap + util bars + trend line
│   ├── ClashTab.tsx              Zero-clash hero + sequencer proof
│   └── DashboardTab.tsx          KPI strip + time-series chart + per-API table + pivot
├── store.ts                      Zustand store (state + actions + sync orchestration)
├── types.ts                      Domain types (API, StageMaster, Reactor, Project, …)
├── App.tsx                       Top-level shell, header, tab routing
└── main.tsx                      Entry point

supabase/schema.sql               One-shot DB migration
.github/workflows/deploy.yml      Build + deploy to GitHub Pages
.env.example                      Documented Supabase env vars
scripts/
├── verify.mjs                    Standalone scheduler sanity check
└── obfuscate-credentials.mjs     XOR-encode Supabase URL + key into hex blobs
```
