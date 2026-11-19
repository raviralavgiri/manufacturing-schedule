import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { ArrowRight, ListOrdered, RotateCcw } from "lucide-react";
import { Card } from "./Primitives";
import { useStore } from "../store";
import type { API, Reactor, ScheduleResult } from "../types";
import {
  campaignQuarterTargets,
  isCampaignMode,
  quarterRankOf,
  sinkStageIds,
} from "../scheduler/campaigns";
import { buildReactorBlockMap, resolveApiBlock } from "../utils/apiOrder";
import { fmtDate } from "../utils/dates";

const NO_BLOCK = "(no block)";
const QS = [0, 1, 2, 3];

/**
 * Per-quarter campaign sequence of the APIs that share a cleanroom / block.
 * Rank 1 runs first: in that block + quarter an API's final-stage campaign
 * starts only after every lower-ranked API's campaign has been scheduled.
 * Blank = automatic order (material readiness, equipment, Seq tie-break).
 */
export default function CampaignSequenceEditor({
  apis,
  reactors,
  schedule,
}: {
  apis: API[];
  reactors: Reactor[];
  schedule: ScheduleResult;
}) {
  const setQuarterSequence = useStore((s) => s.setQuarterSequence);

  const { blocks, apisByBlock, otherByBlock } = useMemo(() => {
    const rb = buildReactorBlockMap(reactors);
    const apisByBlock = new Map<string, API[]>();
    const otherByBlock = new Map<string, API[]>();
    apis.forEach((a) => {
      const b = resolveApiBlock(a, rb) || NO_BLOCK;
      const target = isCampaignMode(a) ? apisByBlock : otherByBlock;
      target.set(b, [...(target.get(b) ?? []), a]);
    });
    const coll = (x: string, y: string) =>
      x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
    apisByBlock.forEach((list) =>
      list.sort(
        (x, y) =>
          (x.productionSequence ?? 1e9) - (y.productionSequence ?? 1e9) ||
          coll(x.name, y.name)
      )
    );
    const blocks = Array.from(apisByBlock.keys()).sort((x, y) =>
      x === NO_BLOCK ? 1 : y === NO_BLOCK ? -1 : coll(x, y)
    );
    return { blocks, apisByBlock, otherByBlock };
  }, [apis, reactors]);

  const [block, setBlock] = useState<string>("");
  useEffect(() => {
    if (!blocks.includes(block)) setBlock(blocks[0] ?? "");
  }, [blocks, block]);

  const list = apisByBlock.get(block) ?? [];
  const others = otherByBlock.get(block) ?? [];

  // Which quarters each API has a campaign in.
  const hasCampaignIn = useMemo(() => {
    const m = new Map<string, Set<number>>();
    list.forEach((a) => m.set(a.id, new Set(campaignQuarterTargets(a).targets)));
    return m;
  }, [list]);

  // Scheduled order per quarter: first final-stage start of each API's
  // campaign(s) targeting that quarter.
  const scheduledOrder = useMemo(() => {
    const ids = new Set(list.map((a) => a.id));
    const sinks = new Set<string>();
    list.forEach((a) => sinkStageIds(a).forEach((id) => sinks.add(id)));
    return QS.map((q) => {
      const first = new Map<string, number>();
      for (const b of schedule.batches) {
        if (!ids.has(b.apiId) || !sinks.has(b.stageId) || b.targetQuarter !== q) continue;
        first.set(b.apiId, Math.min(first.get(b.apiId) ?? Infinity, b.startMs));
      }
      return Array.from(first.entries())
        .sort((x, y) => x[1] - y[1])
        .map(([apiId, ms]) => ({ apiId, ms, name: list.find((a) => a.id === apiId)?.name ?? apiId }));
    });
  }, [list, schedule]);

  if (blocks.length === 0) {
    return (
      <Card>
        <Title />
        <p className="mt-2 text-xs text-ink-400">
          No API is in campaign mode. Set <b>Camp/yr</b> on the APIs tab first; the campaign
          sequence applies to campaign-mode APIs that share a cleanroom / block.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <Title />
        <div className="flex flex-wrap gap-1">
          {blocks.map((b) => (
            <button
              key={b}
              onClick={() => setBlock(b)}
              className={clsx(
                "rounded-md border px-2.5 py-1 text-xs font-semibold transition",
                b === block
                  ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-200"
                  : "border-white/10 text-ink-300 hover:text-white"
              )}
            >
              {b}
              <span className="ml-1 font-mono text-[10px] opacity-70">
                {apisByBlock.get(b)?.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto px-4 py-3">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-ink-400">
              <th className="py-1 pr-3">API</th>
              {QS.map((q) => (
                <th key={q} className="py-1 pr-3">
                  <span className="inline-flex items-center gap-1">
                    Q{q + 1} order
                    {list.some((a) => quarterRankOf(a, q) !== null) && (
                      <button
                        title={`Clear the Q${q + 1} sequence for ${block} (automatic order)`}
                        onClick={() =>
                          setQuarterSequence(
                            q,
                            Object.fromEntries(list.map((a) => [a.id, undefined]))
                          )
                        }
                        className="rounded p-0.5 text-ink-400 hover:bg-white/10 hover:text-white"
                      >
                        <RotateCcw size={10} />
                      </button>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-t border-white/5">
                <td className="py-1.5 pr-3 font-semibold text-white">
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: a.color }}
                  />
                  {a.name}
                </td>
                {QS.map((q) => (
                  <td key={q} className="py-1.5 pr-3">
                    {hasCampaignIn.get(a.id)?.has(q) ? (
                      <RankInput
                        value={quarterRankOf(a, q)}
                        max={list.length}
                        onCommit={(v) => setQuarterSequence(q, { [a.id]: v })}
                      />
                    ) : (
                      <span className="text-ink-500" title="No campaign of this API targets this quarter">
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-white/10 align-top">
              <td className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                Scheduled
              </td>
              {QS.map((q) => {
                const order = scheduledOrder[q];
                const ranks = list
                  .map((a) => quarterRankOf(a, q))
                  .filter((r): r is number => r !== null);
                const tied = ranks.length !== new Set(ranks).size;
                return (
                  <td key={q} className="py-2 pr-3">
                    {order.length === 0 ? (
                      <span className="text-ink-500">—</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1 text-[11px]">
                        {order.map((o, i) => (
                          <span key={o.apiId} className="inline-flex items-center gap-1">
                            {i > 0 && <ArrowRight size={10} className="text-ink-500" />}
                            <span className="text-ink-100" title={`First final-stage batch ${fmtDate(o.ms)}`}>
                              {o.name}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-ink-400">
                      {ranks.length === 0 ? "automatic" : "user sequence"}
                      {tied && " · equal ranks run in automatic order"}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        {others.length > 0 && (
          <p className="mt-2 text-[11px] text-ink-400">
            Not sequenced (not in campaign mode): {others.map((a) => a.name).join(", ")} — set
            Camp/yr on the APIs tab to include them.
          </p>
        )}
        <p className="mt-2 text-[11px] text-ink-400">
          Rank 1 runs first. In {block} for that quarter, an API's final-stage campaign starts only
          after every lower-ranked API's campaign is scheduled. A later API can therefore wait
          even if its material is ready earlier. Blank = automatic order.
        </p>
      </div>
    </Card>
  );
}

function Title() {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-white">
        <ListOrdered size={14} /> Campaign sequence by cleanroom &amp; quarter
      </h3>
      <p className="text-[11px] text-ink-400">
        Set the order in which the APIs of a cleanroom / block run their campaigns in each quarter.
      </p>
    </div>
  );
}

function RankInput({
  value,
  max,
  onCommit,
}: {
  value: number | null;
  max: number;
  onCommit: (v: number | undefined) => void;
}) {
  const [local, setLocal] = useState(value == null ? "" : String(value));
  useEffect(() => setLocal(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const t = local.trim();
    if (t === "") {
      if (value != null) onCommit(undefined);
      return;
    }
    const n = Math.round(Number(t));
    if (!Number.isFinite(n) || n < 1) {
      setLocal(value == null ? "" : String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      min={1}
      max={Math.max(max, 1)}
      value={local}
      placeholder="auto"
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(value == null ? "" : String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="cell-yellow w-16 rounded-md px-2 py-1 text-right font-mono text-sm tabular-nums"
      title="Sequence rank in this quarter (1 = first). Blank = automatic."
    />
  );
}
