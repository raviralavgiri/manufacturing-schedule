# API Manufacturing Schedule

🔗 **Live app:** <https://raviralavgiri.github.io/manufacturing-schedule/>

A web app that plans a year of pharmaceutical API production. You describe your products (APIs), their process stages and your equipment. The app works out how many batches each stage needs and books every batch onto a reactor, without double-booking. It then shows the plan as tables, a Gantt chart, occupancy views and a dashboard, and exports everything to Excel.

It replaces an Excel-based scheduler. Changes are recalculated instantly, and the plan is saved in your browser, with optional cloud sync.

---

## Contents

1. [Quick start](#1-quick-start)
2. [The tabs at a glance](#2-the-tabs-at-a-glance)
3. [Key terms](#3-key-terms)
4. [Typical workflow](#4-typical-workflow)
5. [How the schedule is built](#5-how-the-schedule-is-built)
6. [Stage flows (how stages connect)](#6-stage-flows-how-stages-connect)
7. [Campaign planning by quarter](#7-campaign-planning-by-quarter)
8. [Reading the Gantt chart](#8-reading-the-gantt-chart)
9. [Dashboard](#9-dashboard)
10. [Excel import and export](#10-excel-import-and-export)
11. [Saving, projects and cloud sync](#11-saving-projects-and-cloud-sync)
12. [For developers](#12-for-developers)

---

## 1. Quick start

**Use it online:** open the [live app](https://raviralavgiri.github.io/manufacturing-schedule/). It loads with sample data (20 APIs) so you can explore straight away.

**Run it on your computer** (needs Node.js 20+):

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5173>.

Yellow cells are inputs: edit any of them and the whole schedule recalculates within half a second.

---

## 2. The tabs at a glance

| Tab | What it's for |
| --- | --- |
| **APIs** | One row per product: name, sequence (**Seq**), cleanroom/**Block**, campaigns per year (**Camp/yr**), **Q split**, plan window, number of stages, target output (kg) and **Stage Flow**. Opening a row's Stage Flow panel shows a diagram of the flow. |
| **Stages** | Every stage of every API: batch sizes, BCF, BCT, process, analysis and PCO hours, reactor pool and optional substitute reactors, and which stages feed it. |
| **Equipment** (master) | The reactor list: ID, block, class (CL cleanroom / INT intermediate), material, agitator, capacity, and preventive and building maintenance dates. |
| **No. of Batches** | How many batches each stage needs to reach the API target (the material balance). |
| **Schedule** | Every scheduled batch: reactors used, cleanroom, campaign, quarter, start / end / analysis-end dates and clash flag. |
| **Gantt Chart** | Interactive timeline. View by stage, API, reactor, production block, or cleanroom → product. |
| **Equipment** (occupancy) | Reactor-by-week occupancy heatmap and utilisation. |
| **Clash Report** | Proof that no reactor is double-booked. |
| **Dashboard** | KPIs, block occupancy (cleanroom vs intermediate), campaign plan, per-API target vs achieved, and the quarterly pivot. |
| **Q-Plan** | Quarterly view: batches per quarter, reactor load, suggestions, and the **campaign sequence** per cleanroom and quarter. |

---

## 3. Key terms

| Term | Meaning |
| --- | --- |
| **API** | A product. It has a target output (kg) and a plan window (start and end dates). |
| **Stage** | One process step of an API (e.g. Intermediate-1 → Intermediate-2 → Final API). |
| **Final stage** | The last stage, which makes the API itself (marked **API**). Other stages are intermediates (**IM**). |
| **Batch** | One run of a stage on its reactor(s). |
| **Reactor pool** | The reactors a stage's batch uses. All listed reactors are used together for each batch, like an equipment train. |
| **Substitute reactors** | Optional stand-ins for a pool reactor, tried in order when it's busy. |
| **BCF** (Batch Charging Frequency) | Time between the **starts** of two batches of the same stage: `next start = previous start + BCF`. |
| **BCT** (Batch Cycle Time) | How long one batch occupies its reactor(s). |
| **Process (h)** | The active part of the BCT. The rest of the BCT is waiting time at the start of the slot. |
| **Analysis (h)** | QC time after a batch. It doesn't block the reactor, but the next stage can't use the material until analysis is done. |
| **PCO** (Product Change Over) | Cleaning time needed before a reactor switches to a different product or stage. |
| **Campaign cleaning** | A cleaning that's forced when the same product runs continuously on a reactor for more than 34 days. |
| **Block / cleanroom** | A production block groups reactors. Reactors classed **CL** are cleanroom reactors; **INT** are intermediate reactors. |
| **Campaign** | A group of final-stage batches made together. With 4 campaigns per year, there is one campaign per quarter. |
| **FY / Ovr** | A batch inside its API's plan window is **FY**; one that spills outside is **Ovr** (overflow). |

---

## 4. Typical workflow

1. **Equipment:** list your reactors with their block, class (CL/INT) and maintenance dates.
2. **APIs:** add each product with its target kg and plan window. Choose a **Stage Flow** (Linear, Parallel, Side chains or Fork); the panel draws the flow, so you can check it before clicking **Apply**.
3. **Stages:** fill in batch sizes and BCF / BCT / process / analysis / PCO hours. Pick each stage's reactor pool and any substitute reactors.
4. *(Optional)* **Campaigns:** set **Camp/yr** on the APIs tab to plan the year in campaigns, then set the run order per cleanroom and quarter on **Q-Plan**.
5. **Check the result:** use **No. of Batches**, **Schedule**, the **Gantt Chart**, **Dashboard** and **Clash Report**.
6. **Export** to Excel to share the plan, or edit the Excel file and import it back.

---

## 5. How the schedule is built

The app recalculates everything whenever an input changes.

**Step 1: how many batches.** The app works backwards from each API's target:

- **Final stage:** `batches = target kg ÷ output per batch` (rounded up).
- **Each earlier stage:** it must supply what the next stage consumes, so `batches = next stage's total input ÷ this stage's output per batch` (rounded up).
- **Existing stock:** any existing stock entered on a stage reduces what it has to make.

**Step 2: when and where.** The app repeatedly books whichever ready batch can start earliest. A batch can start only when every rule below is met:

| Rule | What it means |
| --- | --- |
| **Material ready** | Enough output from the stages that feed it has finished analysis. |
| **BCF** | At least BCF hours after the previous batch of the same stage started. Batches of the same stage may overlap on the reactor when BCF < BCT. |
| **Reactors free** | Every reactor in the pool is free. If one is busy, its substitutes are tried in order. |
| **Cleaning** | A PCO is inserted before a reactor switches product or stage. Campaign cleaning is inserted after 34 days of the same product. |
| **Maintenance** | Preventive maintenance (every 90 days, for the set number of days) and cleanroom building maintenance (every 90 days, 2 days long) block the reactor. |
| **Plan window** | A stage never starts before its API's window start, or before its own first-batch date if one is set. |

**Tie-breakers:**
- **Equal start times:** when two batches could start at the same moment, a final-API batch goes before an intermediate (finished API is what can be dispatched), then the API with the lower **Seq** goes first.
- **Fewer changeovers:** the scheduler prefers to finish a product's run on a reactor before switching, to avoid extra PCO cleanings.

**Where final stages are placed:**
- **Default (ASAP, revenue first):** every stage runs forward from the plan-window start. Intermediates start as soon as reactors are free, and each final-API batch starts as soon as enough intermediate has cleared analysis, so finished API is ready to dispatch and invoice as early as possible. There is no left/right alignment and no per-quarter cap.
- **Campaign mode:** an API with **Camp/yr** set is planned by quarter instead (see [section 7](#7-campaign-planning-by-quarter)).

The result is clash-free by design; the **Clash Report** confirms it.

---

## 6. Stage flows (how stages connect)

Choose the flow in the **Stage Flow** column of the APIs tab. The panel shows the flow you'll get, including stage names, before you apply it.

```
Linear (default)
  S1 → S2 → S3 → S4

Parallel (two routes converge)
  A1 → A2 ─┐
            ├─▶ Merge → Final
  B1 → B2 ─┘
  Branch B's demand = merge input × factor f1 (branch A is the base).

Side chains (a reagent sub-stream)
  S1 → S2 → S3 → S4        (main backbone)
        ↑
       S2i                  (side chain feeds S2)
  The side chain is sized from S1's output × factor (e.g. 0.3).

Fork (one start, several products)
            ┌─▶ A1 → A-API
  Root ─────┤
            └─▶ B1 → B-API
  The API target is split equally across the branch ends.
```

**Before you click Apply:** existing stage names are kept in order, so check the preview and rename stages on the Stages tab if needed. You can also edit any stage's inputs directly on the Stages tab.

---

## 7. Campaign planning by quarter

Use this when products run in campaigns spread over the year, often sharing a cleanroom.

- **Camp/yr** (APIs tab): the number of campaigns per year. The final stage's batches are split evenly into that many campaigns. For example, 4 campaigns gives one per quarter, with each campaign starting in its quarter.
- **Q split** (optional): a custom spread such as `2,0,1,1` (Q1–Q4). It must add up to Camp/yr.
- **Intermediates:** in campaign mode, intermediates run as early as material and equipment allow, so they're ready in good time.
- **Campaign sequence** (Q-Plan tab): for each cleanroom and quarter, set the order APIs run in, e.g. Q3 = API3 → API2 → API4 → API1. A later API waits until the earlier ones' campaigns are booked. Blank = automatic order.
- **Never silently changed:** the app never adds or drops a campaign. Anything it can't meet is listed on the Dashboard with the reason, such as too few batches, a quarter split that doesn't add up, an overloaded cleanroom, or a stage with no reactors.

Leave **Camp/yr** blank to keep the default ASAP scheduling.

---

## 8. Reading the Gantt chart

**Views:**

| View | Rows |
| --- | --- |
| **By Stage** | API → its stages |
| **By API** | One row per API (final stage only) |
| **By Reactor** | One row per reactor |
| **By Block** | Production block → its reactors. The header shows the block's utilisation and an occupancy strip. |
| **Cleanroom · Product** | Cleanroom → product → stage |

**Bars:**
- **Solid:** processing.
- **Striped (start of bar):** waiting time inside the slot.
- **Faded tail:** analysis.
- **Red stripes before a bar:** PCO cleaning.
- **Teal stripes before a bar:** campaign cleaning.

**Interacting with it:**
- **Highlight:** hover an API chip or a bar to highlight that API everywhere. Click to keep it highlighted; click again or press **Esc** to clear.
- **Zoom:** use the Year / Quarter / Month / Week presets, the +/- buttons, or **Ctrl/⌘ + mouse wheel** (zooms around the cursor).
- **Pan:** drag empty space to move around.
- **Load strip:** under the dates, shows how busy the whole plant is each week. Hover a week for the %.
- **Today:** a red line marks today.
- **Filters:** narrow the chart by API, stage, reactor, block or type. Group headers collapse to a one-line overview.

---

## 9. Dashboard

| Panel | Shows |
| --- | --- |
| **KPIs** | Batches, output, APIs, plan span, reactors, clashes |
| **Block-wise occupancy** | Per production block, by month, quarter or year: total occupancy plus separate **Cleanroom (CL)** and **Intermediate (INT)** rows. Click a block to see each reactor. Overlapping batches are counted once. |
| **Campaign plan** | Campaigns planned vs required per quarter, each campaign's dates and status, unscheduled or off-quarter campaigns with reasons, intermediate completion vs the earliest possible, and cleanroom and equipment utilisation |
| **Intermediate shortfall flags** | Where an intermediate may not cover the planned API batches |
| **Per-API target vs achieved** | Output against target, with status |
| **Quarterly pivot** | API × stage × Q1–Q4 batches and kg |

---

## 10. Excel import and export

**Export** (header button) creates a workbook with the input sheets (re-importable) plus the Schedule, No. of Batches and Gantt sheets. **Import** reads the three input sheets back.

**API sheet** (data from row 6; columns follow the APIs tab):

| B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|
| Sl.No | API Name | Seq | Block | Camp/yr | Q split | Plan start | Plan end | Stages | Target (kg) | Stage flow |

After those come Main stages, the stage-flow details (side chains, parallel branch lengths and factors, fork shape) and **Q sequence** (`r1,r2,r3,r4`, blank = automatic).

**Stages sheet** (data from row 3, one row per stage):
API · Stage · First batch start · Existing stock · Input/Batch · Output/Batch · BCF · BCT · Analysis · PCO · Nos · **Equipment** · Process (h) · Input from stages · Type (IM/API)

The **Equipment** cell lists main reactors separated by **commas**. Each main reactor's optional substitutes follow it, separated by **slashes**, in priority order:

```
R105/R203/R118,R114,R119
→ main reactors R105, R114, R119; R203 then R118 can stand in for R105
```

**Master Equipment sheet** (data from row 3):
Sl.No · Unit · Block · Class (CL/INT) · Name (ID) · MOC · Agitator · Capacity (L) · PM first date · PM duration (days) · Building maintenance first date · Display name

**Older files:** files from earlier versions (one row per reactor, or Target kg in column F) still import.

---

## 11. Saving, projects and cloud sync

- **Automatic saving:** your work is saved in this browser automatically.
- **Projects:** use the switcher in the header to keep several independent plans (create, rename, duplicate, delete).
- **Cloud sync (optional):** uses Supabase, which lets the same plan open on several devices. The sync badge (top-right) shows its status.

**Using the same workspace on another device:**

1. Copy the workspace ID with the copy icon on the sync badge.
2. On the other browser, open the developer console and run:

   ```javascript
   localStorage.setItem("pharma:workspaceId:v1", "PASTE-ID-HERE");
   location.reload();
   ```

---

## 12. For developers

### Commands

| Purpose | Command |
| --- | --- |
| Install | `npm install` |
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Preview the build | `npm run preview` |
| Scheduler sanity check | `npx tsx scripts/verify.mjs` |
| Campaign scheduler check (4 APIs, 16 campaigns) | `npx tsx scripts/verify-campaigns.mjs` |
| Excel export → import round trip | `npx tsx scripts/verify-excel-roundtrip.mts` |

**Deploy:** every push to `main` runs `.github/workflows/deploy.yml`, which builds the app and publishes it to GitHub Pages.

### Cloud sync setup (Supabase, free tier)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/schema.sql`.
3. From **Settings → API**, copy the project URL and the publishable (anon) key.
4. Encode them into the bundle:

   ```bash
   npm run obfuscate-credentials -- "https://YOUR.supabase.co" "sb_publishable_YOUR_KEY"
   ```

   Paste the printed `ENCODED_URL` and `ENCODED_KEY` into `src/config/supabaseConfig.ts`, then push to `main`.
5. **Local development:** copy `.env.example` to `.env.development.local` and fill in the values. Don't use `.env.local`; Vite also reads it for production builds.

The credentials are obfuscated, not encrypted. The real protection is the row-level security policies in `supabase/schema.sql`.

### How data is stored

- **Browser storage:** localStorage keys `pharma:projects:v3` (all projects) and `pharma:activeProjectId:v3`.
- **Cloud:** the Supabase `workspaces` table, saved about 0.8 s after edits.
- **Startup order:** cloud (if configured) → browser storage → built-in sample data.

### Tech stack

React 18 · TypeScript 5 · Vite 5 · Tailwind CSS 3 · Zustand 5 (state) · Recharts 2 · date-fns 3 · ExcelJS 4 · html-to-image · lucide-react · Supabase JS 2.

### Where things live

```
src/
├── scheduler/
│   ├── scheduler.ts          Books every batch (rules in section 5)
│   ├── cascade.ts            Works out batches per stage from the API target
│   ├── campaigns.ts          Campaign split, quarter targets, sequence rank
│   ├── campaignReport.ts     Campaign checks + dashboard report
│   └── quarterlyOptimizer.ts Q-Plan analysis and suggestions
├── tabs/                     One file per tab (ApisTab, StagesTab, GanttTab, …)
├── components/
│   ├── StageFlowPreview.tsx         Stage-flow diagram (APIs tab)
│   ├── *TopologyEditor.tsx          Parallel / Side chains / Fork panels
│   ├── BlockOccupancyPanel.tsx      Dashboard block occupancy (CL / INT)
│   ├── CampaignPlanPanel.tsx        Dashboard campaign plan
│   ├── CampaignSequenceEditor.tsx   Q-Plan campaign sequence
│   └── …                            Editors, popovers, badges, guide
├── utils/
│   ├── topologyPresets.ts    Stage-flow presets + diagram data
│   ├── exporters.ts          Excel / CSV / PNG export
│   ├── excelImport.ts        Excel import
│   ├── excelLayout.ts        API sheet column positions (shared by both)
│   ├── storage.ts            Browser storage + data migration
│   └── …                     Dates, buckets, validation, theme
├── services/                 Supabase client + cloud sync
├── data/seed.ts              Sample data (20 APIs, 20 reactors)
├── store.ts                  App state and actions
└── types.ts                  Data types (API, Stage, Reactor, Batch, …)
scripts/                      Checks above + credential encoder
supabase/schema.sql           Cloud database setup
```
