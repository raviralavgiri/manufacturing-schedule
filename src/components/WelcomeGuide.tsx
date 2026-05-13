import { useEffect, useState } from "react";
import {
  Beaker,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Database,
  FlaskConical,
  Gauge,
  LayoutGrid,
  Layers,
  Sparkles,
  X,
} from "lucide-react";
import { clsx } from "clsx";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Step {
  title: string;
  /** Hero icon shown above the title for visual rhythm. */
  icon: React.ReactNode;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Welcome to the Pharma Production Planner",
    icon: <Sparkles size={28} className="text-cyan-300" />,
    body: (
      <>
        <p>
          This app turns your{" "}
          <span className="font-semibold text-white">APIs</span>,{" "}
          <span className="font-semibold text-white">stages</span>, and{" "}
          <span className="font-semibold text-white">reactor fleet</span>{" "}
          into a complete batch schedule with a Gantt chart, equipment
          utilisation, and quarterly targets — all reactive to your edits.
        </p>
        <p className="mt-3 text-ink-300">
          Quick tour:{" "}
          <span className="font-mono text-cyan-300">←</span> /{" "}
          <span className="font-mono text-cyan-300">→</span> to navigate,{" "}
          <span className="font-mono text-cyan-300">Esc</span> to close.
        </p>
      </>
    ),
  },
  {
    title: "Five tabs, in the order you'll use them",
    icon: <LayoutGrid size={28} className="text-cyan-300" />,
    body: (
      <ol className="space-y-3 text-sm">
        <ConceptRow
          icon={<FlaskConical size={16} className="text-amber-300" />}
          name="APIs"
          desc="The products you want to make. One row per API. Set the per-API plan window (Start / End dates), the number of stages, and the target output in kg."
        />
        <ConceptRow
          icon={<Database size={16} className="text-amber-300" />}
          name="Stages"
          desc="One row per stage of every API. Edit the reactor pool, BCF (interval between batches), BCT (slot duration), Process (active processing), Analysis, and PCO (cleaning) hours."
        />
        <ConceptRow
          icon={<Beaker size={16} className="text-cyan-300" />}
          name="Master Reactor"
          desc="Your physical reactor fleet. Each row has an immutable ID + editable name, MOC (SS / GL / Hastelloy / Halar lined), Agitator type, and Capacity. Add / delete reactors here."
        />
        <ConceptRow
          icon={<CalendarDays size={16} className="text-cyan-300" />}
          name="Schedule"
          desc="The flat batch list with Start / End / Reactor / Pool. Filter by API, Reactor, or Stage. Search to jump to a batch."
        />
        <ConceptRow
          icon={<Layers size={16} className="text-violet-300" />}
          name="Gantt Chart"
          desc="Visual timeline. View by Stage / API / Reactor. Faded tails = analysis, yellow pre-tail = PCO, green pre-tail = 30-day campaign cleaning."
        />
      </ol>
    ),
  },
  {
    title: "Quick-start path (≈ 2 minutes)",
    icon: <Sparkles size={28} className="text-cyan-300" />,
    body: (
      <ol className="space-y-2 text-sm">
        <li>
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-300/20 font-mono text-[11px] font-bold text-cyan-300">
            1
          </span>
          <span className="font-semibold text-white">APIs tab</span> — set the
          target kg + plan window for each API.
        </li>
        <li>
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-300/20 font-mono text-[11px] font-bold text-cyan-300">
            2
          </span>
          <span className="font-semibold text-white">Master Reactor</span> —
          confirm your fleet (capacity / MOC / agitator) is right.
        </li>
        <li>
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-300/20 font-mono text-[11px] font-bold text-cyan-300">
            3
          </span>
          <span className="font-semibold text-white">Stages tab</span> — for
          each stage pick a reactor pool and set BCF / BCT / Process / PCO.
          Yellow cells are editable; cascades recompute automatically.
        </li>
        <li>
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-300/20 font-mono text-[11px] font-bold text-cyan-300">
            4
          </span>
          <span className="font-semibold text-white">Schedule / Gantt</span> —
          inspect the result. Use Gantt → "By Reactor" mode to see actual
          equipment calendars.
        </li>
        <li>
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-300/20 font-mono text-[11px] font-bold text-cyan-300">
            5
          </span>
          <span className="font-semibold text-white">Export</span> — Schedule
          tab CSV or Gantt → "Gantt grid (Excel)" for a coloured workbook
          with By&nbsp;Reactor / By&nbsp;Stage / By&nbsp;API tabs.
        </li>
      </ol>
    ),
  },
  {
    title: "Power concepts you'll meet",
    icon: <Gauge size={28} className="text-cyan-300" />,
    body: (
      <div className="space-y-3 text-sm">
        <Concept
          term="BCF (Batch Charging Frequency)"
          def={
            <>
              Interval between two consecutive batch{" "}
              <em>starts</em> at the same stage:{" "}
              <span className="font-mono text-cyan-300">
                start_n − start_(n−1) = BCF
              </span>
              .
            </>
          }
        />
        <Concept
          term="BCT (slot duration)"
          def="How long a reactor is occupied per batch. start + BCT = reactor free."
        />
        <Concept
          term="Process"
          def="Active processing time within the slot. (BCT − Process) shows as a striped wait bar at the start of every batch on the Gantt."
        />
        <Concept
          term="PCO + 30-day campaign cleaning"
          def="When a reactor switches campaign (different api/stage), a stage-defined PCO gap is enforced. Same-campaign batches get an automatic cleaning at the 30-day mark."
        />
        <Concept
          term="Reactor substitution"
          def="When a stage's pool reactor is busy, the scheduler auto-substitutes any like-for-like reactor (same MOC, agitator, capacity) — even if it's not in the explicit pool."
        />
      </div>
    ),
  },
  {
    title: "Data, sharing & where to come back to",
    icon: <Cloud size={28} className="text-cyan-300" />,
    body: (
      <div className="space-y-3 text-sm">
        <p>
          The pill in the top right (
          <span className="rounded-md border border-cyan-300/30 bg-cyan-300/5 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
            Cloud ready ▾
          </span>
          ) is your data-source switch. Click it to:
        </p>
        <ul className="space-y-1.5 pl-4">
          <li className="list-disc">
            Toggle between <span className="font-semibold text-cyan-300">Cloud</span>{" "}
            (Supabase, default) and{" "}
            <span className="font-semibold text-violet-300">Local</span>{" "}
            (browser only).
          </li>
          <li className="list-disc">
            Copy the active <span className="font-mono">project id</span> —
            paste it into another browser to share the same data.
          </li>
        </ul>
        <p>
          The <span className="font-bold text-white">Project Switcher</span>{" "}
          on the top-left lets you create / switch between separate planning
          contexts (e.g. dev plan vs prod plan).
        </p>
        <p>
          Lost? Click the <span className="font-mono text-cyan-300">?</span>{" "}
          button next to the project switcher anytime to bring this guide
          back.
        </p>
      </div>
    ),
  },
];

