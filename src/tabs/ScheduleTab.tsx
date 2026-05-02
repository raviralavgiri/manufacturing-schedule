import { useMemo, useState, useRef, useLayoutEffect } from "react";
import { Search, Filter } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import ExportMenu from "../components/ExportMenu";
import { fmtDateTime } from "../utils/dates";
import {
  downloadCsv,
  downloadElementAsPng,
  fileStamp,
  printPage,
} from "../utils/exporters";

const ROW_H = 40;

export default function ScheduleTab() {
  const schedule = useStore((s) => s.schedule);
  const apisRaw = useStore((s) => s.apis);
  const reactors = useStore((s) => s.reactors);
  const apis = useMemo(
    () =>
      [...apisRaw].sort(
        (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
      ),
    [apisRaw]
  );
  const [q, setQ] = useState("");
  const [apiFilter, setApiFilter] = useState<string>("ALL");
  const [reactorFilter, setReactorFilter] = useState<string>("ALL");
  const [fyOnly, setFyOnly] = useState(false);

  const filtered = useMemo(() => {
    return schedule.batches.filter((b) => {
      if (apiFilter !== "ALL" && b.apiId !== apiFilter) return false;
      if (reactorFilter !== "ALL" && !b.reactorIds.includes(reactorFilter)) return false;
      if (fyOnly && !b.inFY) return false;
      if (q) {
        const lower = q.toLowerCase();
        if (
          !b.batchId.toLowerCase().includes(lower) &&
          !b.apiName.toLowerCase().includes(lower) &&
          !b.stageName.toLowerCase().includes(lower) &&
          !b.reactorId.toLowerCase().includes(lower)
        )
          return false;
      }
      return true;
    });
  }, [schedule.batches, q, apiFilter, reactorFilter, fyOnly]);

  // Simple windowed virtualization
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(640);

  useLayoutEffect(() => {
    if (scrollRef.current) {
      setViewportH(scrollRef.current.clientHeight);
    }
  }, []);

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const endIdx = Math.min(
    filtered.length,
    Math.ceil((scrollTop + viewportH) / ROW_H) + 8
  );
  const visible = filtered.slice(startIdx, endIdx);

  const tableCardRef = useRef<HTMLDivElement>(null);

  function exportCsv() {
    downloadCsv(
      `schedule_${filtered.length}rows_${fileStamp()}.csv`,
      [
        "Batch ID",
        "API ID",
        "API Name",
        "Stage",
        "Stage Name",
        "Batch #",
        "Reactor Train (IDs)",
        "Reactor Train (Names)",
        "Start",
        "End (cycle)",
        "Analysis End",
        "FY",
        "Clash",
        "Input kg",
        "Output kg",
      ],
      filtered.map((b) => [
        b.batchId,
        b.apiId,
        b.apiName,
        `Stage ${b.stageNo}`,
        b.stageName,
        b.batchNo,
        b.reactorIds.join(" + "),
        b.reactorIds
          .map((id) => reactors.find((x) => x.id === id)?.name ?? id)
          .join(" + "),
        fmtDateTime(b.startMs),
        fmtDateTime(b.endMs),
        fmtDateTime(b.analysisEndMs),
        b.inFY ? "FY" : "Ovr",
        b.clash ? "CLASH" : "OK",
        b.inputKg,
        b.outputKg,
      ])
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Schedule"
        subtitle={`${filtered.length.toLocaleString()} batches displayed · start, end, analysis dates · FY & clash flags`}
        right={
          <ExportMenu
            onCsv={exportCsv}
            onPng={async () => {
              await downloadElementAsPng(
                tableCardRef.current,
                `schedule_${filtered.length}rows_${fileStamp()}.png`,
                { backgroundColor: "#04081a", pixelRatio: 2 }
              );
            }}
            onPrint={() => printPage()}
          />
        }
      />

      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search batch / API / reactor"
              className="w-72 rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-ink-400 outline-none focus:border-cyan-300/50"
            />
          </div>
          <FilterDropdown
            label="API"
            value={apiFilter}
            onChange={setApiFilter}
            options={[
              { v: "ALL", l: "All APIs" },
              ...apis.map((a) => ({
                v: a.id,
                l: a.name === a.id ? a.id : `${a.name} (${a.id})`,
              })),
            ]}
          />
          <FilterDropdown
            label="Reactor"
            value={reactorFilter}
            onChange={setReactorFilter}
            options={[
              { v: "ALL", l: "All Reactors" },
              ...reactors.map((r) => ({
                v: r.id,
                l: r.name === r.id ? r.id : `${r.name} (${r.id})`,
              })),
            ]}
          />
          <button
            onClick={() => setFyOnly((v) => !v)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition",
              fyOnly
                ? "border-lime-300/40 bg-lime-300/10 text-lime-300"
                : "border-white/10 bg-white/5 text-ink-200 hover:bg-white/10"
            )}
          >
            <Filter size={12} /> FY only
          </button>
          <span className="ml-auto text-xs text-ink-300">
            Showing {filtered.length.toLocaleString()} /{" "}
            {schedule.batches.length.toLocaleString()}
          </span>
        </div>
      </Card>

      <div ref={tableCardRef} className="schedule-table-card">
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-[110px_72px_120px_70px_140px_180px_180px_180px_60px_60px_72px] gap-0 border-b border-white/10 bg-ink-900/80 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-300">
          <span>Batch ID</span>
          <span>API</span>
          <span>Stage</span>
          <span>#</span>
          <span>Reactor Train</span>
          <span>Start</span>
          <span>End (Cycle)</span>
          <span>Analysis End</span>
          <span className="text-center">FY</span>
          <span className="text-center">Clash</span>
          <span className="text-right">Out kg</span>
        </div>
        <div
          ref={scrollRef}
          className="relative max-h-[62vh] overflow-auto"
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          <div
            style={{ height: filtered.length * ROW_H, position: "relative" }}
          >
            <div style={{ position: "absolute", top: startIdx * ROW_H, left: 0, right: 0 }}>
              {visible.map((b) => (
                <div
                  key={b.batchId}
                  style={{ height: ROW_H }}
                  className="grid grid-cols-[110px_72px_120px_70px_140px_180px_180px_180px_60px_60px_72px] items-center gap-0 border-b border-white/5 px-3 text-xs hover:bg-white/[0.04]"
                >
                  <span className="font-mono text-[11px] text-ink-200 truncate">
                    {b.batchId}
                  </span>
                  <span
                    className="flex items-center gap-1.5 font-semibold text-white truncate"
                    title={`${b.apiName} (id: ${b.apiId})`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: b.apiColor,
                        boxShadow: `0 0 6px ${b.apiColor}80`,
                      }}
                    />
                    {b.apiName}
                  </span>
                  <span className="text-ink-200 truncate">
                    S{b.stageNo} · {b.stageName}
                  </span>
                  <span className="font-mono text-ink-300">{b.batchNo}</span>
                  <span
                    className="font-mono font-semibold text-cyan-300 truncate"
                    title={`Reactor train: ${b.reactorIds
                      .map((id) => {
                        const r = reactors.find((x) => x.id === id);
                        return r && r.name !== id ? `${r.name} (${id})` : id;
                      })
                      .join(" + ")}`}
                  >
                    {b.reactorIds
                      .map((id) => reactors.find((x) => x.id === id)?.name ?? id)
                      .join(", ")}
                  </span>
                  <span className="font-mono text-ink-200 truncate">
                    {fmtDateTime(b.startMs)}
                  </span>
                  <span className="font-mono text-ink-200 truncate">
                    {fmtDateTime(b.endMs)}
                  </span>
                  <span className="font-mono text-ink-300 truncate">
                    {fmtDateTime(b.analysisEndMs)}
                  </span>
                  <span className="text-center">
                    {b.inFY ? (
                      <Tag tone="lime">FY</Tag>
                    ) : (
                      <Tag tone="amber">Ovr</Tag>
                    )}
                  </span>
                  <span className="text-center">
                    {b.clash ? (
                      <Tag tone="rose">CLASH</Tag>
                    ) : (
                      <Tag tone="default">OK</Tag>
                    )}
                  </span>
                  <span className="text-right font-mono font-semibold tabular-nums text-white">
                    {b.outputKg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
      </div>
    </div>
  );
}

function FilterDropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs">
      <span className="text-ink-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent font-semibold text-white outline-none"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v} className="bg-ink-900">
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}
