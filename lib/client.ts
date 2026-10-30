"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** "local" = static build (GitHub Pages): data is kept in this browser via lib/local-api. */
export const LOCAL_MODE = process.env.NEXT_PUBLIC_DATA_MODE === "local";

export class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  if (LOCAL_MODE) {
    const { localApi, LocalApiError } = await import("./local-api");
    try {
      return await localApi<T>(url, opts);
    } catch (e) {
      if (e instanceof LocalApiError) throw new HttpError(e.status, e.message, { error: e.message });
      throw e;
    }
  }
  const res = await fetch(url, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, json.error ?? `Request failed (${res.status})`, json);
  return json as T;
}

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(url);
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Triggers a browser download of an export. */
export async function download(url: string) {
  if (LOCAL_MODE) {
    const u = new URL(url, "http://local");
    if (u.pathname !== "/api/reports/register") throw new Error("This export is not available in the online version");
    const { registerCsv } = await import("./local-api");
    const { name, csv } = registerCsv(Number(u.searchParams.get("year")), Number(u.searchParams.get("month")));
    return saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), name);
  }
  const res = await fetch(url);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? "Export failed");
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "export";
  saveBlob(blob, name);
}

export { saveBlob };
