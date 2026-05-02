import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "pharma:theme:v1";

/** Read the saved choice (defaults to "system" — follows OS preference). */
export function readSavedChoice(): ThemeChoice {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

export function saveChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // ignore
  }
}

/** Resolve a choice to a concrete theme (system → media query). */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "system") {
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      return "light";
    }
    return "dark";
  }
  return choice;
}

/** Apply the resolved theme to <html data-theme="..."> immediately. */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
  // Helps native form controls and scrollbars match the theme
  document.documentElement.style.colorScheme = resolved;
}

/**
 * React hook: returns the current ThemeChoice + the resolved theme +
 * a setter that persists. Listens to OS-level changes when on "system".
 */
export function useTheme(): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readSavedChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(choice)
  );

  // Apply theme whenever the choice changes
  useEffect(() => {
    const next = resolveTheme(choice);
    setResolved(next);
    applyTheme(next);
  }, [choice]);

  // If user picked "system", react to OS-level changes live
  useEffect(() => {
    if (choice !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      const next = resolveTheme("system");
      setResolved(next);
      applyTheme(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [choice]);

  const setChoice = (c: ThemeChoice) => {
    saveChoice(c);
    setChoiceState(c);
  };

  return { choice, resolved, setChoice };
}
