import { useMemo } from "react";
import type { FlowNode } from "../utils/topologyPresets";

/**
 * Stage-flow diagram for cross-checking a Stage Flow selection, e.g.
 *
 *   A1 → A2 ─┐                       S1 → S2 → S3 → S4
 *             ├─▶ Merge → Final            ↑
 *   B1 → B2 ─┘                            S2i  (side chain ×0.3)
 *
 * Layout: columns = flow order (side chains and shorter branches are
 * right-aligned to the stage they feed), rows = branches. Main flow is solid
 * cyan, side chains dashed violet, final (sink) stages outlined lime.
 */

const MAIN = "#22d3ee";
const SIDE = "#a78bfa";
const SINK = "#a3e635";
const ROW_H = 46;
const NODE_H = 26;
const GAP_X = 34;
const PAD = 10;

interface Laid {
  n: FlowNode;
  level: number;
  y: number; // row units (may be fractional for centred merges / forks)
  side: boolean;
  sink: boolean;
}

function layout(nodes: FlowNode[]): Laid[] {
  const byNo = new Map(nodes.map((n) => [n.no, n]));
  const succ = new Map<number, number[]>();
  nodes.forEach((n) =>
    n.inputs.forEach((i) => succ.set(i, [...(succ.get(i) ?? []), n.no]))
  );

  // Topological order (Kahn); any cycle leftovers are appended.
  const indeg = new Map(nodes.map((n) => [n.no, n.inputs.filter((i) => byNo.has(i)).length]));
  const queue = nodes.filter((n) => indeg.get(n.no) === 0).map((n) => n.no);
  const topo: number[] = [];
  while (queue.length) {
    const k = queue.shift()!;
    topo.push(k);
    for (const s of succ.get(k) ?? []) {
      indeg.set(s, (indeg.get(s) ?? 1) - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  nodes.forEach((n) => !topo.includes(n.no) && topo.push(n.no));

  // Side-chain membership: an anchor, or a stage whose main input is one.
  const side = new Map<number, boolean>();
  for (const k of topo) {
    const n = byNo.get(k)!;
    side.set(k, !!n.sideChain || (n.inputs.length === 1 && !!side.get(n.inputs[0])));
  }
  const mainInputs = (n: FlowNode) => n.inputs.filter((i) => byNo.has(i) && !side.get(i));

  // Columns: longest path from sources, then pull feeders right so they sit
  // just before the stage they feed (side chains, shorter parallel branches).
  const level = new Map<number, number>();
  for (const k of topo) {
    const ins = byNo.get(k)!.inputs.filter((i) => level.has(i));
    level.set(k, ins.length ? Math.max(...ins.map((i) => level.get(i)!)) + 1 : 0);
  }
  for (const k of [...topo].reverse()) {
    const ss = succ.get(k) ?? [];
    if (ss.length) level.set(k, Math.max(level.get(k)!, Math.min(...ss.map((s) => level.get(s)!)) - 1));
  }

  // Rows: walk back from each final stage; the main input keeps the row,
  // every other input opens a new row below.
  const lane = new Map<number, number>();
  let next = 0;
  const assign = (k: number, l: number) => {
    if (lane.has(k)) return;
    lane.set(k, l);
    const n = byNo.get(k)!;
    const ins = n.inputs.filter((i) => byNo.has(i));
    const primary = mainInputs(n)[0] ?? ins[0];
    if (primary !== undefined) assign(primary, l);
    ins.filter((i) => i !== primary && !side.get(i)).forEach((i) => assign(i, ++next));
    ins.filter((i) => i !== primary && side.get(i)).forEach((i) => assign(i, ++next));
  };
  const sinks = nodes.filter((n) => !(succ.get(n.no)?.length));
  sinks.forEach((s, i) => assign(s.no, i === 0 ? 0 : ++next));
  nodes.forEach((n) => !lane.has(n.no) && assign(n.no, ++next));

  // Vertical position: merges centre between their (main) inputs, forks
  // centre over their branches; chains follow their neighbour in-lane.
  const y = new Map<number, number>();
  for (const k of topo) {
    const n = byNo.get(k)!;
    const ins = mainInputs(n);
    if (ins.length >= 2) y.set(k, ins.reduce((a, i) => a + y.get(i)!, 0) / ins.length);
    else if (ins.length === 1 && lane.get(ins[0]) === lane.get(k)) y.set(k, y.get(ins[0])!);
    else y.set(k, lane.get(k)!);
  }
  for (const k of [...topo].reverse()) {
    const ss = (succ.get(k) ?? []).filter((s) => !side.get(s) || side.get(k));
    if (ss.length >= 2 && !side.get(k)) y.set(k, ss.reduce((a, s) => a + y.get(s)!, 0) / ss.length);
    else if (
      ss.length === 1 &&
      lane.get(ss[0]) === lane.get(k) &&
      (succ.get(k)?.length ?? 0) === 1 &&
      // never follow a merge's centred position — its branches keep their rows
      mainInputs(byNo.get(ss[0])!).length < 2
    )
      y.set(k, y.get(ss[0])!);
  }

  return nodes.map((n) => ({
    n,
    level: level.get(n.no)!,
    y: y.get(n.no)!,
    side: !!side.get(n.no),
    sink: !(succ.get(n.no)?.length),
  }));
}

export default function StageFlowPreview({
  nodes,
  title = "Stage flow preview",
  note,
}: {
  nodes: FlowNode[];
  title?: string;
  note?: string;
}) {
  const laid = useMemo(() => layout(nodes), [nodes]);
  if (nodes.length === 0) return null;

  const nameW = Math.min(
    150,
    Math.max(56, ...nodes.map((n) => Math.ceil(n.name.length * 6.6) + 18))
  );
  const colW = nameW + GAP_X;
  const maxLevel = Math.max(...laid.map((l) => l.level));
  const maxY = Math.max(...laid.map((l) => l.y));
  const width = PAD * 2 + (maxLevel + 1) * colW - GAP_X;
  const height = PAD * 2 + maxY * ROW_H + NODE_H + 14;
  const pos = new Map(
    laid.map((l) => [l.n.no, { x: PAD + l.level * colW, cy: PAD + l.y * ROW_H + NODE_H / 2, l }])
  );
  const nameOf = (no: number) => laid.find((l) => l.n.no === no)?.n.name ?? `S${no}`;

  const edges: { d: string; side: boolean; label?: string; lx: number; ly: number; key: string }[] = [];
  for (const l of laid) {
    const to = pos.get(l.n.no)!;
    l.n.inputs.forEach((i, idx) => {
      const from = pos.get(i);
      if (!from) return;
      const x1 = from.x + nameW;
      const x2 = to.x - 2;
      const mx = x2 - GAP_X / 2;
      const d =
        Math.abs(from.cy - to.cy) < 0.5
          ? `M${x1},${from.cy} H${x2}`
          : `M${x1},${from.cy} H${mx} V${to.cy} H${x2}`;
      const f = l.n.inputFactors?.[idx];
      edges.push({
        key: `${i}-${l.n.no}`,
        d,
        side: from.l.side,
        label: typeof f === "number" && f !== 1 ? `×${f}` : undefined,
        lx: mx + 3,
        ly: from.cy - 4,
      });
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-ink-950/40 p-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] uppercase tracking-wider text-ink-400">
        <span className="font-bold text-ink-200">{title}</span>
        <span className="normal-case tracking-normal">
          {nodes.length} stage{nodes.length === 1 ? "" : "s"} ·{" "}
          <span style={{ color: MAIN }}>━ main flow</span> ·{" "}
          <span style={{ color: SIDE }}>┅ side chain</span> ·{" "}
          <span style={{ color: SINK }}>▢ final stage</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}: ${nodes.map((n) => `${n.name}${n.inputs.length ? ` from ${n.inputs.map(nameOf).join(" and ")}` : ""}`).join("; ")}`}
          className="text-ink-100"
        >
          <defs>
            {[
              ["arrow-main", MAIN],
              ["arrow-side", SIDE],
            ].map(([id, c]) => (
              <marker key={id} id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill={c} />
              </marker>
            ))}
          </defs>
          {edges.map((e) => (
            <g key={e.key}>
              <path
                d={e.d}
                fill="none"
                stroke={e.side ? SIDE : MAIN}
                strokeWidth={1.6}
                strokeDasharray={e.side ? "4 3" : undefined}
                markerEnd={`url(#${e.side ? "arrow-side" : "arrow-main"})`}
                opacity={0.9}
              />
              {e.label && (
                <text x={e.lx} y={e.ly} fontSize={9} fill="currentColor" opacity={0.75}>
                  {e.label}
                </text>
              )}
            </g>
          ))}
          {laid.map((l) => {
            const p = pos.get(l.n.no)!;
            const stroke = l.side ? SIDE : l.sink ? SINK : MAIN;
            return (
              <g key={l.n.no}>
                <title>
                  {`S${l.n.no} · ${l.n.name}`}
                  {l.n.inputs.length ? ` ← ${l.n.inputs.map(nameOf).join(", ")}` : " (start)"}
                  {l.n.sideChain
                    ? ` · side chain sized from ${nameOf(l.n.sideChain.baseNo)} × ${l.n.sideChain.factor}`
                    : ""}
                </title>
                <rect
                  x={p.x}
                  y={p.cy - NODE_H / 2}
                  width={nameW}
                  height={NODE_H}
                  rx={6}
                  fill={stroke}
                  fillOpacity={0.12}
                  stroke={stroke}
                  strokeWidth={l.sink ? 1.8 : 1.2}
                  strokeDasharray={l.side ? "4 3" : undefined}
                />
                <text
                  x={p.x + nameW / 2}
                  y={p.cy + 3.5}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="currentColor"
                >
                  {l.n.name.length * 6.6 + 18 > nameW
                    ? l.n.name.slice(0, Math.floor((nameW - 18) / 6.6) - 1) + "…"
                    : l.n.name}
                </text>
                {l.n.sideChain && (
                  <text
                    x={p.x + nameW / 2}
                    y={p.cy + NODE_H / 2 + 11}
                    textAnchor="middle"
                    fontSize={9}
                    fill={SIDE}
                  >
                    {nameOf(l.n.sideChain.baseNo)} × {l.n.sideChain.factor}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {note && <p className="mt-1 px-1 text-[10px] text-ink-400">{note}</p>}
    </div>
  );
}
