import { useMemo } from "react";
import { ArrowRight, Layers } from "lucide-react";
import { Card } from "./Primitives";
import type { API, Reactor, ScheduleResult } from "../types";

/**
 * Multi-stage equipment
 * ---------------------
 * Top 50 reactors that are mapped (via a stage's `reactorPool`) to more than
 * one product stage. For each reactor the mapped product·stage pairs are laid
 * out in sequence with → arrows:
 *
 *   1. Stages that have scheduled batches on this reactor come first, ordered
 *      by their earliest batch start on it (the actual campaign sequence).
 *   2. Mapped-but-unscheduled stages follow, in API order then stage no.
 *
 * Ranking: most mapped stages first, then most scheduled batches.
 */

const TOP_N = 50;

interface Step {
  key: string;
  apiName: string;
  apiColor: string;
  stageNo: number;
  stageName: string;
  firstStartMs: number | null;
  batches: number;
}

export default function MultiStageEquipmentPanel({
  apis,
  reactors,
  schedule,
}: {
  apis: API[];
  reactors: Reactor[];
  schedule: ScheduleResult;
}) {
  const { rows, totalMulti } = useMemo(() => {
    const apiOrder = new Map(
      [...apis].sort((a, b) => a.id.localeCompare(b.id)).map((a, i) => [a.id, i])
    );

    // reactorId → stageId → Step
    const byReactor = new Map<string, Map<string, Step & { apiId: string }>>();
    apis.forEach((a) => {
      a.stages.forEach((s) => {
        new Set(s.reactorPool ?? []).forEach((rid) => {
          let m = byReactor.get(rid);
          if (!m) byReactor.set(rid, (m = new Map()));
          m.set(s.id, {
            key: `${a.id}-${s.id}`,
            apiId: a.id,
            apiName: a.name,
            apiColor: a.color,
            stageNo: s.stageNo,
            stageName: s.stageName,
            firstStartMs: null,
            batches: 0,
          });
        });
      });
    });

    schedule.batches.forEach((b) => {
      const step = byReactor.get(b.reactorId)?.get(b.stageId);
      if (!step) return;
      step.batches += 1;
      if (step.firstStartMs === null || b.startMs < step.firstStartMs) {
        step.firstStartMs = b.startMs;
      }
    });

    const reactorById = new Map(reactors.map((r) => [r.id, r]));
    const multi = Array.from(byReactor.entries())
      .filter(([, m]) => m.size > 1)
      .map(([rid, m]) => {
        const steps = Array.from(m.values()).sort((x, y) => {
          const xs = x.firstStartMs, ys = y.firstStartMs;
          if (xs !== null && ys !== null && xs !== ys) return xs - ys;
          if (xs !== null && ys === null) return -1;
          if (xs === null && ys !== null) return 1;
          const ao = (apiOrder.get(x.apiId) ?? 0) - (apiOrder.get(y.apiId) ?? 0);
          return ao !== 0 ? ao : x.stageNo - y.stageNo;
        });
        const r = reactorById.get(rid);
        return {
          reactorId: rid,
          reactorName: r?.name ?? rid,
          block: r?.productionBlock,
          moc: r?.moc,
          capacityKg: r?.capacityKg,
          steps,
          products: new Set(steps.map((s) => s.apiId)).size,
          batches: steps.reduce((a, s) => a + s.batches, 0),
        };
      })
      .sort(
        (a, b) =>
          b.steps.length - a.steps.length ||
          b.batches - a.batches ||
          a.reactorName.localeCompare(b.reactorName)
      );
    return { rows: multi.slice(0, TOP_N), totalMulti: multi.length };
  }, [apis, reactors, schedule]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Top {TOP_N} multi-stage equipment
          </h3>
          <p className="text-[11px] text-ink-400">
            Reactors mapped to more than one product stage. Sequence follows
            the first scheduled batch on each reactor; unscheduled mappings
            are listed last.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-bold text-cyan-300">
          <Layers size={12} />
          {totalMulti > TOP_N
            ? `${TOP_N} of ${totalMulti}`
            : `${totalMulti} reactor${totalMulti === 1 ? "" : "s"}`}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-ink-400">
          No reactor is mapped to more than one stage.
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-ink-900/95 backdrop-blur-md">
              <tr className="text-[10px] uppercase tracking-wider text-ink-300">
                <th className="border-b border-white/10 px-3 py-2 text-right">#</th>
                <th className="border-b border-white/10 px-3 py-2 text-left">Equipment</th>
                <th className="border-b border-white/10 px-3 py-2 text-right">Stages</th>
                <th className="border-b border-white/10 px-3 py-2 text-right">Products</th>
                <th className="border-b border-white/10 px-3 py-2 text-right">Batches</th>
                <th className="border-b border-white/10 px-3 py-2 text-left">
                  Sequence (product · stage)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.reactorId}
                  className="border-b border-white/5 align-top hover:bg-white/[0.04]"
                >
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-400">
                    {i + 1}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="font-semibold text-white">{r.reactorName}</div>
                    <div className="text-[10px] text-ink-400">
                      {[r.block, r.moc, r.capacityKg ? `${r.capacityKg.toLocaleString()} kg` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-cyan-300">
                    {r.steps.length}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-violet-200">
                    {r.products}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-200">
                    {r.batches.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {r.steps.map((s, j) => (
                        <span key={s.key} className="inline-flex items-center gap-1">
                          {j > 0 && (
                            <ArrowRight size={12} className="shrink-0 text-ink-400" />
                          )}
                          <span
                            className={
                              s.firstStartMs === null
                                ? "inline-flex items-center gap-1 rounded-md border border-dashed border-white/15 px-1.5 py-0.5 text-[11px] text-ink-400"
                                : "inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-ink-100"
                            }
                            title={
                              s.firstStartMs === null
                                ? "Mapped, no batches scheduled on this reactor"
                                : `${s.batches} batch${s.batches === 1 ? "" : "es"} · first ${new Date(
                                    s.firstStartMs
                                  ).toLocaleDateString()}`
                            }
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: s.apiColor }}
                            />
                            <span className="font-semibold">{s.apiName}</span>
                            <span className="text-ink-400">
                              S{s.stageNo} · {s.stageName}
                            </span>
                          </span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
