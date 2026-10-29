import { useEffect, useState } from 'react';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  window.scrollTo({ top: 0 });
  notify();
}

export function useLocation() {
  const [loc, setLoc] = useState({ path: location.pathname, search: location.search, hash: location.hash });
  useEffect(() => {
    const fn = () => setLoc({ path: location.pathname, search: location.search, hash: location.hash });
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return loc;
}

export function useQueryParam(name: string): string | null {
  const { search } = useLocation();
  return new URLSearchParams(search).get(name);
}

/** Compara una ruta con un patrón tipo /f/:slug y devuelve los parámetros. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p[p.length - 1] === '*') { if (s.length < p.length - 1) return null; }
  else if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') break;
    if (p[i].startsWith(':')) out[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return out;
}

export function Link(props: { to: string; className?: string; children?: any; onClick?: () => void; title?: string; 'aria-current'?: any }) {
  const { to, children, onClick, ...rest } = props;
  return (
    <a href={to} {...rest} onClick={(e: any) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault(); onClick?.(); navigate(to);
    }}>{children}</a>
  );
}
