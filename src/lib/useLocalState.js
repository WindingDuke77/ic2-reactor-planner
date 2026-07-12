"use client";

import { useCallback, useEffect, useState } from "react";

function read(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function useLocalState(key, fallback) {
  const [value, setValue] = useState(fallback);

  // Hydrate after mount to avoid SSR mismatch
  useEffect(() => {
    setValue(read(key, fallback));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next) => {
      setValue((prev) => {
        const computed = typeof next === "function" ? next(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(computed));
        } catch {}
        return computed;
      });
    },
    [key]
  );

  return [value, update];
}
