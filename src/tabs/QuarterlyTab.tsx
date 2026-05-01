import { useMemo } from "react";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import { quarterOf } from "../utils/dates";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Treemap,
} from "recharts";

interface PivotRow {
  apiId: string;
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
  const apis = useStore((s) => s.apis);
  const schedule = useStore((s) => s.schedule);

  const pivot: PivotRow[] = useMemo(() => {
    const map = new Map<string, PivotRow>();
    apis.forEach((a) =>
      a.stages.forEach((s) => {
        map.set(`${a.id}__${s.stageNo}`, {
          apiId: a.id,
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
      const q = quarterOf(b.startMs);
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
    return Array.from(map.values()).sort((a, b) =>
      a.apiId === b.apiId ? a.stageNo - b.stageNo : a.apiId.localeCompare(b.apiId)
    );
  }, [apis, schedule]);

  const quarterTotals = useMemo(() => {
    const out = [
      { name: "Q1 · Apr-Jun", batches: 0, kg: 0 },
      { name: "Q2 · Jul-Sep", batches: 0, kg: 0 },
      { name: "Q3 · Oct-Dec", batches: 0, kg: 0 },
      { name: "Q4 · Jan-Mar", batches: 0, kg: 0 },
    ];
    pivot.forEach((r) => {
      out[0].batches += r.q1.batches;
      out[0].kg += r.q1.kg;
      out[1].batches += r.q2.batches;
      out[1].kg += r.q2.kg;
      out[2].batches += r.q3.batches;
      out[2].kg += r.q3.kg;
      out[3].batches += r.q4.batches;
      out[3].kg += r.q4.kg;
    });
    return out;
  }, [pivot]);

  const treemapData = useMemo(() => {
    const byApi = new Map<string, { name: string; size: number; fill: string }>();
    pivot.forEach((r) => {
      const cur = byApi.get(r.apiId);
      if (cur) cur.size += r.total.kg;
      else
        byApi.set(r.apiId, {
          name: r.apiId,
          size: r.total.kg,
          fill: r.apiColor,
        });
    });
    return Array.from(byApi.values()).filter((d) => d.size > 0);
  }, [pivot]);

  const fyTotalKg = pivot.reduce((a, r) => a + r.total.kg, 0);
  const fyTotalBatches = pivot.reduce((a, r) => a + r.total.batches, 0);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Quarterly Summary"
        subtitle={`Batches and output (kg) per API/Stage broken down by Q1–Q4 + FY total · ${fyTotalBatches} batches · ${(fyTotalKg / 1000).toFixed(1)} t output`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-white">
            Quarterly Totals
          </h3>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={quarterTotals}>
                <CartesianGrid stroke="#ffffff10" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#94a1bd" fontSize={11} />
                <YAxis yAxisId="left" stroke="#00f0ff" fontSize={11} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#a78bfa"
                  fontSize={11}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(8,13,40,0.95)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  yAxisId="left"
                  dataKey="batches"
                  fill="#00f0ff"
                  name="Batches"
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="kg"
                  fill="#a78bfa"
                  name="Output (kg)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-white">
            FY Output by API (Treemap, kg)
          </h3>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <Treemap
                data={treemapData}
                dataKey="size"
                stroke="rgba(255,255,255,0.15)"
                content={<CustomTreemapContent />}
              />
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

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
                    <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: r.apiColor,
                          boxShadow: `0 0 6px ${r.apiColor}80`,
                        }}
                      />
                      {r.apiId}
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

interface TreemapNodeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  size?: number;
  fill?: string;
}
function CustomTreemapContent(props: TreemapNodeProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, size = 0, fill = "#888" } = props;
  if (width < 4 || height < 4) return null;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill,
          fillOpacity: 0.6,
          stroke: "rgba(255,255,255,0.2)",
          strokeWidth: 1,
        }}
      />
      {width > 50 && height > 24 && (
        <>
          <text
            x={x + 6}
            y={y + 16}
            fill="#fff"
            fontSize={11}
            fontWeight={700}
            style={{ pointerEvents: "none" }}
          >
            {name}
          </text>
          <text
            x={x + 6}
            y={y + 30}
            fill="rgba(255,255,255,0.7)"
            fontSize={10}
            style={{ pointerEvents: "none" }}
          >
            {size.toLocaleString()} kg
          </text>
        </>
      )}
    </g>
  );
}
