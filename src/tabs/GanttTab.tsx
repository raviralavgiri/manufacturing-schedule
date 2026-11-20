import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Layers,
  ChevronDown,
  ChevronRight,
  Beaker,
  FlaskConical,
  Filter,
  Activity,
  Tags,
  Building2,
  Factory,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import MultiSelectPopover, {
  ClearFiltersButton,
  type Option as MsOption,
} from "../components/MultiSelectPopover";
import { buildStageKindMap } from "../utils/stageKind";
import {
  buildReactorBlockMap,
  makeApiBlockComparator,
} from "../utils/apiOrder";
import { computeWeeks, fmtDateTime } from "../utils/dates";
import type { BatchScheduleEntry, Reactor } from "../types";

type Mode = "by-api" | "by-stage" | "by-reactor" | "by-block" | "by-cleanroom";

/** Modes rendered from the unified grouped-row model (`groupRows`). */
const GROUPED_MODES: ReadonlySet<Mode> = new Set<Mode>(["by-block", "by-cleanroom"]);
const NO_BLOCK = "(no block)";
const GROUP_ROW_H = 30;

/** One line of a grouped Gantt: a collapsible group header or a bar row.
 *  The label rail and the timeline body both render from the same list, so
 *  they can never drift out of vertical alignment. */
type GanttLine =
  | {
      kind: "group";
      key: string;
      depth: number;
      label: string;
      sub?: string;
      color?: string;
      /** All batches under the group — drawn as a summary strip. */
      batches: BatchScheduleEntry[];
      collapsed: boolean;
    }
  | {
      kind: "row";
      key: string;
      depth: number;
      label: string;
      sub?: string;
      color?: string;
      batches: BatchScheduleEntry[];
    };

