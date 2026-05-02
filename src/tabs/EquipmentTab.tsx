import { useMemo } from "react";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import { FY_WEEKS, WEEKS_IN_FY } from "../utils/dates";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Area,
  ComposedChart,
} from "recharts";

const HOURS_PER_WEEK = 7 * 24;

export default function EquipmentTab() {
  const reactors = useStore((s) => s.reactors);
  const schedule = useStore((s) => s.schedule);

  const utilByReactor = useMemo(() => {
    return reactors.map((r, i) => {
      const weekHours = schedule.weeklyReactorOccupancy[i];
      const total = weekHours.reduce((a, b) => a + b, 0);
      const cap = WEEKS_IN_FY * HOURS_PER_WEEK;
      const util = (total / cap) * 100;
      return {
        id: r.id,
        name: r.name,
        cls: r.reactorClass,
        shared: r.shared,
        util: Math.min(util, 100),
        batchCount: schedule.reactorUsage[r.id]?.batchCount ?? 0,
        busyHours: total,
        weekHours,
      };
    });
  }, [reactors, schedule]);

  const trend = useMemo(() => {
    return FY_WEEKS.map((w, i) => {
      const totalHrs = schedule.weeklyReactorOccupancy.reduce(
        (acc, row) => acc + row[i],
        0
      );
      const capHrs = reactors.length * HOURS_PER_WEEK;
      return {
        week: w.label,
        idx: i,
        utilPct: Math.min((totalHrs / capHrs) * 100, 100),
        batches: schedule.batches.filter((b) => {
          const start = new Date(b.startMs);
          const wkStart = w.start.getTime();
          const wkEnd = wkStart + 7 * 24 * 3600 * 1000;
          return b.startMs >= wkStart && b.startMs < wkEnd;
        }).length,
      };
    });
  }, [schedule, reactors]);

  const avgUtil =
    utilByReactor.reduce((a, r) => a + r.util, 0) / utilByReactor.length;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Equipment Dashboard"
        subtitle={`Reactor occupancy across 52 weeks. ${utilByReactor.length} reactors · avg util ${avgUtil.toFixed(1)}%`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Heatmap */}
        <Card className="lg:col-span-2 overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Occupancy Heatmap · Reactor × Week
            </h3>
            <div className="flex items-center gap-2 text-[10px] text-ink-300">
              <HeatLegend />
            </div>
          </div>
          <div className="overflow-auto p-3">
            <Heatmap util={utilByReactor} />
          </div>
        </Card>

        {/* Util bars */}
        <Card className="p-0">
          <div className="border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Per-Reactor Utilization
            </h3>
          </div>
          <div className="space-y-1.5 p-4">
            {utilByReactor.map((r) => (
              <div key={r.id} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span
                    className="flex items-center gap-1.5 font-mono font-semibold text-white truncate"
                    title={r.name === r.id ? r.id : `${r.name} (id: ${r.id})`}
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="text-[9px] uppercase text-ink-400">
                      {r.cls}
                    </span>
                    {r.shared && <Tag tone="violet">SHARED</Tag>}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-cyan-300">
                    {r.util.toFixed(1)}%
                  </span>
                </div>
                <div className="relative h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    style={{ width: `${r.util}%` }}
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400 shadow-[0_0_8px_rgba(0,240,255,0.5)]"
                  />
                </div>
                <div className="flex justify-between text-[9px] text-ink-400">
                  <span>{r.batchCount} batches</span>
                  <span>{Math.round(r.busyHours)}h busy</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Weekly trend */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Fleet Utilization Trend (Weekly)
          </h3>
          <span className="text-[11px] text-ink-300">
            Total reactor-hours used / available
          </span>
        </div>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <ComposedChart data={trend}>
              <defs>
                <linearGradient id="utilGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00f0ff" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#00f0ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ffffff10" strokeDasharray="3 3" />
              <XAxis
                dataKey="week"
                stroke="#94a1bd"
                fontSize={10}
                interval={3}
              />
              <YAxis stroke="#94a1bd" fontSize={10} unit="%" />
              <Tooltip
                contentStyle={{
                  background: "rgba(8,13,40,0.95)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelStyle={{ color: "#e6ebf3" }}
              />
              <Area
                type="monotone"
                dataKey="utilPct"
                stroke="#00f0ff"
                fill="url(#utilGrad)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="utilPct"
                stroke="#a78bfa"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4, fill: "#f472b6" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Heatmap({
  util,
}: {
  util: { id: string; name: string; cls: string; weekHours: number[] }[];
}) {
  const cellW = 16;
  const cellH = 18;
  return (
    <div className="inline-block">
      {/* Top header (weeks) */}
      <div className="flex">
        <div style={{ width: 90 }} />
        {FY_WEEKS.map((w, i) => (
          <div
            key={i}
            style={{ width: cellW }}
            className={clsxLite(
              "shrink-0 text-center font-mono",
              i % 4 === 0 ? "text-[8px] text-ink-300" : "text-transparent"
            )}
          >
            {i % 4 === 0 ? w.label.split(" ")[0] : "·"}
          </div>
        ))}
      </div>
      {util.map((r) => {
        const maxHrs = Math.max(...r.weekHours, 1);
        const totalCap = HOURS_PER_WEEK; // weekly cap
        return (
          <div key={r.id} className="flex items-center">
            <div
              style={{ width: 90 }}
              className="shrink-0 truncate py-0.5 pr-2 text-right font-mono text-[10px] font-semibold text-white"
              title={r.name === r.id ? r.id : `${r.name} (id: ${r.id})`}
            >
              {r.name}
            </div>
            {r.weekHours.map((h, i) => {
              const pct = Math.min(h / totalCap, 1);
              const bg = heatColor(pct);
              return (
                <div
                  key={i}
                  style={{
                    width: cellW - 1,
                    height: cellH,
                    margin: "1px 0.5px",
                    background: bg,
                    boxShadow:
                      pct > 0.6
                        ? `inset 0 0 4px rgba(255,255,255,0.25)`
                        : undefined,
                  }}
                  className="rounded-[3px] transition hover:scale-110 hover:ring-1 hover:ring-white"
                  title={`${r.name === r.id ? r.id : `${r.name} (id: ${r.id})`} · ${FY_WEEKS[i].label}: ${h.toFixed(1)} hrs (${(pct * 100).toFixed(0)}%) · max=${maxHrs.toFixed(0)}h`}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function HeatLegend() {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-1">
      <span>idle</span>
      <div className="flex">
        {stops.map((s, i) => (
          <span
            key={i}
            className="h-3 w-5 rounded-sm border border-white/5"
            style={{ background: heatColor(s) }}
          />
        ))}
      </div>
      <span>full</span>
    </div>
  );
}

function heatColor(pct: number): string {
  // 0 -> dark navy, 0.5 -> violet, 1 -> hot pink/cyan
  if (pct <= 0.001) return "rgba(255,255,255,0.04)";
  const r = Math.round(20 + pct * 230);
  const g = Math.round(30 + pct * 70);
  const b = Math.round(80 + (1 - pct) * 140);
  // mix in some cyan->violet->pink hue
  if (pct > 0.66) return `rgba(244, 114, 182, ${0.35 + pct * 0.6})`;
  if (pct > 0.33) return `rgba(167, 139, 250, ${0.3 + pct * 0.55})`;
  return `rgba(0, 240, 255, ${0.18 + pct * 0.6})`;
}

function clsxLite(...args: (string | false | undefined | null)[]): string {
  return args.filter(Boolean).join(" ");
}
