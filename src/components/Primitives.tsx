import { clsx } from "clsx";
import type { ReactNode } from "react";

export function Card({
  children,
  className,
  strong,
  glow,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
  glow?: "cyan" | "violet";
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl p-5",
        strong ? "glass-strong" : "glass",
        glow === "cyan" && "shadow-glow",
        glow === "violet" && "shadow-glowViolet",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Pill({
  label,
  value,
  tone = "default",
  icon,
  pulse,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "cyan" | "violet" | "lime" | "amber" | "pink";
  icon?: ReactNode;
  pulse?: boolean;
}) {
  const toneCls: Record<string, string> = {
    default: "text-ink-100 bg-white/5 border-white/10",
    cyan: "text-cyan-300 bg-cyan-400/10 border-cyan-300/30",
    violet: "text-violet-300 bg-violet-400/10 border-violet-300/30",
    lime: "text-lime-300 bg-lime-400/10 border-lime-300/30",
    amber: "text-amber-300 bg-amber-400/10 border-amber-300/30",
    pink: "text-pink-300 bg-pink-400/10 border-pink-300/30",
  };
  return (
    <div
      className={clsx(
        "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold backdrop-blur-md transition-all",
        toneCls[tone],
        pulse && "pulse-glow"
      )}
    >
      {icon && <span className="opacity-80">{icon}</span>}
      <span className="opacity-70">{label}</span>
      <span className="font-mono tabular-nums tracking-tight">{value}</span>
    </div>
  );
}

export function Tag({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "lime" | "amber" | "rose" | "violet" | "cyan";
  className?: string;
}) {
  const toneCls: Record<string, string> = {
    default: "bg-white/5 border-white/10 text-ink-200",
    lime: "bg-lime-400/15 border-lime-300/40 text-lime-300",
    amber: "bg-amber-400/15 border-amber-300/40 text-amber-300",
    rose: "bg-rose-400/15 border-rose-300/40 text-rose-300",
    violet: "bg-violet-400/15 border-violet-300/40 text-violet-300",
    cyan: "bg-cyan-400/15 border-cyan-300/40 text-cyan-300",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        toneCls[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-ink-300">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
