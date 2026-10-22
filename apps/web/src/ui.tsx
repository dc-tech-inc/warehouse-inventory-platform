import type { ReactNode } from "react";
import type { Loadable } from "./hooks";
import { statusLabel } from "./format";

/** Renders the loading / error / empty states every data view needs, then `children(data)`. */
export function Data<T>({
  state,
  empty,
  isEmpty,
  children,
}: {
  state: Loadable<T>;
  empty: string;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") return <p className="state" role="status">Loading…</p>;
  if (state.status === "error") return <p className="state error" role="alert">{state.message}</p>;
  if (isEmpty?.(state.data)) return <p className="state">{empty}</p>;
  return <>{children(state.data)}</>;
}

export function Sku({ children }: { children: string }) {
  return <span className="sku">{children}</span>;
}

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{statusLabel(value)}</span>;
}

export function FormError({ message }: { message: string | null }) {
  return message ? <p className="error" role="alert">{message}</p> : null;
}

export function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted num">{from}–{to} of {total}</span>
      <button type="button" className="ghost" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Previous
      </button>
      <button type="button" className="ghost" disabled={to >= total} onClick={() => onChange(offset + limit)}>
        Next
      </button>
    </nav>
  );
}
