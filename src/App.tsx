import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Beaker,
  CalendarDays,
  CheckCircle2,
  Database,
  FlaskConical,
  Gauge,
  LayoutGrid,
  Sparkles,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "./store";
import { Pill } from "./components/Primitives";
import SyncBadge from "./components/SyncBadge";
import ThemeToggle from "./components/ThemeToggle";
import ProjectSwitcher from "./components/ProjectSwitcher";
import ApisTab from "./tabs/ApisTab";
import StagesTab from "./tabs/StagesTab";
import MasterReactorTab from "./tabs/MasterReactorTab";
import ScheduleTab from "./tabs/ScheduleTab";
import GanttTab from "./tabs/GanttTab";
import EquipmentTab from "./tabs/EquipmentTab";
import ClashTab from "./tabs/ClashTab";
import QuarterlyTab from "./tabs/QuarterlyTab";

type TabId =
  | "apis"
  | "stages"
  | "reactors"
  | "schedule"
  | "gantt"
  | "equipment"
  | "clash"
  | "quarterly";

const TABS: {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  accent: string;
  desc: string;
}[] = [
  {
    id: "apis",
    label: "APIs",
    icon: <FlaskConical size={18} />,
    accent: "amber",
    desc: "API name, target qty, priority",
  },
  {
    id: "stages",
    label: "Stages",
    icon: <Database size={18} />,
    accent: "amber",
    desc: "Per-stage operational details",
  },
  {
    id: "reactors",
    label: "Master Reactor",
    icon: <Beaker size={18} />,
    accent: "cyan",
    desc: "Manage the reactor fleet",
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: <CalendarDays size={18} />,
    accent: "cyan",
    desc: "All batches with dates & flags",
  },
  {
    id: "gantt",
    label: "Gantt Chart",
    icon: <LayoutGrid size={18} />,
    accent: "violet",
    desc: "Weekly Apr 26 – Mar 27",
  },
  {
    id: "equipment",
    label: "Equipment",
    icon: <Gauge size={18} />,
    accent: "cyan",
    desc: "20-reactor occupancy heatmap",
  },
  {
    id: "clash",
    label: "Clash Report",
    icon: <CheckCircle2 size={18} />,
    accent: "lime",
    desc: "Zero-clash sequencer proof",
  },
  {
    id: "quarterly",
    label: "Quarterly Summary",
    icon: <BarChart3 size={18} />,
    accent: "lime",
    desc: "Q1–Q4 + FY totals",
  },
];

export default function App() {
  const [active, setActive] = useState<TabId>("apis");
  const schedule = useStore((s) => s.schedule);
  const reactors = useStore((s) => s.reactors);
  const apis = useStore((s) => s.apis);
  const isRecomputing = useStore((s) => s.isRecomputing);

  return (
    <div className="min-h-screen w-full">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-ink-950/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-cyan-400/30 ring-1 ring-white/10">
              <FlaskConical className="text-cyan-300" size={20} />
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-lime-400 shadow-[0_0_8px_2px_rgba(163,230,53,0.7)]" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white sm:text-lg">
                API Manufacturing Schedule
              </h1>
              <p className="-mt-0.5 text-[11px] uppercase tracking-[0.2em] text-ink-300">
                Pharma Production Planner
              </p>
            </div>
            <div className="ml-3 hidden sm:block">
              <ProjectSwitcher />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="block sm:hidden">
              <ProjectSwitcher />
            </div>
            <Pill
              label="Batches"
              value={schedule.totalBatches}
              tone="default"
              icon={<Activity size={12} />}
            />
            <Pill
              label="In FY"
              value={schedule.fyBatches}
              tone="cyan"
              icon={<CalendarDays size={12} />}
            />
            <Pill
              label="Overflow"
              value={schedule.overflowBatches}
              tone="amber"
              icon={<AlertTriangle size={12} />}
            />
            <Pill
              label="Clashes"
              value={schedule.clashCount}
              tone={schedule.clashCount === 0 ? "lime" : "pink"}
              icon={<CheckCircle2 size={12} />}
              pulse={schedule.clashCount === 0}
            />
            <Pill
              label="Reactors"
              value={reactors.length}
              tone="violet"
              icon={<Sparkles size={12} />}
            />
            <Pill
              label="APIs"
              value={apis.length}
              tone="default"
              icon={<FlaskConical size={12} />}
            />
            {isRecomputing && (
              <span className="ml-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-300">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-cyan-300" />
                Recomputing…
              </span>
            )}
            <SyncBadge />
            <ThemeToggle />
          </div>
        </div>

        {/* Tabs */}
        <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 pb-3">
          {TABS.map((t) => {
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={clsx(
                  "group relative flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                  isActive
                    ? "border-white/15 bg-white/8 text-white shadow-glow"
                    : "border-white/5 bg-white/0 text-ink-300 hover:border-white/10 hover:bg-white/5 hover:text-white"
                )}
              >
                <span
                  className={clsx(
                    "transition-transform",
                    isActive && "scale-110 text-cyan-300"
                  )}
                >
                  {t.icon}
                </span>
                <span>{t.label}</span>
                {isActive && (
                  <span className="absolute -bottom-[10px] left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-400 via-cyan-300 to-lime-300 shadow-[0_0_12px_2px_rgba(0,240,255,0.6)]" />
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <div key={active} className="animate-fade-in">
          {active === "apis" && <ApisTab />}
          {active === "stages" && <StagesTab />}
          {active === "reactors" && <MasterReactorTab />}
          {active === "schedule" && <ScheduleTab />}
          {active === "gantt" && <GanttTab />}
          {active === "equipment" && <EquipmentTab />}
          {active === "clash" && <ClashTab />}
          {active === "quarterly" && <QuarterlyTab />}
        </div>
      </main>

      <footer className="mx-auto max-w-[1600px] px-6 py-8 text-center text-[11px] uppercase tracking-[0.25em] text-ink-400">
        Built for pharmaceutical campaign planning · Reactive client-side scheduler · v0.1
      </footer>
    </div>
  );
}
