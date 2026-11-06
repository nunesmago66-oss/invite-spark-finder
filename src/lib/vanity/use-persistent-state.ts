import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

type StoreKind = "local" | "session";

function getStore(kind: StoreKind): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Hydration-safe persisted state: renders `initial` on the server, loads storage after mount. */
export function usePersistentState<T>(
  key: string,
  initial: T,
  kind: StoreKind = "local",
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const store = getStore(kind);
    try {
      const raw = store?.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* corrupted value: keep initial */
    }
    setHydrated(true);
  }, [key, kind]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      getStore(kind)?.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable */
    }
  }, [key, kind, value, hydrated]);

  return [value, setValue, hydrated];
}
