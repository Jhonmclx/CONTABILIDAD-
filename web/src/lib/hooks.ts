import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync<T>(fn: () => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true); setError(null);
    try { const r = await fn(); if (id === seq.current) setData(r); }
    catch (e: any) { if (id === seq.current) setError(e?.message || String(e)); }
    finally { if (id === seq.current) setLoading(false); }
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, loading, error, reload: run, setData };
}

/** Lanza el error de una respuesta {data,error} para usar con useAsync. */
export function unwrap<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q); const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn); return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}