export default function WelcomeGuide({ open, onClose }: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      if (e.key === "ArrowRight")
        setStep((s) => Math.min(STEPS.length - 1, s + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const cur = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="welcome-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="welcome-modal-bg relative w-full max-w-2xl overflow-hidden rounded-2xl border border-cyan-300/20 shadow-2xl shadow-black/70"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close guide"
          className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-ink-300 transition hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>

        {/* Hero */}
        <div className="border-b border-white/5 bg-gradient-to-br from-cyan-300/10 via-violet-400/5 to-pink-400/5 px-8 py-6">
          <div className="mb-2 flex items-center gap-3">
            {cur.icon}
            <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-300">
              Step {step + 1} of {STEPS.length}
            </span>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
            {cur.title}
          </h2>
        </div>

        {/* Body */}
        <div className="max-h-[55vh] overflow-y-auto px-8 py-6 text-sm leading-relaxed text-ink-100">
          {cur.body}
        </div>

        {/* Footer / nav */}
        <div className="flex items-center justify-between gap-3 border-t border-white/5 bg-white/[0.02] px-8 py-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={isFirst}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
              isFirst
                ? "cursor-not-allowed border-white/5 bg-white/5 text-ink-500"
                : "border-white/10 bg-white/5 text-ink-200 hover:bg-white/10"
            )}
          >
            <ChevronLeft size={13} /> Back
          </button>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Step ${i + 1}`}
                className={clsx(
                  "h-1.5 rounded-full transition-all",
                  i === step
                    ? "w-6 bg-cyan-300"
                    : "w-1.5 bg-white/20 hover:bg-white/40"
                )}
              />
            ))}
          </div>

          {isLast ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-gradient-to-r from-cyan-400/30 to-violet-400/30 px-4 py-1.5 text-xs font-bold text-white transition hover:from-cyan-400/50 hover:to-violet-400/50 hover:shadow-glow"
            >
              Get started
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                setStep((s) => Math.min(STEPS.length - 1, s + 1))
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-cyan-300/15 px-3 py-1.5 text-xs font-bold text-cyan-200 transition hover:bg-cyan-300/25"
            >
              Next <ChevronRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ConceptRow({
  icon,
  name,
  desc,
}: {
  icon: React.ReactNode;
  name: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <div className="text-sm font-bold text-white">{name}</div>
        <div className="text-xs text-ink-300">{desc}</div>
      </div>
    </li>
  );
}

function Concept({ term, def }: { term: string; def: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
        {term}
      </div>
      <div className="mt-1 text-xs text-ink-200">{def}</div>
    </div>
  );
}
