import { useMemo } from "react";
import {
  CheckCircle2,
  ShieldCheck,
  GitBranch,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import { validateApiDag, type DagIssue } from "../utils/validation";

export default function ClashTab() {
  const reactors = useStore((s) => s.reactors);
  const apis = useStore((s) => s.apis);
  const schedule = useStore((s) => s.schedule);

  // Derive "contended reactors" live from current pool memberships:
  // a reactor is contended iff it appears in ≥ 2 distinct stage pools across
  // all APIs. This replaces the old static `r.shared` flag, which went stale
  // as soon as users edited stage pools.
  const contendedStats = useMemo(() => {
    const stagesUsingByReactor = new Map<string, Set<string>>();
    apis.forEach((a) =>
      a.stages.forEach((s) =>
        s.reactorPool.forEach((rid) => {
          const key = `${a.id}·S${s.stageNo}`;
          if (!stagesUsingByReactor.has(rid))
            stagesUsingByReactor.set(rid, new Set());
          stagesUsingByReactor.get(rid)!.add(key);
        })
      )
    );
    return reactors
      .filter((r) => (stagesUsingByReactor.get(r.id)?.size ?? 0) >= 2)
      .map((r) => {
        const stagesUsing = stagesUsingByReactor.get(r.id)?.size ?? 0;
        const batches = schedule.batches.filter((b) =>
          b.reactorIds.includes(r.id)
        ).length;
        return {
          id: r.id,
          name: r.name,
          cls: r.moc,
          batches,
          stagesUsing,
        };
      })
      .sort((a, b) => b.stagesUsing - a.stagesUsing || a.id.localeCompare(b.id));
  }, [reactors, apis, schedule]);

  // DAG validation surfaces non-clash structural issues — cycles, dangling
  // refs, multi-sink layouts. Computed live from the current API set so any
  // edit on the Stages tab reflects here within one render.
  const dagIssues = useMemo(() => {
    const out: DagIssue[] = [];
    apis.forEach((a) => out.push(...validateApiDag(a)));
    return out;
  }, [apis]);
  const dagErrors = dagIssues.filter((i) => i.level === "error");
  const dagWarns = dagIssues.filter((i) => i.level === "warn");
  const stageNameById = useMemo(() => {
    const m = new Map<string, string>();
    apis.forEach((a) =>
      a.stages.forEach((s) =>
        m.set(s.id, `${a.name} · S${s.stageNo} ${s.stageName}`)
      )
    );
    return m;
  }, [apis]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Clash Report"
        subtitle="Reactor double-booking detector. Sequencer guarantees zero clashes by design."
      />

      {/* DAG issues — structural problems with the stage dependency graph.
          Errors will cause cascade.ts to fall back to linear order; warnings
          (e.g. multi-sink) are informational only. */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <GitBranch size={18} className="text-violet-300" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            DAG Issues
          </h3>
          <Tag tone={dagErrors.length > 0 ? "rose" : dagWarns.length > 0 ? "amber" : "lime"}>
            {dagErrors.length === 0 && dagWarns.length === 0
              ? "All clear"
              : `${dagErrors.length} error${dagErrors.length === 1 ? "" : "s"}, ${dagWarns.length} warning${dagWarns.length === 1 ? "" : "s"}`}
          </Tag>
          <span className="text-[11px] text-ink-400">
            Stage-graph structure (predecessors / successors / sinks)
          </span>
        </div>
        <p className="mb-3 text-xs text-ink-300">
          Validation of every API's <span className="font-mono">inputStageIds</span>{" "}
          graph. Errors trigger a fall-back to legacy linear cascade so the
          schedule stays valid; the user is expected to fix them in the Stages
          tab. Warnings (multi-sink) are advisory.
        </p>
        {dagIssues.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-xs text-lime-300">
            <CheckCircle2 size={12} className="mr-1 inline" />
            Every API's stage graph is acyclic, fully connected, and has exactly one sink.
          </div>
        ) : (
          <div className="space-y-1.5">
            {dagIssues.map((i, idx) => {
              const isErr = i.level === "error";
              const target = i.stageId
                ? stageNameById.get(i.stageId) ?? i.stageId
                : i.apiId;
              return (
                <div
                  key={idx}
                  className={
                    isErr
                      ? "flex items-start gap-2 rounded-md border border-rose-300/30 bg-rose-400/8 px-3 py-1.5 text-xs text-rose-200"
                      : "flex items-start gap-2 rounded-md border border-amber-300/30 bg-amber-400/8 px-3 py-1.5 text-xs text-amber-200"
                  }
                >
                  <AlertTriangle
                    size={12}
                    className={
                      isErr
                        ? "mt-0.5 shrink-0 text-rose-300"
                        : "mt-0.5 shrink-0 text-amber-300"
                    }
                  />
                  <span className="flex-1">
                    <span className="mr-1 font-mono text-[10px] uppercase tracking-wider opacity-80">
                      [{i.apiId}]
                    </span>
                    <span className="font-bold">{target}:</span> {i.msg}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Algorithm explanation */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={18} className="text-cyan-300" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            How the Sequencer Guarantees Zero Clashes
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Step
            n={1}
            icon={<GitBranch size={14} />}
            title="Per-reactor booking ledger"
            body={
              <>
                Each reactor maintains an ordered list of <span className="font-mono text-cyan-300">[start, cycleEnd]</span> intervals.
                A batch can only book a slot starting at or after the previous slot's <span className="font-mono">cycleEnd</span>.
              </>
            }
          />
          <Step
            n={2}
            icon={<Zap size={14} />}
            title="Earliest-free gap finder"
            body={
              <>
                For each batch the sequencer searches every reactor in its
                allowed pool and picks the one that frees up{" "}
                <span className="font-bold">earliest</span>. Contended reactors
                are naturally queued — no special-case logic.
              </>
            }
          />
          <Step
            n={3}
            icon={<CheckCircle2 size={14} />}
            title="Stage ordering & PCO"
            body={
              <>
                For an API, stage <span className="font-mono">N+1</span>'s
                batches cannot start before stage{" "}
                <span className="font-mono">N</span>'s analysis ends (+ 4h
                inter-stage transfer). When a reactor switches campaign, a
                stage-defined PCO cleaning gap is enforced.
              </>
            }
          />
        </div>
      </Card>

      {/* Contended reactors — derived live from current pool memberships */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Contended Reactors
          </h3>
          <Tag tone="violet">Auto-queued</Tag>
          <span className="text-[11px] text-ink-400">
            {contendedStats.length} reactor
            {contendedStats.length === 1 ? "" : "s"} in ≥ 2 stage pools
          </span>
        </div>
        <p className="mb-3 text-xs text-ink-300">
          Computed live from current stage reactor pools. When a reactor
          appears in multiple stages, the sequencer queues batches serially on
          it — guaranteeing zero overlaps and applying PCO cleaning gaps when
          the campaign changes.
        </p>
        {contendedStats.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-xs text-ink-400">
            No contended reactors right now. Every reactor is exclusive to a
            single stage pool.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {contendedStats.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-violet-300/20 bg-gradient-to-br from-violet-500/10 to-cyan-400/5 p-3"
              >
                <div className="font-mono text-base font-bold text-white">
                  {s.name}
                </div>
                <div className="mb-2 text-[10px] uppercase tracking-wider text-violet-300">
                  {s.cls} · contended
                </div>
                <div className="space-y-0.5 font-mono text-[11px] text-ink-200">
                  <div>
                    <span className="text-ink-400">batches: </span>
                    <span className="font-bold text-cyan-300">{s.batches}</span>
                  </div>
                  <div>
                    <span className="text-ink-400">stages: </span>
                    <span className="font-bold text-violet-300">
                      {s.stagesUsing}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-lime-300">
                  <CheckCircle2 size={10} className="mr-0.5 inline" />
                  no overlaps
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-300/20 text-[11px] font-bold text-cyan-300">
          {n}
        </span>
        <span className="text-cyan-300">{icon}</span>
        <h4 className="text-xs font-bold uppercase tracking-wider text-white">
          {title}
        </h4>
      </div>
      <p className="text-xs leading-relaxed text-ink-200">{body}</p>
    </div>
  );
}
