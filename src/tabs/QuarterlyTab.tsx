import { useMemo } from "react";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import { computeWeeks, quarterIn } from "../utils/dates";
import { useChartTheme } from "../utils/chartTheme";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

interface PivotRow {
  apiId: string;
  apiName: string;
  apiColor: string;
  stageNo: number;
  stageName: string;
  q1: { batches: number; kg: number };
  q2: { batches: number; kg: number };
  q3: { batches: number; kg: number };
  q4: { batches: number; kg: number };
  total: { batches: number; kg: number };
}

export default function QuarterlyTab() {
  const apisRaw = useStore((s) => s.apis);
  const schedule = useStore((s) => s.schedule);
  const chartTheme = useChartTheme();
  const apis = useMemo(
    () =>
      [...apisRaw].sort(
        (a, b) => a.id.localeCompare(b.id)
      ),
    [apisRaw]
  );

  const apiOrder = useMemo(() => {
    const m = new Map<string, number>();
    apis.forEach((a, i) => m.set(a.id, i));
    return m;
  }, [apis]);

  // Quarters span the global plan window, divided into 4 equal slices
  const planWindow = useStore((s) => s.window);
  const weeks = useMemo(
    () => computeWeeks(planWindow.startMs, planWindow.endMs),
    [planWindow]
  );

  const pivot: PivotRow[] = useMemo(() => {
    const map = new Map<string, PivotRow>();
    apis.forEach((a) =>
      a.stages.forEach((s) => {
        map.set(`${a.id}__${s.stageNo}`, {
          apiId: a.id,
          apiName: a.name,
          apiColor: a.color,
          stageNo: s.stageNo,
          stageName: s.stageName,
          q1: { batches: 0, kg: 0 },
          q2: { batches: 0, kg: 0 },
          q3: { batches: 0, kg: 0 },
          q4: { batches: 0, kg: 0 },
          total: { batches: 0, kg: 0 },
        });
      })
    );
    schedule.batches.forEach((b) => {
      const q = quarterIn(weeks, b.startMs);
      if (!q) return;
      const key = `${b.apiId}__${b.stageNo}`;
      const row = map.get(key);
      if (!row) return;
      const bucket = q === 1 ? "q1" : q === 2 ? "q2" : q === 3 ? "q3" : "q4";
      row[bucket].batches += 1;
      row[bucket].kg += b.outputKg;
      row.total.batches += 1;
      row.total.kg += b.outputKg;
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.apiId !== b.apiId) {
        return (
          (apiOrder.get(a.apiId) ?? 0) - (apiOrder.get(b.apiId) ?? 0)
        );
      }
      return a.stageNo - b.stageNo;
    });
  }, [apis, schedule, apiOrder, weeks]);

  // Per-quarter, per-API output (kg). Each row is one quarter; each API
  // contributes a stacked segment so the user sees both quarter totals
  // and the per-API split at a glance.
  //
  // Recharts wants the data shaped as:
  //   [
  //     { name: "Q1 · …", "API-01": 1250, "API-02": 800, ... },
  //     { name: "Q2 · …", "API-01": 980,  "API-02": 1100, ... },
  //   ]
  // and one <Bar> per API key, all using the same stackId.
  const perApiPerQuarter = useMemo(() => {
    const rows: Record<string, number | string>[] = [
      { name: "Q1 · Apr-Jun" },
      { name: "Q2 · Jul-Sep" },
      { name: "Q3 · Oct-Dec" },
      { name: "Q4 · Jan-Mar" },
    ];
    pivot.forEach((r) => {
      rows[0][r.apiId] = ((rows[0][r.apiId] as number) ?? 0) + r.q1.kg;
      rows[1][r.apiId] = ((rows[1][r.apiId] as number) ?? 0) + r.q2.kg;
      rows[2][r.apiId] = ((rows[2][r.apiId] as number) ?? 0) + r.q3.kg;
      rows[3][r.apiId] = ((rows[3][r.apiId] as number) ?? 0) + r.q4.kg;
    });
    // Make sure every API key exists on every row even if zero, so the
    // stacked bar renders cleanly.
    apis.forEach((a) => {
      rows.forEach((row) => {
        if (row[a.id] === undefined) row[a.id] = 0;
      });
    });
    return rows;
  }, [pivot, apis]);

  const fyTotalKg = pivot.reduce((a, r) => a + r.total.kg, 0);
  const fyTotalBatches = pivot.reduce((a, r) => a + r.total.batches, 0);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Quarterly Summary"
        subtitle={`Batches and output (kg) per API/Stage broken down by Q1–Q4 + FY total · ${fyTotalBatches} batches · ${(fyTotalKg / 1000).toFixed(1)} t output`}
      />

      <Card>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-white">
          Quarterly Output (kg) — stacked by API
        </h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={perApiPerQuarter}>
              <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                stroke={chartTheme.axis}
                fontSize={11}
              />
              <YAxis stroke={chartTheme.axis} fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: chartTheme.tooltipBg,
                  border: `1px solid ${chartTheme.tooltipBorder}`,
                  borderRadius: 8,
                  fontSize: 12,
                  color: chartTheme.tooltipText,
                }}
                labelStyle={{ color: chartTheme.tooltipText }}
                formatter={(v: number) => `${v.toLocaleString()} kg`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {apis.map((a) => (
                <Bar
                  key={a.id}
                  dataKey={a.id}
                  name={a.name === a.id ? a.id : `${a.name} (${a.id})`}
                  stackId="api"
                  fill={a.color}
                  radius={[0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Pivot table */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Pivot · API × Stage × Quarter
          </h3>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-ink-900/95 backdrop-blur-md">
              <tr className="text-[10px] uppercase tracking-wider text-ink-300">
                <th className="border-b border-white/10 px-3 py-2 text-left">
                  API
                </th>
                <th className="border-b border-white/10 px-3 py-2 text-left">
                  Stage
                </th>
                <PivotHead label="Q1" tone="cyan" />
                <PivotHead label="Q2" tone="violet" />
                <PivotHead label="Q3" tone="pink" />
                <PivotHead label="Q4" tone="lime" />
                <PivotHead label="FY Total" tone="amber" bold />
              </tr>
              <tr className="text-[9px] text-ink-400">
                <th className="border-b border-white/10 px-3 py-1" />
                <th className="border-b border-white/10 px-3 py-1" />
                <SubHead />
                <SubHead />
                <SubHead />
                <SubHead />
                <SubHead bold />
              </tr>
            </thead>
            <tbody>
              {pivot.map((r) => (
                <tr
                  key={`${r.apiId}-${r.stageNo}`}
                  className="border-b border-white/5 hover:bg-white/[0.04]"
                >
                  <td className="px-3 py-1.5">
                    <span
                      className="inline-flex items-center gap-1.5 font-semibold text-white"
                      title={`${r.apiName} (id: ${r.apiId})`}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: r.apiColor,
                          boxShadow: `0 0 6px ${r.apiColor}80`,
                        }}
                      />
                      {r.apiName}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-200">
                    S{r.stageNo} · {r.stageName}
                  </td>
                  <PivotCell v={r.q1} />
                  <PivotCell v={r.q2} />
                  <PivotCell v={r.q3} />
                  <PivotCell v={r.q4} />
                  <PivotCell v={r.total} bold />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-white/15 bg-ink-900/90 text-xs font-bold text-white">
                <td className="px-3 py-2" colSpan={2}>
                  TOTALS
                </td>
                <PivotCell
                  v={{
                    batches: pivot.reduce((a, r) => a + r.q1.batches, 0),
                    kg: pivot.reduce((a, r) => a + r.q1.kg, 0),
                  }}
                  bold
                />
                <PivotCell
                  v={{
                    batches: pivot.reduce((a, r) => a + r.q2.batches, 0),
                    kg: pivot.reduce((a, r) => a + r.q2.kg, 0),
                  }}
                  bold
                />
                <PivotCell
                  v={{
                    batches: pivot.reduce((a, r) => a + r.q3.batches, 0),
                    kg: pivot.reduce((a, r) => a + r.q3.kg, 0),
                  }}
                  bold
                />
                <PivotCell
                  v={{
                    batches: pivot.reduce((a, r) => a + r.q4.batches, 0),
                    kg: pivot.reduce((a, r) => a + r.q4.kg, 0),
                  }}
                  bold
                />
                <PivotCell
                  v={{
                    batches: fyTotalBatches,
                    kg: fyTotalKg,
                  }}
                  bold
                />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PivotHead({
  label,
  tone,
  bold,
}: {
  label: string;
  tone: "cyan" | "violet" | "pink" | "lime" | "amber";
  bold?: boolean;
}) {
  const tones = {
    cyan: "text-cyan-300 bg-cyan-300/5",
    violet: "text-violet-300 bg-violet-300/5",
    pink: "text-pink-300 bg-pink-300/5",
    lime: "text-lime-300 bg-lime-300/5",
    amber: "text-amber-300 bg-amber-300/10",
  };
  return (
    <th
      colSpan={2}
      className={`border-b border-white/10 px-3 py-2 text-center ${tones[tone]} ${bold ? "font-extrabold" : ""}`}
    >
      {label}
    </th>
  );
}

function SubHead({ bold }: { bold?: boolean }) {
  return (
    <>
      <th className={`border-b border-white/10 px-2 py-0.5 text-right ${bold ? "text-white" : "text-ink-400"}`}>
        Btch
      </th>
      <th className={`border-b border-white/10 px-2 py-0.5 text-right ${bold ? "text-white" : "text-ink-400"}`}>
        kg
      </th>
    </>
  );
}

function PivotCell({
  v,
  bold,
}: {
  v: { batches: number; kg: number };
  bold?: boolean;
}) {
  return (
    <>
      <td
        className={`px-2 py-1 text-right font-mono tabular-nums ${
          bold ? "font-extrabold text-amber-300" : "text-cyan-200"
        }`}
      >
        {v.batches || ""}
      </td>
      <td
        className={`px-2 py-1 text-right font-mono tabular-nums ${
          bold ? "font-extrabold text-amber-300" : "text-violet-200"
        }`}
      >
        {v.kg ? v.kg.toLocaleString() : ""}
      </td>
    </>
  );
}