const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Merge [start,end) spans so a summary strip draws one div per busy span. */
function mergeSpans(batches: BatchScheduleEntry[]): [number, number][] {
  const iv = batches
    .map((b) => [b.startMs, b.endMs] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Busy fraction of `reactorCount` reactors over [ws, we), from the batches
 *  on those reactors (per-reactor merged so overlaps are not double counted). */
function utilisation(
  batches: BatchScheduleEntry[],
  reactorIds: string[],
  ws: number,
  we: number
): number {
  if (reactorIds.length === 0 || we <= ws) return 0;
  let busy = 0;
  for (const rid of reactorIds) {
    const mine = batches.filter((b) => b.reactorIds.includes(rid));
    for (const [a, b] of mergeSpans(mine))
      busy += Math.max(0, Math.min(b, we) - Math.max(a, ws));
  }
  return busy / (reactorIds.length * (we - ws));
}

export default function GanttTab() {
  const apisRaw = useStore((s) => s.apis);
  const reactors = useStore((s) => s.reactors);
  const schedule = useStore((s) => s.schedule);

  // DAG row ordering: group by production block (A→Z, natural sort), then A→Z
  // by API name. Block comes from api.block, falling back to the production
  // block of the API's final-stage reactor (Equipment tab).
  const apis = useMemo(() => {
    const reactorBlockById = buildReactorBlockMap(reactors);
    return [...apisRaw].sort(makeApiBlockComparator(reactorBlockById));
  }, [apisRaw, reactors]);

  // Live lookup: apiId → current color. Bars consult this instead of the
  // possibly-stale apiColor baked into the schedule when it was last computed.
  // Guarantees bar color always reflects the current api state.
  const apiColorById = useMemo(() => {
    const m = new Map<string, string>();
    apisRaw.forEach((a) => m.set(a.id, a.color));
    return m;
  }, [apisRaw]);

  // Stage-level (process,bct) lookup. Used by the per-batch renderer to
  // split each slot into a leading WAIT portion (bct − process) and a
  // trailing PROCESS portion. processHours defaults to bctHours when the
  // stage doesn't carry the field (legacy data).
  const stageSlotByStageId = useMemo(() => {
    const m = new Map<string, { processHours: number; bctHours: number }>();
    apisRaw.forEach((a) =>
      a.stages.forEach((s) =>
        m.set(s.id, {
          processHours: s.processHours ?? s.bctHours,
          bctHours: s.bctHours,
        })
      )
    );
    return m;
  }, [apisRaw]);
  // Sink stages per API = stages no other stage consumes (final product
  // stages). In By-API mode we render ONLY these so each API row shows its
  // finished-product timeline, not every intermediate stage stacked together.
  const sinkStageIds = useMemo(() => {
    const sinks = new Set<string>();
    apisRaw.forEach((a) => {
      const consumed = new Set<string>();
      a.stages.forEach((s) =>
        (s.inputStageIds ?? []).forEach((id) => consumed.add(id))
      );
      a.stages.forEach((s) => {
        if (!consumed.has(s.id)) sinks.add(s.id);
      });
    });
    return sinks;
  }, [apisRaw]);

  // apiId → label of its final stage(s), shown in the By-API rail.
  const sinkLabelByApiId = useMemo(() => {
    const m = new Map<string, string>();
    apisRaw.forEach((a) => {
      const consumed = new Set<string>();
      a.stages.forEach((s) =>
        (s.inputStageIds ?? []).forEach((id) => consumed.add(id))
      );
      const sinks = [...a.stages]
        .sort((x, y) => x.stageNo - y.stageNo)
        .filter((s) => !consumed.has(s.id));
      if (sinks.length === 1) {
        m.set(a.id, `S${sinks[0].stageNo} · ${sinks[0].stageName}`);
      } else if (sinks.length > 1) {
        m.set(a.id, `${sinks.length} final stages`);
      }
    });
    return m;
  }, [apisRaw]);

  const [pxPerWeek, setPxPerWeek] = useState(64); // default = "Quarter view": ~13 weeks visible per ~830px
  const [mode, setMode] = useState<Mode>("by-stage");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Ref to the Gantt card so we can snapshot it as PNG
  const chartCardRef = useRef<HTMLDivElement>(null);

  // ─ Interactive highlighting ───────────────────────────────────────────
  // Hover a bar / API chip to highlight that API everywhere; click to pin
  // the highlight (click again or Esc to clear). Other APIs fade back.
  const [hoverApi, setHoverApi] = useState<string | null>(null);
  const [focusApi, setFocusApi] = useState<string | null>(null);
  const activeApi = hoverApi ?? focusApi;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocusApi(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ─ Ctrl/⌘ + wheel zoom (anchored at the cursor) and drag-to-pan ───────
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ weeks: number; offsetX: number } | null>(null);
  const RAIL_W = 200;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      setPxPerWeek((px) => {
        const next = Math.round(
          Math.min(240, Math.max(24, px * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
        );
        zoomAnchor.current = {
          weeks: (el.scrollLeft + offsetX - RAIL_W) / px,
          offsetX,
        };
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = zoomAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = Math.max(0, a.weeks * pxPerWeek + RAIL_W - a.offsetX);
    zoomAnchor.current = null;
  }, [pxPerWeek]);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPanStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-bar],button,input,select,a")) return;
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const el = scrollRef.current;
      const d = drag.current;
      if (!el || !d) return;
      el.scrollLeft = d.left - (e.clientX - d.x);
      el.scrollTop = d.top - (e.clientY - d.y);
    };
    const up = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging]);

  // Filter state - empty Set means "all" (no filter)
  const [apiFilter, setApiFilter] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());
  const [reactorFilter, setReactorFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [blockFilter, setBlockFilter] = useState<Set<string>>(new Set());
  const anyFilterActive =
    apiFilter.size > 0 ||
    stageFilter.size > 0 ||
    reactorFilter.size > 0 ||
    typeFilter.size > 0 ||
    blockFilter.size > 0;

  // reactorId → production block ("(no block)" when unset).
  const blockOfReactor = useMemo(
    () =>
      new Map(reactors.map((r) => [r.id, r.productionBlock?.trim() || NO_BLOCK])),
    [reactors]
  );

  // stageId → IM/API classification (smart-defaulted).
  const stageKindById = useMemo(() => buildStageKindMap(apisRaw), [apisRaw]);

  // Apply filters to the source batch list once
  const filteredBatches = useMemo(() => {
    if (!anyFilterActive) return schedule.batches;
    return schedule.batches.filter((b) => {
      if (apiFilter.size > 0 && !apiFilter.has(b.apiId)) return false;
      if (stageFilter.size > 0 && !stageFilter.has(b.stageId)) return false;
      if (
        reactorFilter.size > 0 &&
        !b.reactorIds.some((rid) => reactorFilter.has(rid))
      )
        return false;
      if (
        typeFilter.size > 0 &&
        !typeFilter.has(stageKindById.get(b.stageId) ?? "")
      )
        return false;
      if (
        blockFilter.size > 0 &&
        !b.reactorIds.some((rid) => blockFilter.has(blockOfReactor.get(rid) ?? NO_BLOCK))
      )
        return false;
      return true;
    });
  }, [
    schedule.batches,
    apiFilter,
    stageFilter,
    reactorFilter,
    typeFilter,
    blockFilter,
    blockOfReactor,
    stageKindById,
    anyFilterActive,
  ]);

  const blockOptions: MsOption[] = useMemo(() => {
    const names = Array.from(new Set(blockOfReactor.values())).sort(natural);
    return names.map((n) => {
      const rs = reactors.filter((r) => blockOfReactor.get(r.id) === n);
      const cl = rs.filter((r) => r.reactorClass === "CL").length;
      return {
        value: n,
        label: n,
        secondary: `${rs.length} reactor${rs.length === 1 ? "" : "s"}${cl ? ` · ${cl} CL` : ""}`,
      };
    });
  }, [blockOfReactor, reactors]);

  // Build filter option lists
  const apiOptions: MsOption[] = useMemo(
    () =>
      apis.map((a) => ({
        value: a.id,
        label: a.name === a.id ? a.id : a.name,
        color: a.color,
        secondary: undefined,
      })),
    [apis]
  );

  const stageOptions: MsOption[] = useMemo(() => {
    const opts: MsOption[] = [];
    apis.forEach((a) =>
      [...a.stages]
        .sort((x, y) => x.stageNo - y.stageNo)
        .forEach((s) =>
          opts.push({
            value: s.id,            // stageId — unique UUID, avoids name collisions
            label: `S${s.stageNo} · ${s.stageName}`,
            secondary: a.name,      // which API this stage belongs to
            group: a.name,          // visually group by API in the dropdown
            color: a.color,
          })
        )
    );
    return opts;
  }, [apis]);

  const reactorOptions: MsOption[] = useMemo(
    () =>
      reactors.map((r) => ({
        value: r.id,
        label: r.name,
        group: r.moc,
        secondary: undefined,
      })),
    [reactors]
  );

  const typeOptions: MsOption[] = useMemo(
    () => [
      { value: "IM", label: "IM · Intermediate" },
      { value: "API", label: "API · Final product" },
    ],
    []
  );

  // Group batches by the active mode. In by-reactor mode each batch appears
  // on its assigned reactor's row (pool model — one reactor per batch).
  // Uses filteredBatches so the user's filter selections affect what's drawn.
  const grouped = useMemo(() => {
    const map = new Map<string, BatchScheduleEntry[]>();
    filteredBatches.forEach((b) => {
      if (mode === "by-reactor") {
        b.reactorIds.forEach((rid) => {
          // If reactor filter is active, only fan-out into selected reactors
          if (reactorFilter.size > 0 && !reactorFilter.has(rid)) return;
          if (!map.has(rid)) map.set(rid, []);
          map.get(rid)!.push(b);
        });
        return;
      }
      if (mode === "by-api") {
        // Final-stage only: skip intermediate stages so each API row shows
        // its finished-product timeline.
        if (!sinkStageIds.has(b.stageId)) return;
        if (!map.has(b.apiId)) map.set(b.apiId, []);
        map.get(b.apiId)!.push(b);
        return;
      }
      const key = `${b.apiId}__S${b.stageNo}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    });
    return map;
  }, [filteredBatches, mode, reactorFilter, sinkStageIds]);

  // Build row list
  const rows = useMemo(() => {
    const out: {
      key: string;
      apiId?: string;
      reactorId?: string;
      label: string;
      stageNo?: number;
      color: string;
      moc?: Reactor["moc"];
    }[] = [];

    if (GROUPED_MODES.has(mode)) return out;

    if (mode === "by-reactor") {
      reactors.forEach((r) => {
        out.push({
          key: r.id,
          reactorId: r.id,
          label: r.name,
          color: classColor(r.moc),
          moc: r.moc,
        });
      });
      return out;
    }

    apis.forEach((a) => {
      if (mode === "by-api") {
        out.push({ key: a.id, apiId: a.id, label: a.id, color: a.color });
      } else {
        a.stages.forEach((s) => {
          out.push({
            key: `${a.id}__S${s.stageNo}`,
            apiId: a.id,
            label: `${a.id} · S${s.stageNo}`,
            stageNo: s.stageNo,
            color: a.color,
          });
        });
      }
    });
    return out;
  }, [apis, reactors, mode]);

  // Timeline range = global plan window from the store
  const planWindow = useStore((s) => s.window);
  const weeks = useMemo(
    () => computeWeeks(planWindow.startMs, planWindow.endMs),
    [planWindow]
  );
  const fyStartMs = weeks.length > 0 ? weeks[0].startMs : Date.now();
  const totalWeeks = weeks.length;
  const rowH =
    mode === "by-api" ? 40 : mode === "by-reactor" || GROUPED_MODES.has(mode) ? 30 : 28;
  const isGrouped = GROUPED_MODES.has(mode);

  // For collapse: by API
  const apiCollapsed = (apiId: string) => collapsed.has(apiId);
  const toggleApi = (apiId: string) => {
    const c = new Set(collapsed);
    if (c.has(apiId)) c.delete(apiId);
    else c.add(apiId);
    setCollapsed(c);
  };

  // Filter rows according to:
  //   1. Collapsed APIs (only in by-stage mode)
  //   2. Active filters - hide any row that has no batches after filtering
  const visibleRows = useMemo(() => {
    let result = rows;
    if (mode === "by-stage") {
      result = result.filter((r) => !r.apiId || !apiCollapsed(r.apiId));
    }
    if (anyFilterActive) {
      // Hide empty rows when filters are active so the Gantt is dense
      result = result.filter((r) => (grouped.get(r.key)?.length ?? 0) > 0);
    }
    return result;
  }, [rows, mode, collapsed, anyFilterActive, grouped]);

  // ─ Grouped modes ────────────────────────────────────────────────────────
  //   by-block      Production block ▸ reactor rows
  //   by-cleanroom  Cleanroom ▸ product (API) ▸ stage rows
  // A cleanroom is a production block holding Cleanroom (class "CL")
  // reactors; when no reactor is classed CL every block is treated as one.
  const hasClReactors = reactors.some((r) => r.reactorClass === "CL");
  const groupRows = useMemo<GanttLine[]>(() => {
    if (!isGrouped) return [];
    const out: GanttLine[] = [];
    const ws = planWindow.startMs;
    const we = planWindow.endMs;
    const hideEmpty = anyFilterActive;

    // Batches per reactor (reactor filter narrows the fan-out, as By Reactor).
    const byReactor = new Map<string, BatchScheduleEntry[]>();
    filteredBatches.forEach((b) =>
      b.reactorIds.forEach((rid) => {
        if (reactorFilter.size > 0 && !reactorFilter.has(rid)) return;
        const arr = byReactor.get(rid);
        if (arr) arr.push(b);
        else byReactor.set(rid, [b]);
      })
    );
    const pool =
      mode === "by-cleanroom" && hasClReactors
        ? reactors.filter((r) => r.reactorClass === "CL")
        : reactors;
    const blocks = new Map<string, Reactor[]>();
    pool.forEach((r) => {
      const n = blockOfReactor.get(r.id) ?? NO_BLOCK;
      if (blockFilter.size > 0 && !blockFilter.has(n)) return;
      const arr = blocks.get(n);
      if (arr) arr.push(r);
      else blocks.set(n, [r]);
    });
    const blockNames = Array.from(blocks.keys()).sort((a, b) =>
      a === NO_BLOCK ? 1 : b === NO_BLOCK ? -1 : natural(a, b)
    );
    const apiIndex = new Map(apis.map((a, i) => [a.id, i]));

    for (const name of blockNames) {
      const rs = [...blocks.get(name)!].sort((a, b) => natural(a.name, b.name));
      const ids = rs.map((r) => r.id);
      const seen = new Set<string>();
      const groupBatches: BatchScheduleEntry[] = [];
      ids.forEach((rid) =>
        (byReactor.get(rid) ?? []).forEach((b) => {
          // batchId repeats across APIs (e.g. "FinalAPI#001"), so de-dupe a
          // multi-reactor train batch on API + stage + batch number.
          const k = `${b.apiId}|${b.stageId}|${b.batchNo}`;
          if (seen.has(k)) return;
          seen.add(k);
          groupBatches.push(b);
        })
      );
      if (hideEmpty && groupBatches.length === 0) continue;
      const apiCount = new Set(groupBatches.map((b) => b.apiId)).size;
      const util = utilisation(groupBatches, ids, ws, we);
      const gKey = `${mode}:${name}`;
      const isCollapsed = collapsed.has(gKey);
      out.push({
        kind: "group",
        key: gKey,
        depth: 0,
        label: name,
        sub: `${rs.length} reactor${rs.length === 1 ? "" : "s"} · ${apiCount} API${apiCount === 1 ? "" : "s"} · ${Math.round(util * 100)}%`,
        batches: groupBatches,
        collapsed: isCollapsed,
      });
      if (isCollapsed) continue;

      if (mode === "by-block") {
        for (const r of rs) {
          const bs = byReactor.get(r.id) ?? [];
          if (hideEmpty && bs.length === 0) continue;
          out.push({
            kind: "row",
            key: `${gKey}:${r.id}`,
            depth: 1,
            label: r.name,
            sub: `${r.reactorClass ?? ""} ${r.moc}`.trim(),
            color: classColor(r.moc),
            batches: bs,
          });
        }
        continue;
      }

      // by-cleanroom: product (API) ▸ stage
      const byApi = new Map<string, BatchScheduleEntry[]>();
      groupBatches.forEach((b) => {
        const arr = byApi.get(b.apiId);
        if (arr) arr.push(b);
        else byApi.set(b.apiId, [b]);
      });
      const apiIds = Array.from(byApi.keys()).sort(
        (a, b) => (apiIndex.get(a) ?? 0) - (apiIndex.get(b) ?? 0)
      );
      for (const apiId of apiIds) {
        const bs = byApi.get(apiId)!;
        const api = apis.find((a) => a.id === apiId);
        const color = apiColorById.get(apiId) ?? bs[0].apiColor;
        const pKey = `${gKey}:${apiId}`;
        const pCollapsed = collapsed.has(pKey);
        const byStage = new Map<string, BatchScheduleEntry[]>();
        bs.forEach((b) => {
          const arr = byStage.get(b.stageId);
          if (arr) arr.push(b);
          else byStage.set(b.stageId, [b]);
        });
        out.push({
          kind: "group",
          key: pKey,
          depth: 1,
          label: api?.name ?? bs[0].apiName,
          sub: `${bs.length} batch${bs.length === 1 ? "" : "es"} · ${byStage.size} stage${byStage.size === 1 ? "" : "s"}`,
          color,
          batches: bs,
          collapsed: pCollapsed,
        });
        if (pCollapsed) continue;
        const stageEntries = Array.from(byStage.entries()).sort(
          (x, y) => x[1][0].stageNo - y[1][0].stageNo
        );
        for (const [stageId, sbs] of stageEntries) {
          const used = Array.from(
            new Set(sbs.flatMap((b) => b.reactorIds).filter((id) => ids.includes(id)))
          )
            .map((id) => reactors.find((r) => r.id === id)?.name ?? id)
            .sort(natural);
          out.push({
            kind: "row",
            key: `${pKey}:${stageId}`,
            depth: 2,
            label: `S${sbs[0].stageNo} · ${sbs[0].stageName}`,
            sub: used.join(" + "),
            color,
            batches: sbs,
          });
        }
      }
    }
    return out;
  }, [
    isGrouped,
    mode,
    filteredBatches,
    reactorFilter,
    blockFilter,
    reactors,
    hasClReactors,
    blockOfReactor,
    apis,
    apiColorById,
    collapsed,
    anyFilterActive,
    planWindow,
  ]);

  const groupKeys = useMemo(() => {
    // Every collapsible key for the current mode, independent of the
    // current collapse state (so "collapse all" also catches nested groups).
    if (!isGrouped) return [] as string[];
    const keys: string[] = [];
    const names = new Set<string>();
    reactors.forEach((r) => {
      if (mode === "by-cleanroom" && hasClReactors && r.reactorClass !== "CL") return;
      names.add(blockOfReactor.get(r.id) ?? NO_BLOCK);
    });
    names.forEach((n) => {
      keys.push(`${mode}:${n}`);
      if (mode === "by-cleanroom") apis.forEach((a) => keys.push(`${mode}:${n}:${a.id}`));
    });
    return keys;
  }, [isGrouped, mode, reactors, hasClReactors, blockOfReactor, apis]);

  const toggleKey = (key: string) => {
    const c = new Set(collapsed);
    if (c.has(key)) c.delete(key);
    else c.add(key);
    setCollapsed(c);
  };

  // Header height (rail spacer must match): quarter band + week ticks
  // (+ day row at Month/Week zoom) + weekly load strip.
  const LOAD_H = 20;
  const headerH = 32 + 28 + (pxPerWeek >= 100 ? 20 : 0) + LOAD_H;

  // Weekly load: share of all reactor time booked (start → cycle end) by the
  // visible batches in each week, merged per reactor so overlaps count once.
  const weeklyLoad = useMemo(() => {
    const WEEK = 7 * 24 * 3600 * 1000;
    const busy = new Array(weeks.length).fill(0);
    const active = new Array(weeks.length).fill(0);
    const byReactor = new Map<string, [number, number][]>();
    filteredBatches.forEach((b) =>
      b.reactorIds.forEach((rid) =>
        byReactor.set(rid, [...(byReactor.get(rid) ?? []), [b.startMs, b.endMs]])
      )
    );
    byReactor.forEach((spans) => {
      spans.sort((x, y) => x[0] - y[0]);
      const merged: [number, number][] = [];
      spans.forEach(([a, c]) => {
        const last = merged[merged.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], c);
        else merged.push([a, c]);
      });
      merged.forEach(([a, c]) => {
        const w0 = Math.max(0, Math.floor((a - fyStartMs) / WEEK));
        const w1 = Math.min(weeks.length - 1, Math.floor((c - 1 - fyStartMs) / WEEK));
        for (let w = w0; w <= w1; w++) {
          const ws = fyStartMs + w * WEEK;
          busy[w] += Math.max(0, Math.min(c, ws + WEEK) - Math.max(a, ws));
        }
      });
    });
    filteredBatches.forEach((b) => {
      const w0 = Math.max(0, Math.floor((b.startMs - fyStartMs) / WEEK));
      const w1 = Math.min(weeks.length - 1, Math.floor((b.endMs - 1 - fyStartMs) / WEEK));
      for (let w = w0; w <= w1; w++) active[w]++;
    });
    const cap = Math.max(1, reactors.length) * WEEK;
    return busy.map((h, i) => ({ frac: Math.min(1, h / cap), active: active[i] }));
  }, [filteredBatches, weeks, fyStartMs, reactors.length]);
  const todayMs = Date.now();
  const todayX =
    todayMs >= fyStartMs && todayMs <= fyStartMs + weeks.length * 7 * 24 * 3600 * 1000
      ? ((todayMs - fyStartMs) / (7 * 24 * 3600 * 1000)) * pxPerWeek
      : null;

  // APIs that have visible bars (for the highlight chips).
  const visibleApiIds = useMemo(() => {
    const set = new Set(filteredBatches.map((b) => b.apiId));
    return apis.filter((a) => set.has(a.id));
  }, [filteredBatches, apis]);

  // Determine quarter band positions
  const quarterBands = useMemo(() => {
    const bands: { qStart: number; qEnd: number; label: string }[] = [];
    let lastQ = -1;
    let bandStart = 0;
    weeks.forEach((w, i) => {
      if (w.quarter !== lastQ) {
        if (lastQ !== -1) {
          bands.push({
            qStart: bandStart,
            qEnd: i,
            label: `Q${lastQ}`,
          });
        }
        bandStart = i;
        lastQ = w.quarter;
      }
      if (i === weeks.length - 1) {
        bands.push({ qStart: bandStart, qEnd: weeks.length, label: `Q${lastQ}` });
      }
    });
    return bands;
  }, [weeks]);

  // Renders one batch bar (cleaning pre-tail, wait, process, analysis tail,
  // hover tooltip). Shared by every Gantt mode.
  const renderBar = (b: BatchScheduleEntry, rowH: number) => {
                        const startWk = (b.startMs - fyStartMs) / (7 * 24 * 3600 * 1000);
                        const cycleEndWk = (b.endMs - fyStartMs) / (7 * 24 * 3600 * 1000);
                        const analysisEndWk =
                          (b.analysisEndMs - fyStartMs) / (7 * 24 * 3600 * 1000);
                        const left = Math.max(0, startWk * pxPerWeek);
                        const cycleWidth = Math.max(
                          2,
                          (cycleEndWk - startWk) * pxPerWeek
                        );
                        const tailWidth = Math.max(
                          0,
                          (analysisEndWk - cycleEndWk) * pxPerWeek
                        );
                        // Split the slot into leading WAIT (faded) + trailing
                        // PROCESS (solid). Wait fraction = (bct − process)/bct.
                        // Falls back to "no wait" when stage info is missing.
                        const slotInfo = stageSlotByStageId.get(b.stageId);
                        const waitFrac =
                          slotInfo && slotInfo.bctHours > 0
                            ? Math.max(
                                0,
                                Math.min(
                                  1,
                                  (slotInfo.bctHours -
                                    slotInfo.processHours) /
                                    slotInfo.bctHours
                                )
                              )
                            : 0;
                        const waitWidth = cycleWidth * waitFrac;
                        const processWidth = Math.max(
                          0,
                          cycleWidth - waitWidth
                        );
                        // Cleaning gap rendered BEFORE the bar — dark red for
                        // PCO, dark teal for the 30-day campaign cleaning.
                        // `cleaningBeforeMs` lives on each batch; the block
                        // visually fills the gap from this batch's predecessor
                        // on its train to this batch's start.
                        const cleaningHrs =
                          (b.cleaningBeforeMs ?? 0) / (3600 * 1000);
                        const cleaningWidth = Math.max(
                          0,
                          (cleaningHrs / (7 * 24)) * pxPerWeek
                        );
                        const cleanType = b.cleaningType ?? "none";
                        const cleanColor =
                          cleanType === "campaign"
                            ? "#0d9488" // teal-600 — campaign cleaning
                            : cleanType === "pco"
                            ? "#dc2626" // red-600 — PCO
                            : null;
                        if (startWk >= totalWeeks) return null;
                        const barH = rowH - 6;

                        // Live color lookup - guarantees the bar uses the
                        // CURRENT api.color, never a stale snapshot from when
                        // the schedule was last computed.
                        const barColor =
                          apiColorById.get(b.apiId) ?? b.apiColor;
                        return (
                          <div
                            key={`${b.apiId}|${b.stageId}|${b.batchNo}`}
                            data-bar
                            className="group absolute top-1/2 -translate-y-1/2 cursor-pointer transition-opacity duration-200"
                            style={{
                              left: Math.max(0, left - cleaningWidth),
                              opacity: activeApi && activeApi !== b.apiId ? 0.16 : 1,
                              zIndex: activeApi === b.apiId ? 5 : undefined,
                            }}
                            onMouseEnter={() => setHoverApi(b.apiId)}
                            onMouseLeave={() => setHoverApi(null)}
                            onClick={() =>
                              setFocusApi((f) => (f === b.apiId ? null : b.apiId))
                            }
                            title={`${b.batchId} · ${b.reactorId}\n${new Date(
                              b.startMs
                            ).toDateString()} → ${new Date(
                              b.analysisEndMs
                            ).toDateString()}`}
                          >
                            <div
                              className="flex items-center overflow-hidden rounded-[5px] transition-[filter] duration-150 group-hover:brightness-110"
                              style={{
                                boxShadow:
                                  activeApi === b.apiId
                                    ? `0 0 0 1.5px ${barColor}, 0 0 14px ${barColor}aa`
                                    : `0 1px 4px ${barColor}55`,
                              }}
                            >
                              {cleanColor && cleaningWidth > 1 && (
                                <div
                                  style={{
                                    width: cleaningWidth,
                                    height: barH,
                                    background: `repeating-linear-gradient(135deg, ${cleanColor}cc 0 4px, ${cleanColor}55 4px 8px)`,
                                    border: `1px solid ${cleanColor}`,
                                    borderRight: "none",
                                  }}
                                  className="rounded-l-sm"
                                  title={
                                    cleanType === "campaign"
                                      ? `Campaign cleaning · ${cleaningHrs.toFixed(1)}h`
                                      : `PCO cleaning · ${cleaningHrs.toFixed(1)}h`
                                  }
                                />
                              )}
                              {waitWidth > 1 ? (
                                <>
                                  <div
                                    style={{
                                      width: waitWidth,
                                      height: barH,
                                      background: `repeating-linear-gradient(45deg, ${barColor}33 0 6px, ${barColor}1a 6px 12px)`,
                                      border: `1px dashed ${barColor}80`,
                                      borderRight: "none",
                                    }}
                                    className={clsx(
                                      "transition-all group-hover:brightness-125",
                                      cleanColor && cleaningWidth > 1
                                        ? ""
                                        : "rounded-l-sm"
                                    )}
                                    title={`Wait · ${(
                                      ((slotInfo?.bctHours ?? 0) -
                                        (slotInfo?.processHours ?? 0))
                                    ).toFixed(1)}h (slot−process)`}
                                  />
                                  <div
                                    style={{
                                      width: processWidth,
                                      height: barH,
                                      background: `linear-gradient(180deg, ${barColor} 0%, ${barColor} 55%, ${barColor}c0 100%)`,
                                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)",
                                    }}
                                    className="relative border border-white/20 transition-all group-hover:brightness-125 group-hover:saturate-150"
                                  >
                                    {processWidth > 36 && (
                                      <span className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-1.5">
                                        <span
                                          className="truncate font-mono text-[10px] font-bold leading-none tracking-tight text-sky-200"
                                          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.7)" }}
                                        >
                                          {b.batchId}
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <div
                                  style={{
                                    width: cycleWidth,
                                    height: barH,
                                    background: `linear-gradient(180deg, ${barColor} 0%, ${barColor} 55%, ${barColor}c0 100%)`,
                                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)",
                                  }}
                                  className={clsx(
                                    "relative border border-white/20 transition-all group-hover:brightness-125 group-hover:saturate-150",
                                    cleanColor && cleaningWidth > 1
                                      ? ""
                                      : "rounded-l-sm"
                                  )}
                                >
                                  {cycleWidth > 36 && (
                                    <span className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-1.5">
                                      <span
                                        className="truncate font-mono text-[10px] font-bold leading-none tracking-tight text-sky-200"
                                        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.7)" }}
                                      >
                                        {b.batchId}
                                      </span>
                                    </span>
                                  )}
                                </div>
                              )}
                              {tailWidth > 1 && (
                                <div
                                  style={{
                                    width: tailWidth,
                                    height: barH,
                                    background: `linear-gradient(90deg, ${barColor}88, ${barColor}22)`,
                                    border: `1px dashed ${barColor}80`,
                                    borderLeft: "none",
                                  }}
                                  className="rounded-r-sm opacity-80"
                                />
                              )}
                            </div>
                            {/* Tooltip on hover */}
                            <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden whitespace-nowrap rounded-md border border-white/15 bg-ink-950/95 px-2 py-1.5 text-[10px] text-white shadow-xl group-hover:block">
                              <div className="font-bold">{b.apiName}</div>
                              <div className="text-ink-300">
                                {b.batchId} · S{b.stageNo} · #{b.batchNo}
                              </div>
                              <div className="text-ink-300">
                                Reactor:{" "}
                                {b.reactorIds
                                  .map(
                                    (id) =>
                                      reactors.find((x) => x.id === id)?.name ??
                                      id
                                  )
                                  .join(" + ")}
                              </div>
                              <div className="text-ink-300">
                                Start: {new Date(b.startMs).toLocaleString()}
                              </div>
                              <div className="text-ink-300">
                                Cycle End: {new Date(b.endMs).toLocaleString()}
                              </div>
                              <div className="text-ink-300">
                                Analysis End:{" "}
                                {new Date(b.analysisEndMs).toLocaleString()}
                              </div>
                              {(b.cleaningType ?? "none") !== "none" && (
                                <div
                                  className={clsx(
                                    "text-[10px]",
                                    b.cleaningType === "campaign"
                                      ? "text-lime-300"
                                      : "text-amber-300"
                                  )}
                                >
                                  {b.cleaningType === "campaign"
                                    ? "Campaign cleaning"
                                    : "PCO cleaning"}{" "}
                                  before:{" "}
                                  {(b.cleaningBeforeMs / 3600 / 1000).toFixed(1)}h
                                </div>
                              )}
                              <div
                                className={clsx(
                                  "mt-0.5 font-bold",
                                  b.inFY ? "text-lime-300" : "text-amber-300"
                                )}
                              >
                                {b.inFY ? "Within FY" : "Overflow"}
                              </div>
                            </div>
                          </div>
                        );
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Gantt Chart"
        subtitle={
          anyFilterActive
            ? `Showing ${filteredBatches.length} of ${schedule.batches.length} batches (filters active)`
            : mode === "by-api"
            ? "By API — final (product) stage only. Solid bar = process; cyan tail = analysis."
            : mode === "by-block"
            ? "Production block ▸ reactor. Click a block to collapse it to its occupancy strip; header shows reactors · APIs · utilisation over the plan window."
            : mode === "by-cleanroom"
            ? hasClReactors
              ? "Cleanroom ▸ product ▸ stage — Cleanroom (CL) reactors only, grouped by production block. Collapse a cleanroom or product to see its occupancy strip."
              : "Cleanroom ▸ product ▸ stage — no reactor is classed CL, so every production block is shown as a cleanroom."
            : "Solid bar = process; striped bar = wait inside slot. Faded tail = analysis; red stripes before a bar = PCO, teal stripes = campaign cleaning."
        }
        right={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1 text-xs">
              <button
                onClick={() => setMode("by-stage")}
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  mode === "by-stage"
                    ? "bg-cyan-300/20 text-cyan-200 shadow-glow"
                    : "text-ink-300 hover:text-white"
                )}
              >
                <Layers size={11} className="mr-1 inline" /> By Stage
              </button>
              <button
                onClick={() => setMode("by-api")}
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  mode === "by-api"
                    ? "bg-cyan-300/20 text-cyan-200 shadow-glow"
                    : "text-ink-300 hover:text-white"
                )}
              >
                <FlaskConical size={11} className="mr-1 inline" /> By API
              </button>
              <button
                onClick={() => setMode("by-reactor")}
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  mode === "by-reactor"
                    ? "bg-cyan-300/20 text-cyan-200 shadow-glow"
                    : "text-ink-300 hover:text-white"
                )}
              >
                <Beaker size={11} className="mr-1 inline" /> By Reactor
              </button>
              <button
                onClick={() => setMode("by-block")}
                title="Production block ▸ reactors. Block header = block occupancy strip + utilisation."
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  mode === "by-block"
                    ? "bg-cyan-300/20 text-cyan-200 shadow-glow"
                    : "text-ink-300 hover:text-white"
                )}
              >
                <Building2 size={11} className="mr-1 inline" /> By Block
              </button>
              <button
                onClick={() => setMode("by-cleanroom")}
                title="Cleanroom ▸ product (API) ▸ stage — which products run in each cleanroom, and when."
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  mode === "by-cleanroom"
                    ? "bg-cyan-300/20 text-cyan-200 shadow-glow"
                    : "text-ink-300 hover:text-white"
                )}
              >
                <Factory size={11} className="mr-1 inline" /> Cleanroom · Product
              </button>
            </div>
            {isGrouped && (
              <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
                <button
                  onClick={() => {
                    const c = new Set(collapsed);
                    groupKeys.forEach((k) => c.delete(k));
                    setCollapsed(c);
                  }}
                  className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
                  title="Expand all groups"
                >
                  <ChevronsUpDown size={13} />
                </button>
                <button
                  onClick={() => {
                    const c = new Set(collapsed);
                    // Collapse only the top level so one click gives a
                    // block / cleanroom overview with summary strips.
                    groupKeys
                      .filter((k) => k.split(":").length === 2)
                      .forEach((k) => c.add(k));
                    setCollapsed(c);
                  }}
                  className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
                  title="Collapse all to block / cleanroom overview"
                >
                  <ChevronsDownUp size={13} />
                </button>
              </div>
            )}
            {/* Quick-zoom presets */}
            <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1 text-[10px]">
              {(
                [
                  { label: "Year", px: 24, hint: "Whole FY at once" },
                  { label: "Quarter", px: 64, hint: "About 13 weeks at once" },
                  { label: "Month", px: 160, hint: "About 4 weeks at once" },
                  { label: "Week", px: 240, hint: "Single week zoom" },
                ] as const
              ).map((p) => {
                const isActive = pxPerWeek === p.px;
                return (
                  <button
                    key={p.label}
                    onClick={() => setPxPerWeek(p.px)}
                    title={p.hint}
                    className={clsx(
                      "rounded-md px-2 py-1 font-bold uppercase tracking-wider transition",
                      isActive
                        ? "bg-cyan-300/20 text-cyan-200"
                        : "text-ink-300 hover:text-white"
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Fine-grained +/- */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setPxPerWeek((v) => Math.max(24, v - 8))}
                className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
                title="Zoom out"
              >
                <ZoomOut size={13} />
              </button>
              <span className="px-1.5 font-mono text-[11px] text-ink-300">
                {pxPerWeek}px/wk
              </span>
              <button
                onClick={() => setPxPerWeek((v) => Math.min(240, v + 8))}
                className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
                title="Zoom in"
              >
                <ZoomIn size={13} />
              </button>
            </div>

          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2">
        <span className="ml-1 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">
          <Filter size={12} /> Filter
        </span>
        <MultiSelectPopover
          label="APIs"
          icon={<FlaskConical size={12} />}
          options={apiOptions}
          selected={apiFilter}
          onChange={setApiFilter}
          width={300}
        />
        <MultiSelectPopover
          label="Stages"
          icon={<Layers size={12} />}
          options={stageOptions}
          selected={stageFilter}
          onChange={setStageFilter}
          width={300}
        />
        <MultiSelectPopover
          label="Reactors"
          icon={<Beaker size={12} />}
          options={reactorOptions}
          selected={reactorFilter}
          onChange={setReactorFilter}
          width={260}
        />
        <MultiSelectPopover
          label="Blocks"
          icon={<Building2 size={12} />}
          options={blockOptions}
          selected={blockFilter}
          onChange={setBlockFilter}
          width={260}
        />
        <MultiSelectPopover
          label="Type"
          icon={<Tags size={12} />}
          options={typeOptions}
          selected={typeFilter}
          onChange={setTypeFilter}
          width={220}
          searchable={false}
        />
        <ClearFiltersButton
          active={anyFilterActive}
          onClear={() => {
            setApiFilter(new Set());
            setStageFilter(new Set());
            setReactorFilter(new Set());
            setTypeFilter(new Set());
            setBlockFilter(new Set());
          }}
        />
        {anyFilterActive && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-cyan-300/30 bg-cyan-300/8 px-2 py-1 text-[11px] font-semibold text-cyan-200">
            <Activity size={10} />
            {filteredBatches.length.toLocaleString()} of{" "}
            {schedule.batches.length.toLocaleString()} batches
          </span>
        )}
      </div>

      {/* Highlight chips: hover to highlight an API, click to pin it */}
      {visibleApiIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px]">
          <span className="mr-1 font-bold uppercase tracking-wider text-ink-400">Highlight</span>
          {visibleApiIds.map((a) => {
            const on = activeApi === a.id;
            return (
              <button
                key={a.id}
                onMouseEnter={() => setHoverApi(a.id)}
                onMouseLeave={() => setHoverApi(null)}
                onClick={() => setFocusApi((f) => (f === a.id ? null : a.id))}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold transition",
                  on ? "text-white" : "border-white/10 text-ink-300 hover:text-white",
                  activeApi && !on && "opacity-50"
                )}
                style={on ? { borderColor: a.color, background: `${a.color}26` } : undefined}
                title={focusApi === a.id ? "Click to clear the highlight (or press Esc)" : "Click to keep this API highlighted"}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: a.color, boxShadow: `0 0 6px ${a.color}` }} />
                {a.name}
              </button>
            );
          })}
          {focusApi && (
            <button
              onClick={() => setFocusApi(null)}
              className="ml-1 rounded-full border border-white/10 px-2 py-0.5 text-ink-300 hover:text-white"
            >
              Clear ✕
            </button>
          )}
          <span className="ml-auto text-[10px] text-ink-500">
            Ctrl/⌘ + scroll to zoom · drag to pan · click a bar to pin its API
          </span>
        </div>
      )}

      <div ref={chartCardRef} className="gantt-chart-card">
      <Card className="overflow-hidden p-0">
        {/* Single scroll container — freezes the dates header (sticky top) and
            the left labels column (sticky left) while both axes scroll. */}
        <div
          ref={scrollRef}
          onMouseDown={onPanStart}
          className={clsx(
            "max-h-[72vh] overflow-auto select-none",
            dragging ? "cursor-grabbing" : "cursor-grab"
          )}
        >
        <div className="flex" style={{ width: 200 + totalWeeks * pxPerWeek }}>
          {/* Left labels column — frozen on horizontal scroll */}
          <div className="sticky left-0 z-20 w-[200px] shrink-0 border-r border-white/10 bg-ink-950">
            {/* Header spacer — frozen on BOTH axes (corner) */}
            <div
              className="sticky top-0 z-30 flex items-end border-b border-white/10 bg-ink-950 px-3 pb-1 text-[9px] font-bold uppercase tracking-wider text-ink-500"
              style={{ height: headerH }}
            >
              Load
            </div>
            {/* Rows */}
            {isGrouped && groupRows.length === 0 && (
              <div className="px-3 py-6 text-[11px] text-ink-400">
                {reactors.length === 0
                  ? "No reactors defined."
                  : "Nothing to show — set production blocks on the Equipment tab, or clear the filters."}
              </div>
            )}
            {isGrouped &&
              groupRows.map((line) =>
                line.kind === "group" ? (
                  <button
                    key={line.key}
                    onClick={() => toggleKey(line.key)}
                    style={{ height: GROUP_ROW_H, paddingLeft: 8 + line.depth * 12 }}
                    className={clsx(
                      "flex w-full items-center gap-1.5 border-b border-white/5 pr-2 text-left text-xs font-bold text-white hover:bg-white/[0.06]",
                      line.depth === 0 ? "bg-white/[0.04]" : "bg-white/[0.02]"
                    )}
                    title={`${line.label} · ${line.sub ?? ""}`}
                  >
                    {line.collapsed ? (
                      <ChevronRight size={12} className="shrink-0 text-ink-400" />
                    ) : (
                      <ChevronDown size={12} className="shrink-0 text-ink-400" />
                    )}
                    {line.depth === 0 ? (
                      mode === "by-block" ? (
                        <Building2 size={12} className="shrink-0 text-violet-300" />
                      ) : (
                        <Factory size={12} className="shrink-0 text-violet-300" />
                      )
                    ) : (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: line.color, boxShadow: `0 0 8px ${line.color}80` }}
                      />
                    )}
                    <span className="truncate">{line.label}</span>
                    {line.sub && (
                      <span className="ml-auto shrink-0 truncate pl-1 text-[9px] font-normal text-ink-400">
                        {line.depth === 0 ? line.sub.split(" · ").slice(-1)[0] : line.batches.length}
                      </span>
                    )}
                  </button>
                ) : (
                  <div
                    key={line.key}
                    style={{ height: rowH, paddingLeft: 10 + line.depth * 12 }}
                    className="flex items-center gap-1.5 border-b border-white/5 pr-2 text-[11px] text-ink-200"
                    title={`${line.label}${line.sub ? ` · ${line.sub}` : ""}`}
                  >
                    {mode === "by-block" && (
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-sm"
                        style={{ background: line.color, boxShadow: `0 0 6px ${line.color}80` }}
                      />
                    )}
                    <span className="truncate font-semibold text-white">{line.label}</span>
                    {line.sub && (
                      <span className="ml-auto shrink-0 truncate pl-1 text-[9px] uppercase text-ink-400">
                        {line.sub}
                      </span>
                    )}
                  </div>
                )
              )}
            {mode === "by-stage" &&
              apis.map((a) => {
                if (anyFilterActive) {
                  // Skip the whole API header if none of its stages have visible bars
                  const hasAny = a.stages.some(
                    (s) =>
                      (grouped.get(`${a.id}__S${s.stageNo}`)?.length ?? 0) > 0
                  );
                  if (!hasAny) return null;
                }
                const isCollapsed = apiCollapsed(a.id);
                const visibleStages = anyFilterActive
                  ? a.stages.filter(
                      (s) =>
                        (grouped.get(`${a.id}__S${s.stageNo}`)?.length ?? 0) >
                        0
                    )
                  : a.stages;
                return (
                  <div key={a.id}>
                    <button
                      onClick={() => toggleApi(a.id)}
                      className="flex w-full items-center gap-1.5 border-b border-white/5 bg-white/[0.02] px-3 py-1.5 text-left text-xs font-bold text-white hover:bg-white/[0.05]"
                      title={`${a.name} (id: ${a.id})`}
                    >
                      {isCollapsed ? (
                        <ChevronRight size={12} className="shrink-0 text-ink-400" />
                      ) : (
                        <ChevronDown size={12} className="shrink-0 text-ink-400" />
                      )}
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          background: a.color,
                          boxShadow: `0 0 8px ${a.color}80`,
                        }}
                      />
                      <span className="truncate">{a.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-ink-400">
                        {visibleStages.length}st
                      </span>
                    </button>
                    {!isCollapsed &&
                      visibleStages.map((s) => (
                        <div
                          key={s.id}
                          style={{ height: rowH }}
                          className="flex items-center border-b border-white/5 px-4 text-[11px] text-ink-200"
                        >
                          <span className="text-ink-400">S{s.stageNo}</span>
                          <span className="ml-2 truncate">{s.stageName}</span>
                        </div>
                      ))}
                  </div>
                );
              })}

            {mode === "by-api" &&
              apis.map((a) => {
                if (
                  anyFilterActive &&
                  (grouped.get(a.id)?.length ?? 0) === 0
                )
                  return null;
                return (
                  <div
                    key={a.id}
                    style={{ height: rowH }}
                    className="flex items-center gap-2 border-b border-white/5 px-3 text-xs font-bold text-white"
                    title={`${a.name} (id: ${a.id})`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        background: a.color,
                        boxShadow: `0 0 8px ${a.color}80`,
                      }}
                    />
                    <span className="truncate">{a.name}</span>
                    {sinkLabelByApiId.get(a.id) && (
                      <span
                        className="ml-auto shrink-0 truncate text-[9px] font-normal text-ink-400"
                        title={`Final stage: ${sinkLabelByApiId.get(a.id)}`}
                      >
                        {sinkLabelByApiId.get(a.id)}
                      </span>
                    )}
                  </div>
                );
              })}

            {mode === "by-reactor" &&
              reactors.map((r) => {
                const batchCount = grouped.get(r.id)?.length ?? 0;
                if (anyFilterActive && batchCount === 0) return null;
                const cls = classColor(r.moc);
                return (
                  <div
                    key={r.id}
                    style={{ height: rowH }}
                    className="flex items-center gap-2 border-b border-white/5 px-3 text-[11px] font-bold text-white"
                    title={r.name === r.id ? r.id : `${r.name} (id: ${r.id})`}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-sm"
                      style={{
                        background: cls,
                        boxShadow: `0 0 6px ${cls}80`,
                      }}
                    />
                    <span className="truncate">{r.name}</span>
                    <span
                      className="shrink-0 text-[9px] uppercase text-ink-400"
                      title={r.moc}
                    >
                      {r.moc}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-ink-400 tabular-nums">
                      {batchCount}
                    </span>
                  </div>
                );
              })}
          </div>

          {/* Right timeline — scrolls within the shared container */}
          <div className="relative shrink-0">
            <div
              style={{
                width: totalWeeks * pxPerWeek,
                position: "relative",
              }}
            >
              {/* Header: quarters + week labels */}
              <div className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
                {/* Quarter band */}
                <div className="flex h-8 border-b border-white/10">
                  {quarterBands.map((q) => (
                    <div
                      key={q.label + q.qStart}
                      style={{ width: (q.qEnd - q.qStart) * pxPerWeek }}
                      className="flex items-center justify-center border-r border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent text-[11px] font-bold uppercase tracking-widest text-violet-200"
                    >
                      {q.label} · {monthForBand(weeks, q.qStart, q.qEnd)}
                    </div>
                  ))}
                </div>
                {/* Week ticks - label density scales with zoom */}
                {(() => {
                  const labelEvery =
                    pxPerWeek >= 64 ? 1 : pxPerWeek >= 36 ? 2 : 4;
                  return (
                    <div
                      className="relative flex h-7 border-b border-white/10"
                      style={{ width: totalWeeks * pxPerWeek }}
                    >
                      {weeks.map((w, i) => {
                        const showLabel = i % labelEvery === 0;
                        return (
                          <div
                            key={i}
                            style={{ width: pxPerWeek }}
                            className={clsx(
                              "shrink-0 border-r text-[10px]",
                              showLabel
                                ? "border-white/15 text-ink-300"
                                : "border-white/5 text-transparent"
                            )}
                          >
                            <span className="block whitespace-nowrap px-1 leading-7">
                              {w.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {/* Day-of-week ticks - only at zooms where they're readable.
                    Labels rotate based on the actual start day-of-week so a
                    plan starting on a Wednesday shows W T F S S M T, etc. */}
                {pxPerWeek >= 100 &&
                  (() => {
                    const useShortNames = pxPerWeek >= 180;
                    // Standard week starting Sunday
                    const allShort = [
                      "Sun",
                      "Mon",
                      "Tue",
                      "Wed",
                      "Thu",
                      "Fri",
                      "Sat",
                    ];
                    const allLetter = ["S", "M", "T", "W", "T", "F", "S"];
                    const startDow = new Date(planWindow.startMs).getDay();
                    return (
                      <div
                        className="relative flex h-5 border-b border-white/10 bg-white/[0.015]"
                        style={{ width: totalWeeks * pxPerWeek }}
                      >
                        {weeks.map((_, weekIdx) => (
                          <div
                            key={weekIdx}
                            className="flex shrink-0 border-r border-white/10"
                            style={{ width: pxPerWeek }}
                          >
                            {Array.from({ length: 7 }).map((_, dayIdx) => {
                              const dow = (startDow + dayIdx) % 7;
                              const isWeekend = dow === 0 || dow === 6;
                              const label = useShortNames
                                ? allShort[dow]
                                : allLetter[dow];
                              return (
                                <div
                                  key={dayIdx}
                                  style={{ width: pxPerWeek / 7 }}
                                  className={clsx(
                                    "text-center font-mono text-[9px] leading-5",
                                    isWeekend
                                      ? "text-ink-500/70"
                                      : "text-ink-400",
                                    // subtle vertical day separators
                                    dayIdx < 6 &&
                                      "border-r border-white/[0.04]"
                                  )}
                                >
                                  {label}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                {/* Weekly load strip — how busy the plant is, week by week */}
                <div
                  className="relative flex items-end border-b border-white/10 bg-white/[0.015]"
                  style={{ height: LOAD_H, width: totalWeeks * pxPerWeek }}
                >
                  {weeklyLoad.map((w, i) => (
                    <div
                      key={i}
                      className="shrink-0 px-[1px]"
                      style={{ width: pxPerWeek, height: "100%" }}
                      title={`Week of ${weeks[i]?.start.toDateString() ?? ""}: ${Math.round(w.frac * 100)}% of reactor time booked · ${w.active} batch${w.active === 1 ? "" : "es"} running`}
                    >
                      <div className="flex h-full items-end">
                        <div
                          className="w-full rounded-t-sm"
                          style={{
                            height: `${Math.max(w.frac > 0 ? 8 : 0, w.frac * 100)}%`,
                            background:
                              "linear-gradient(180deg, rgba(34,211,238,0.85), rgba(167,139,250,0.55))",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  {todayX !== null && (
                    <span
                      className="pointer-events-none absolute top-0 -translate-x-1/2 rounded bg-rose-500 px-1 text-[8px] font-bold uppercase leading-3 text-white"
                      style={{ left: todayX }}
                    >
                      Today
                    </span>
                  )}
                </div>
              </div>

              {/*
               * TODO(dag-arrows): render thin dotted SVG connectors from
               * each batch's start to its predecessor batches' analysisEnd
               * positions, so DAG dependencies (multi-predecessor, side
               * streams) are visually traceable. Punted in this pass —
               * the by-stage / by-api / by-reactor modes plus the
               * collapsed-API + filter logic make precise placement
               * non-trivial, and the spec said "build correctness first;
               * leave a TODO if it's getting too complex". The data we'd
               * need is already on each batch entry (batchNo, stageId,
               * apiId) — combine with stage.inputStageIds + the per-batch
               * analysisEndMs map to draw the lines.
               */}

              {/* Body grid + bars */}
              <div className="relative">
                {todayX !== null && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 top-0 z-[6] w-px bg-rose-400/80"
                    style={{ left: todayX, boxShadow: "0 0 6px rgba(251,113,133,0.8)" }}
                  />
                )}
                {/* Grouped modes: one body line per rail line (same heights). */}
                {isGrouped &&
                  groupRows.map((line, idx) => {
                    const h = line.kind === "group" ? GROUP_ROW_H : rowH;
                    const toX = (ms: number) =>
                      ((ms - fyStartMs) / (7 * 24 * 3600 * 1000)) * pxPerWeek;
                    return (
                      <div
                        key={line.key}
                        style={{ height: h }}
                        className={clsx(
                          "relative border-b border-white/5",
                          line.kind === "group"
                            ? line.depth === 0
                              ? "bg-white/[0.04]"
                              : "bg-white/[0.02]"
                            : idx % 2 === 0
                            ? "bg-white/[0.005]"
                            : "bg-white/[0.015]"
                        )}
                      >
                        {weeks.map((_, i) =>
                          i % 4 === 0 ? (
                            <div
                              key={i}
                              style={{ left: i * pxPerWeek }}
                              className="absolute top-0 h-full border-l border-white/10"
                            />
                          ) : null
                        )}
                        {line.kind === "row"
                          ? line.batches.map((b) => renderBar(b, rowH))
                          : mergeSpans(line.batches).map(([a, b]) => {
                              const left = Math.max(0, toX(a));
                              const width = Math.max(2, toX(b) - left);
                              const c = line.color ?? "#a78bfa";
                              return (
                                <div
                                  key={a}
                                  className="absolute top-1/2 -translate-y-1/2 rounded-sm"
                                  style={{
                                    left,
                                    width,
                                    height: line.collapsed ? 12 : 6,
                                    background: line.collapsed ? `${c}aa` : `${c}55`,
                                    border: `1px solid ${c}`,
                                  }}
                                  title={`${line.label} busy ${new Date(a).toDateString()} → ${new Date(b).toDateString()}`}
                                />
                              );
                            })}
                      </div>
                    );
                  })}
                {/* Row backgrounds with vertical week guides */}
                {visibleRows.map((row, idx) => {
                  const batches = grouped.get(row.key) || [];
                  // In by-stage mode the rail renders an API-header button
                  // before each API's first stage row. The body must emit a
                  // matching empty row of the same height so the rail and
                  // body stay vertically aligned. Without this, every bar
                  // visually appears one row ABOVE its labeled position.
                  const prevRow = idx > 0 ? visibleRows[idx - 1] : null;
                  const isFirstStageOfApi =
                    mode === "by-stage" &&
                    !!row.apiId &&
                    (!prevRow || prevRow.apiId !== row.apiId);
                  return (
                    <Fragment key={row.key}>
                      {isFirstStageOfApi && (
                        <div
                          aria-hidden
                          style={{ height: 28 }}
                          className="border-b border-white/5 bg-white/[0.02]"
                        />
                      )}
                    <div
                      style={{ height: rowH }}
                      className={clsx(
                        "relative border-b border-white/5",
                        idx % 2 === 0 ? "bg-white/[0.005]" : "bg-white/[0.015]"
                      )}
                    >
                      {/* Week vertical guides - thicker every 4 weeks */}
                      {weeks.map((_, i) => (
                        <div
                          key={i}
                          style={{ left: i * pxPerWeek, width: pxPerWeek }}
                          className={clsx(
                            "absolute top-0 h-full border-r",
                            i % 4 === 0
                              ? "border-white/10"
                              : "border-white/[0.04]"
                          )}
                        />
                      ))}
                      {/* Bars */}
                      {batches.map((b) => renderBar(b, rowH))}
                    </div>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        </div>
      </Card>
      </div>

      {/* Legend */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="text-ink-300">Legend:</span>
          <Legend
            swatch={
              <span className="inline-block h-3 w-6 rounded-sm bg-cyan-400 shadow-[0_0_6px_#00f0ff80]" />
            }
            label="Process (active)"
          />
          <Legend
            swatch={
              <span
                className="inline-block h-3 w-6 rounded-sm border border-dashed border-cyan-300/70"
                style={{
                  background:
                    "repeating-linear-gradient(45deg, rgba(0,240,255,0.20) 0 4px, rgba(0,240,255,0.08) 4px 8px)",
                }}
              />
            }
            label="Wait inside slot (BCT − Process)"
          />
          <Legend
            swatch={
              <span
                className="inline-block h-3 w-6 rounded-sm border border-dashed border-cyan-300"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(0,240,255,0.5), rgba(0,240,255,0.1))",
                }}
              />
            }
            label="Analysis window (faded tail)"
          />
          <Legend
            swatch={
              <span
                className="inline-block h-3 w-6 rounded-sm border border-[#dc2626]"
                style={{
                  background:
                    "repeating-linear-gradient(135deg, #dc2626cc 0 4px, #dc262655 4px 8px)",
                }}
              />
            }
            label="PCO cleaning (red stripes before the bar)"
          />
          <Legend
            swatch={
              <span
                className="inline-block h-3 w-6 rounded-sm border border-[#0d9488]"
                style={{
                  background:
                    "repeating-linear-gradient(135deg, #0d9488cc 0 4px, #0d948855 4px 8px)",
                }}
              />
            }
            label="Campaign cleaning (teal stripes · after 34 days)"
          />
          {isGrouped && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-300/30 bg-violet-300/8 px-2 py-1 font-semibold text-violet-200">
              <Building2 size={11} /> Header strip = merged occupancy of the
              group · % = busy reactor-time over the plan window
            </span>
          )}
          {mode === "by-reactor" && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-300/30 bg-violet-300/8 px-2 py-1 font-semibold text-violet-200">
              <Beaker size={11} /> Bar color = API · Row = Reactor · spot
              over-allocation at a glance
            </span>
          )}
          <span className="ml-auto text-ink-400">
            {schedule.totalBatches.toLocaleString()} bars rendered ·{" "}
            {schedule.fyBatches.toLocaleString()} in FY
          </span>
        </div>
      </Card>
    </div>
  );
}

function Legend({
  swatch,
  label,
}: {
  swatch: React.ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-200">
      {swatch} {label}
    </span>
  );
}

function monthForBand(
  weeks: { start: Date }[],
  qStart: number,
  qEnd: number
): string {
  if (weeks.length === 0) return "";
  const a = weeks[qStart].start;
  const b = weeks[Math.min(qEnd - 1, weeks.length - 1)].start;
  return `${a.toLocaleString("en", { month: "short" })}–${b.toLocaleString("en", { month: "short" })}`;
}

function classColor(cls: Reactor["moc"]): string {
  switch (cls) {
    case "GL":
      return "#f472b6"; // pink-400
    case "Hastelloy":
      return "#a78bfa"; // violet-400
    case "Halar lined":
      return "#fbbf24"; // amber-400
    case "SS":
    default:
      return "#00f0ff"; // cyan
  }
}
