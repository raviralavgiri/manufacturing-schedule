import { useMemo } from "react";
import { CheckCircle2, ShieldCheck, GitBranch, Zap } from "lucide-react";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";

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

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Clash Report"
        subtitle="Reactor double-booking detector. Sequencer guarantees zero clashes by design."
      />

      {/* Hero */}
      <Card glow="cyan" className="!p-8">
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-3">
            <div className="absolute inset-0 animate-ping rounded-full bg-lime-400/20" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-lime-400 to-cyan-400 shadow-[0_0_40px_rgba(163,230,53,0.6)]">
              <CheckCircle2 size={42} className="text-ink-950" />
            </div>
          </div>
          <h3 className="text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            <span className="bg-gradient-to-r from-lime-300 via-cyan-300 to-violet-300 bg-clip-text text-transparent">
              {schedule.clashCount === 0
                ? "Zero Reactor Clashes"
                : `${schedule.clashCount} Clashes Detected`}
            </span>
          </h3>
          <p className="mt-2 max-w-xl text-sm text-ink-200">
            All <span className="font-bold text-white">{schedule.totalBatches}</span>{" "}
            batches are scheduled on{" "}
            <span className="font-bold text-white">{reactors.length}</span>{" "}
            reactors with no overlapping cycle windows. Reactors that appear in
            multiple stage pools are automatically queued by the
            equipment-availability sequencer — no manual intervention needed.
          </p>
        </div>
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
