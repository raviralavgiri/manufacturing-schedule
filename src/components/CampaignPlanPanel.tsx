import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Card, Tag } from "./Primitives";
import type { API, PlanWindow, Reactor, ScheduleResult } from "../types";
import {
  buildCampaignReport,
  type CampaignRow,
  type CampaignStatus,
  type UtilRow,
} from "../scheduler/campaignReport";
import { fmtDate } from "../utils/dates";

/**
 * Dashboard panel for campaign-wise planning:
 *   campaign count planned vs required (per API, per quarter), every
 *   campaign's quarter / dates / status, unscheduled campaigns + reasons,
 *   intermediate completion vs earliest achievable, cleanroom + equipment
 *   utilisation, clashes and constraint report.
 */
export default function CampaignPlanPanel({
  apis,
  reactors,
  schedule,
  planWindow,
}: {
  apis: API[];
  reactors: Reactor[];
  schedule: ScheduleResult;
  planWindow: PlanWindow;
}) {
  const report = useMemo(
    () => buildCampaignReport(apis, reactors, schedule, planWindow),
    [apis, reactors, schedule, planWindow]
  );
  const [showAll, setShowAll] = useState(false);

  const statusRank: Record<CampaignStatus, number> = {
    unscheduled: 0,
    partial: 1,
    "outside-window": 2,
    spilled: 3,
    "on-target": 4,
  };
  const campaignRows = useMemo(() => {
    const rows = [...report.campaigns].sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        a.apiName.localeCompare(b.apiName) ||
        a.campaignNo - b.campaignNo
    );
    return showAll ? rows : rows.filter((r) => r.status !== "on-target");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, showAll]);

  const qLabels = report.quarters.map((q) => q.label);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Campaign plan
          </h3>
          <p className="text-[11px] text-ink-400">
            Campaign-wise quarterly distribution, earliest intermediate completion and
            shared-cleanroom loading.
          </p>
        </div>
        {report.active && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Stat
              label="Campaigns"
              value={`${report.totals.scheduled} / ${report.totals.required}`}
              tone={report.totals.scheduled === report.totals.required ? "lime" : "rose"}
            />
            <Stat
              label="In target quarter"
              value={`${report.totals.onTarget} / ${report.totals.required}`}
              tone={report.totals.onTarget === report.totals.required ? "lime" : "amber"}
            />
            <Stat
              label="Unscheduled"
              value={report.totals.unscheduled}
              tone={report.totals.unscheduled === 0 ? "lime" : "rose"}
            />
            <Stat
              label="Clashes"
              value={report.clashes.length}
              tone={report.clashes.length === 0 ? "lime" : "rose"}
            />
          </div>
        )}
      </div>

      {!report.active && (
        <div className="flex items-start gap-2 px-4 py-3 text-xs text-ink-300">
          <Info size={14} className="mt-0.5 shrink-0 text-cyan-300" />
          <span>
            No API is in campaign mode. Set <b>Camp/yr</b> on the APIs tab (e.g. 4 = one
            campaign per quarter) to schedule an API campaign-wise. Utilisation below
            covers the current schedule.
          </span>
        </div>
      )}

      {report.issues.length > 0 && (
        <div className="space-y-1 border-b border-white/10 px-4 py-3">
          <SubTitle>Scheduling constraints</SubTitle>
          {report.issues.map((i, k) => (
            <div key={k} className="flex items-start gap-2 text-xs">
              {i.severity === "error" ? (
                <XCircle size={13} className="mt-0.5 shrink-0 text-rose-300" />
              ) : i.severity === "warn" ? (
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-300" />
              ) : (
                <Info size={13} className="mt-0.5 shrink-0 text-cyan-300" />
              )}
              <span className="text-ink-200">
                {i.apiName && <b className="text-white">{i.apiName}: </b>}
                {i.msg}
              </span>
            </div>
          ))}
        </div>
      )}

      {report.active && (
        <>
          {/* Planned vs required per API and quarter */}
          <div className="overflow-x-auto border-b border-white/10 px-4 py-3">
            <SubTitle>Campaigns planned vs required</SubTitle>
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-400">
                  <th className="py-1 pr-3">API</th>
                  <th className="py-1 pr-3">Cleanroom</th>
                  <th className="py-1 pr-3 text-right">Planned / Req.</th>
                  <th className="py-1 pr-3 text-right">In target Q</th>
                  {qLabels.map((l) => (
                    <th key={l} className="py-1 pr-3 text-right" title="Scheduled (by start quarter) / required">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.apis.map((a) => (
                  <tr key={a.apiId} className="border-t border-white/5">
                    <td className="py-1.5 pr-3 font-semibold text-white">
                      <ApiDot color={a.apiColor} />
                      {a.apiName}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-ink-200">{a.cleanroom}</td>
                    <td
                      className={clsx(
                        "py-1.5 pr-3 text-right font-mono",
                        a.scheduled === a.required ? "text-lime-300" : "text-rose-300"
                      )}
                    >
                      {a.scheduled} / {a.required}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-ink-200">
                      {a.onTarget} / {a.required}
                    </td>
                    {a.requiredPerQ.map((req, q) => (
                      <td
                        key={q}
                        className={clsx(
                          "py-1.5 pr-3 text-right font-mono",
                          a.scheduledPerQ[q] === req ? "text-ink-200" : "text-amber-300"
                        )}
                      >
                        {a.scheduledPerQ[q]} / {req}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Campaign detail */}
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between">
              <SubTitle>
                {showAll ? "All campaigns" : "Unscheduled / off-target campaigns"}
              </SubTitle>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-ink-200 hover:bg-white/5"
              >
                {showAll ? "Show exceptions only" : `Show all ${report.campaigns.length}`}
              </button>
            </div>
            {campaignRows.length === 0 ? (
              <div className="flex items-center gap-2 py-2 text-xs text-lime-300">
                <CheckCircle2 size={14} /> Every campaign is scheduled in its target quarter.
              </div>
            ) : (
              <div className="max-h-80 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-ink-900/95">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-400">
                      <th className="py-1 pr-3">API</th>
                      <th className="py-1 pr-3">Cleanroom</th>
                      <th className="py-1 pr-3">Camp</th>
                      <th className="py-1 pr-3">Target Q</th>
                      <th className="py-1 pr-3">Start</th>
                      <th className="py-1 pr-3">Completion</th>
                      <th className="py-1 pr-3 text-right">Batches</th>
                      <th className="py-1 pr-3">Status</th>
                      <th className="py-1 pr-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRows.map((c) => (
                      <tr key={`${c.apiId}-${c.campaignNo}`} className="border-t border-white/5">
                        <td className="py-1.5 pr-3 font-semibold text-white">
                          <ApiDot color={c.apiColor} />
                          {c.apiName}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-ink-200">{c.cleanroom}</td>
                        <td className="py-1.5 pr-3 font-mono text-ink-200">C{c.campaignNo}</td>
                        <td className="py-1.5 pr-3 font-mono text-ink-200">
                          Q{c.targetQuarter + 1}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-ink-200">
                          {c.startMs !== null ? fmtDate(c.startMs) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-ink-200">
                          {c.endMs !== null ? fmtDate(c.endMs) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono text-ink-200">
                          {c.scheduledBatches} / {c.requiredBatches}
                        </td>
                        <td className="py-1.5 pr-3">
                          <StatusTag status={c.status} />
                        </td>
                        <td className="py-1.5 pr-3 text-ink-300">{c.reason ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Intermediate completion */}
          {report.intermediates.length > 0 && (
            <div className="overflow-x-auto border-b border-white/10 px-4 py-3">
              <SubTitle>Intermediate stage completion</SubTitle>
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-ink-400">
                    <th className="py-1 pr-3">API</th>
                    <th className="py-1 pr-3">Stage</th>
                    <th className="py-1 pr-3 text-right">Batches</th>
                    <th className="py-1 pr-3">First start</th>
                    <th className="py-1 pr-3" title="Last batch analysis end — all material released">
                      Completion
                    </th>
                    <th
                      className="py-1 pr-3"
                      title="Completion if this API had the plant to itself (no contention with other APIs)"
                    >
                      Earliest achievable
                    </th>
                    <th className="py-1 pr-3 text-right">Delay</th>
                    <th className="py-1 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.intermediates.map((r) => (
                    <tr key={r.stageId} className="border-t border-white/5">
                      <td className="py-1.5 pr-3 font-semibold text-white">{r.apiName}</td>
                      <td className="py-1.5 pr-3 text-ink-200">
                        S{r.stageNo} · {r.stageName}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-ink-200">
                        {r.scheduledBatches} / {r.plannedBatches}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-ink-200">
                        {r.firstStartMs !== null ? fmtDate(r.firstStartMs) : "—"}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-white">
                        {r.completionMs !== null ? fmtDate(r.completionMs) : "—"}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-ink-300">
                        {r.earliestCompletionMs !== null ? fmtDate(r.earliestCompletionMs) : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-ink-200">
                        {r.delayHours === null ? "—" : `${(r.delayHours / 24).toFixed(1)} d`}
                      </td>
                      <td className="py-1.5 pr-3" title={r.reason}>
                        {r.status === "earliest" ? (
                          <Tag tone="lime">Earliest</Tag>
                        ) : r.status === "delayed" ? (
                          <Tag tone="amber">Delayed</Tag>
                        ) : (
                          <Tag tone="rose">Incomplete</Tag>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Utilisation */}
      <div className="grid gap-4 px-4 py-3 lg:grid-cols-2">
        <UtilTable
          title="Cleanroom utilisation"
          rows={report.cleanrooms}
          qLabels={qLabels}
          showCampaigns={report.active}
        />
        <UtilTable title="Equipment utilisation" rows={report.equipment} qLabels={qLabels} />
      </div>
    </Card>
  );
}

function UtilTable({
  title,
  rows,
  qLabels,
  showCampaigns,
}: {
  title: string;
  rows: UtilRow[];
  qLabels: string[];
  showCampaigns?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <SubTitle>{title}</SubTitle>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-400">
          No cleanrooms defined — set a production block on the reactors (Equipment tab).
        </p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-ink-900/95">
              <tr className="text-left text-[10px] uppercase tracking-wider text-ink-400">
                <th className="py-1 pr-3">Name</th>
                {showCampaigns && <th className="py-1 pr-3 text-right">Camp.</th>}
                {qLabels.map((l) => (
                  <th key={l} className="py-1 pr-2 text-right">
                    {l}
                  </th>
                ))}
                <th className="py-1 pr-2 text-right">Year</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-white/5"
                  title={`${r.reactorCount} reactor(s) · APIs: ${r.apiNames.join(", ") || "none"}`}
                >
                  <td className="py-1.5 pr-3 font-mono text-white">
                    {r.label}
                    {r.reactorCount > 1 && (
                      <span className="ml-1 text-[10px] text-ink-400">×{r.reactorCount}</span>
                    )}
                  </td>
                  {showCampaigns && (
                    <td className="py-1.5 pr-3 text-right font-mono text-ink-200">
                      {r.campaignsRequired
                        ? `${r.campaignsScheduled}/${r.campaignsRequired}`
                        : "—"}
                    </td>
                  )}
                  {r.utilPerQ.map((u, q) => (
                    <td key={q} className="py-1.5 pr-2 text-right">
                      <Pct value={u} />
                    </td>
                  ))}
                  <td className="py-1.5 pr-2 text-right">
                    <Pct value={r.utilTotal} bold />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Pct({ value, bold }: { value: number; bold?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <span
      className={clsx(
        "font-mono tabular-nums",
        bold && "font-semibold",
        pct >= 90 ? "text-rose-300" : pct >= 70 ? "text-amber-300" : pct > 0 ? "text-ink-100" : "text-ink-500"
      )}
    >
      {pct}%
    </span>
  );
}

function StatusTag({ status }: { status: CampaignRow["status"] }) {
  switch (status) {
    case "on-target":
      return <Tag tone="lime">On target</Tag>;
    case "spilled":
      return <Tag tone="amber">Off quarter</Tag>;
    case "outside-window":
      return <Tag tone="rose">Outside window</Tag>;
    case "partial":
      return <Tag tone="rose">Partial</Tag>;
    default:
      return <Tag tone="rose">Unscheduled</Tag>;
  }
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "lime" | "amber" | "rose";
}) {
  return (
    <span
      className={clsx(
        "rounded-full border px-2.5 py-1 font-semibold",
        tone === "lime" && "border-lime-300/30 bg-lime-400/10 text-lime-300",
        tone === "amber" && "border-amber-300/30 bg-amber-400/10 text-amber-300",
        tone === "rose" && "border-rose-300/30 bg-rose-400/10 text-rose-300"
      )}
    >
      <span className="opacity-70">{label}</span>{" "}
      <span className="font-mono">{value}</span>
    </span>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-300">
      {children}
    </h4>
  );
}

function ApiDot({ color }: { color: string }) {
  return (
    <span
      className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
      style={{ background: color, boxShadow: `0 0 6px ${color}80` }}
    />
  );
}
