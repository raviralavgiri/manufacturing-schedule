import { useEffect, useState } from "react";
import { useTheme } from "./theme";

export interface ChartTheme {
  axis: string;
  grid: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

/**
 * Reactive chart-theme tokens. Recharts components read these instead of
 * hardcoded colors so they flip with the global light/dark theme.
 */
export function useChartTheme(): ChartTheme {
  const { resolved } = useTheme();
  const [tokens, setTokens] = useState<ChartTheme>(() => readTokens());

  useEffect(() => {
    setTokens(readTokens());
  }, [resolved]);

  return tokens;
}

function readTokens(): ChartTheme {
  if (typeof document === "undefined") {
    return {
      axis: "#94a1bd",
      grid: "rgba(255,255,255,0.06)",
      tooltipBg: "rgba(8,13,40,0.95)",
      tooltipBorder: "rgba(255,255,255,0.15)",
      tooltipText: "#e6ebf3",
    };
  }
  const cs = getComputedStyle(document.documentElement);
  const get = (k: string, fallback: string) =>
    cs.getPropertyValue(k).trim() || fallback;
  return {
    axis: get("--chart-axis", "#94a1bd"),
    grid: get("--chart-grid", "rgba(255,255,255,0.06)"),
    tooltipBg: get("--chart-tooltip-bg", "rgba(8,13,40,0.95)"),
    tooltipBorder: get("--chart-tooltip-border", "rgba(255,255,255,0.15)"),
    tooltipText: get("--chart-tooltip-text", "#e6ebf3"),
  };
}
