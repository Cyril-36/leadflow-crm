"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs`. Null until mounted, so relative times are
 * only ever rendered in the browser (no server/client mismatch).
 */
export function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
