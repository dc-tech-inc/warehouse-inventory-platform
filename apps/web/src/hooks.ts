import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api/client";

export type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/**
 * Runs `load` whenever `key` changes or `reload()` is called. State is only set from the promise callbacks,
 * and results from a superseded request are dropped, so a slow response never overwrites a newer one.
 * While a new key loads, the previous data stays on screen (status "ready") so tables do not flash empty.
 */
export function useLoad<T>(key: string, load: () => Promise<T>): { state: Loadable<T>; reload: () => void } {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let live = true;
    loadRef.current().then(
      (data) => live && setState({ status: "ready", data }),
      (err: unknown) => live && setState({ status: "error", message: errorMessage(err) }),
    );
    return () => {
      live = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { state, reload };
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Could not reach the server";
}

/** Wraps an action so its button can show a busy state and the form can show the error text. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clearError: () => setError(null) };
}
