// Tiny pub-sub hook for UI-only preferences that don't belong in the data
// store (they're not part of the project payload — they're per-browser).
// Currently only powers the "Show IDs" toggle that lives in the headers of
// the APIs and Schedule tabs.

import { useEffect, useState } from "react";

const SHOW_IDS_KEY = "pharma:showIds:v1";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(SHOW_IDS_KEY) === "1";
  } catch {
    return false;
  }
}

function write(v: boolean): void {
  try {
    window.localStorage.setItem(SHOW_IDS_KEY, v ? "1" : "0");
  } catch {
    // ignore — private mode etc.
  }
  listeners.forEach((l) => l());
}

/**
 * Returns [showIds, setShowIds]. Multiple components stay in sync because
 * every setter call notifies the in-process subscribers.
 */
export function useShowIds(): [boolean, (v: boolean) => void] {
  const [val, setVal] = useState<boolean>(() => read());
  useEffect(() => {
    const cb = () => setVal(read());
    listeners.add(cb);
    // Cross-tab sync via the storage event:
    const onStorage = (e: StorageEvent) => {
      if (e.key === SHOW_IDS_KEY) setVal(read());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [val, write];
}
