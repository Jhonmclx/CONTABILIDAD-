// Cliente ligero para Supabase (Auth, PostgREST, Storage, Functions) basado en fetch.
// Solo usa la clave publicable: toda la seguridad se aplica en el servidor (RLS + funciones).
import { CONFIG } from './config';

export interface User { id: string; email: string; email_confirmed_at?: string | null; user_metadata?: Record<string, any> }
export interface Session { access_token: string; refresh_token: string; expires_at: number; user: User }
export interface SbError { message: string; code?: string; details?: string; hint?: string; status?: number }
export interface Result<T> { data: T | null; error: SbError | null; count?: number | null }

const KEY = 'cd.session';
const store = {
  get(): Session | null { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(s: Session | null) { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* almacenamiento no disponible */ } },
};

function friendly(e: SbError): SbError {
  const m = e.message || '';
  if (/row-level security/i.test(m) || e.code === '42501') return { ...e, message: 'No tiene permiso para realizar esta operación.' };
  if (e.code === '23505') return { ...e, message: 'Ya existe un registro con esos datos (duplicado).' };
  if (e.code === '23503') return { ...e, message: 'El registro está relacionado con otros datos y no se puede completar la operación.' };
  if (e.code === '23514') return { ...e, message: 'Algún dato no cumple las validaciones (revise formatos y valores).' };
  if (/Invalid login credentials/i.test(m)) return { ...e, message: 'Correo o contraseña incorrectos.' };
  if (/Email not confirmed/i.test(m)) return { ...e, message: 'Debe confirmar su correo antes de ingresar.' };
  if (/User already registered/i.test(m)) return { ...e, message: 'Ese correo ya tiene una cuenta.' };
  if (/Password should be/i.test(m)) return { ...e, message: 'La contraseña no cumple los requisitos mínimos.' };
  if (/rate limit/i.test(m)) return { ...e, message: 'Demasiados intentos. Espere unos minutos.' };
  return e;
}

async function parseError(res: Response): Promise<SbError> {
  let body: any = {};
  try { body = await res.json(); } catch { /* sin cuerpo */ }
  return friendly({
    message: body.message || body.msg || body.error_description || body.error || `Error ${res.status}`,
    code: body.code || body.error_code, details: body.details, hint: body.hint, status: res.status,
  });
}

type Listener = (s: Session | null) => void;

class Auth {
  session: Session | null = store.get();
  private listeners = new Set<Listener>();
  private timer: any = null;
  private refreshing: Promise<void> | null = null;

  constructor() { this.schedule(); }

  onChange(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((l) => l(this.session)); }

  private setSession(s: Session | null) {
    this.session = s; store.set(s); this.schedule(); this.emit();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (!this.session) return;
    const ms = Math.min(2_000_000_000, Math.max(5_000, this.session.expires_at * 1000 - Date.now() - 60_000));
    this.timer = setTimeout(() => { this.refresh().catch(() => {}); }, ms);
  }

  private fromTokenResponse(b: any): Session {
    return { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (b.expires_in || 3600), user: b.user };
  }

  private async call(path: string, init: RequestInit, auth = false): Promise<any> {
    const headers: Record<string, string> = { apikey: CONFIG.anonKey, 'Content-Type': 'application/json' };
    if (auth && this.session) headers.Authorization = `Bearer ${await this.token()}`;
    const res = await fetch(`${CONFIG.url}/auth/v1${path}`, { ...init, headers });
    if (!res.ok) throw await parseError(res);
    const t = await res.text();
    return t ? JSON.parse(t) : {};
  }

  async signUp(email: string, password: string, fullName: string, redirectTo: string) {
    const b = await this.call(`/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST', body: JSON.stringify({ email, password, data: { full_name: fullName } }),
    });
    if (b.access_token) this.setSession(this.fromTokenResponse(b));
    return { needsConfirmation: !b.access_token };
  }

  async signIn(email: string, password: string) {
    const b = await this.call('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!b?.access_token) throw { message: 'Respuesta de autenticación inválida' };
    this.setSession(this.fromTokenResponse(b));
  }

  async refresh() {
    if (!this.session) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const b = await this.call('/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: this.session!.refresh_token }) });
        if (!b?.access_token || !b?.user?.id) throw { message: 'Sesión inválida', status: 401 };
        this.setSession(this.fromTokenResponse(b));
      } catch (e: any) {
        if (e?.status === 400 || e?.status === 401) this.setSession(null);
        throw e;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }

  async token(): Promise<string | null> {
    if (!this.session) return null;
    if (this.session.expires_at * 1000 - Date.now() < 30_000) { try { await this.refresh(); } catch { return null; } }
    return this.session?.access_token ?? null;
  }

  async signOut() {
    try { await this.call('/logout', { method: 'POST' }, true); } catch { /* la sesión local se elimina igual */ }
    this.setSession(null);
  }

  async recover(email: string, redirectTo: string) {
    await this.call(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: JSON.stringify({ email }) });
  }

  async updatePassword(password: string) {
    const u = await this.call('/user', { method: 'PUT', body: JSON.stringify({ password }) }, true);
    if (this.session) this.setSession({ ...this.session, user: u });
  }

  /** Procesa los tokens que llegan en la URL tras confirmar correo o recuperar contraseña. */
  handleRedirect(): string | null {
    const h = window.location.hash;
    if (!h.includes('access_token=') && !h.includes('error=')) return null;
    const p = new URLSearchParams(h.slice(1));
    history.replaceState(null, '', window.location.pathname + window.location.search);
    if (p.get('error')) return 'error:' + (p.get('error_description') || p.get('error'));
    const s: Session = {
      access_token: p.get('access_token')!, refresh_token: p.get('refresh_token')!,
      expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600),
      user: decodeUser(p.get('access_token')!),
    };
    this.setSession(s);
    this.call('/user', { method: 'GET' }, true).then((u) => this.session && this.setSession({ ...this.session, user: u })).catch(() => {});
    return p.get('type');
  }
}

function decodeUser(jwt: string): User {
  try {
    const p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { id: p.sub, email: p.email, user_metadata: p.user_metadata };
  } catch { return { id: '', email: '' }; }
}

export const auth = new Auth();

async function headers(extra: Record<string, string> = {}) {
  const t = await auth.token();
  return { apikey: CONFIG.anonKey, Authorization: `Bearer ${t || CONFIG.anonKey}`, ...extra };
}

const enc = (v: any) => (v === null ? 'null' : String(v));
const quote = (v: any) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export class Query<T = any> implements PromiseLike<Result<T>> {
  private method: Method = 'GET';
  private params = new URLSearchParams();
  private body: any;
  private prefer: string[] = [];
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private range?: [number, number];
  constructor(private table: string) {}

  select(cols = '*', opts?: { count?: 'exact' }) {
    this.params.set('select', cols.replace(/\s+/g, ''));
    if (opts?.count) this.prefer.push(`count=${opts.count}`);
    if (this.method !== 'GET') this.prefer.push('return=representation');
    return this;
  }
  eq(c: string, v: any) { this.params.append(c, `eq.${enc(v)}`); return this; }
  neq(c: string, v: any) { this.params.append(c, `neq.${enc(v)}`); return this; }
  gt(c: string, v: any) { this.params.append(c, `gt.${enc(v)}`); return this; }
  gte(c: string, v: any) { this.params.append(c, `gte.${enc(v)}`); return this; }
  lt(c: string, v: any) { this.params.append(c, `lt.${enc(v)}`); return this; }
  lte(c: string, v: any) { this.params.append(c, `lte.${enc(v)}`); return this; }
  is(c: string, v: null | boolean) { this.params.append(c, `is.${v}`); return this; }
  in(c: string, vs: any[]) { this.params.append(c, `in.(${vs.map(quote).join(',')})`); return this; }
  like(c: string, pattern: string) { this.params.append(c, `like.${pattern}`); return this; }
  ilike(c: string, pattern: string) { this.params.append(c, `ilike.${pattern.replace(/[(),]/g, ' ')}`); return this; }
  contains(c: string, vs: any[]) { this.params.append(c, `cs.{${vs.map(quote).join(',')}}`); return this; }
  or(expr: string) { this.params.append('or', `(${expr})`); return this; }
  order(c: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const prev = this.params.get('order');
    const v = `${c}.${o.ascending === false ? 'desc' : 'asc'}${o.nullsFirst ? '.nullsfirst' : ''}`;
    this.params.set('order', prev ? `${prev},${v}` : v); return this;
  }
  limit(n: number) { this.params.set('limit', String(n)); return this; }
  paginate(from: number, to: number) { this.range = [from, to]; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  insert(rows: any, opts: { returning?: boolean } = {}) {
    this.method = 'POST'; this.body = rows;
    this.prefer.push(opts.returning ? 'return=representation' : 'return=minimal'); return this;
  }
  upsert(rows: any, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.method = 'POST'; this.body = rows;
    this.prefer.push(`resolution=${opts.ignoreDuplicates ? 'ignore' : 'merge'}-duplicates`, 'return=minimal');
    if (opts.onConflict) this.params.set('on_conflict', opts.onConflict);
    return this;
  }
  update(values: any) { this.method = 'PATCH'; this.body = values; this.prefer.push('return=minimal'); return this; }
  delete() { this.method = 'DELETE'; this.prefer.push('return=minimal'); return this; }

  async run(): Promise<Result<T>> {
    const prefer = Array.from(new Set(this.prefer));
    if (prefer.includes('return=representation')) { const i = prefer.indexOf('return=minimal'); if (i >= 0) prefer.splice(i, 1); }
    const h: Record<string, string> = await headers({ 'Content-Type': 'application/json' });
    if (prefer.length) h.Prefer = prefer.join(',');
    if (this.mode !== 'many') h.Accept = 'application/vnd.pgrst.object+json';
    if (this.range) h.Range = `${this.range[0]}-${this.range[1]}`;
    try {
      const qs = this.params.toString();
      const res = await fetch(`${CONFIG.url}/rest/v1/${this.table}${qs ? '?' + qs : ''}`, {
        method: this.method, headers: h, body: this.body !== undefined ? JSON.stringify(this.body) : undefined,
      });
      if (this.mode === 'maybe' && res.status === 406) return { data: null, error: null };
      if (!res.ok) return { data: null, error: await parseError(res) };
      const cr = res.headers.get('content-range');
      const count = cr && cr.includes('/') ? Number(cr.split('/')[1]) || 0 : null;
      const t = await res.text();
      return { data: t ? JSON.parse(t) : null, error: null, count };
    } catch (e: any) {
      return { data: null, error: { message: 'No hay conexión con el servidor. Verifique su internet.' } };
    }
  }
  then<A = Result<T>, B = never>(ok?: ((v: Result<T>) => A | PromiseLike<A>) | null, bad?: ((r: any) => B | PromiseLike<B>) | null) {
    return this.run().then(ok as any, bad as any) as any;
  }
}

export const db = {
  from<T = any>(table: string) { return new Query<T>(table); },
  async rpc<T = any>(fn: string, args: Record<string, any> = {}): Promise<Result<T>> {
    try {
      const res = await fetch(`${CONFIG.url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: await headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(args),
      });
      if (!res.ok) return { data: null, error: await parseError(res) };
      const t = await res.text();
      return { data: t ? JSON.parse(t) : null, error: null };
    } catch { return { data: null, error: { message: 'No hay conexión con el servidor.' } }; }
  },
};

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export const storage = {
  async upload(bucket: string, path: string, file: Blob, contentType: string): Promise<Result<{ Key: string }>> {
    try {
      const res = await fetch(`${CONFIG.url}/storage/v1/object/${bucket}/${encPath(path)}`, {
        method: 'POST', headers: await headers({ 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': '3600' }), body: file,
      });
      if (!res.ok) return { data: null, error: await parseError(res) };
      return { data: await res.json(), error: null };
    } catch { return { data: null, error: { message: 'Fallo la carga del archivo (conexión).' } }; }
  },
  async replace(bucket: string, path: string, file: Blob, contentType: string) {
    const res = await fetch(`${CONFIG.url}/storage/v1/object/${bucket}/${encPath(path)}`, {
      method: 'POST', headers: await headers({ 'Content-Type': contentType, 'x-upsert': 'true' }), body: file,
    });
    if (!res.ok) return { data: null, error: await parseError(res) };
    return { data: true, error: null };
  },
  /** Enlace temporal autorizado (por defecto 5 minutos). */
  async signedUrl(bucket: string, path: string, seconds = 300, download?: string): Promise<Result<string>> {
    const res = await fetch(`${CONFIG.url}/storage/v1/object/sign/${bucket}/${encPath(path)}`, {
      method: 'POST', headers: await headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: seconds }),
    });
    if (!res.ok) return { data: null, error: await parseError(res) };
    const b = await res.json();
    let url = `${CONFIG.url}/storage/v1${b.signedURL || b.signedUrl}`;
    if (download) url += `&download=${encodeURIComponent(download)}`;
    return { data: url, error: null };
  },
  publicUrl(bucket: string, path: string) { return `${CONFIG.url}/storage/v1/object/public/${bucket}/${encPath(path)}`; },
};

export const functions = {
  async invoke<T = any>(name: string, body: any): Promise<Result<T>> {
    try {
      const res = await fetch(`${CONFIG.url}/functions/v1/${name}`, {
        method: 'POST', headers: await headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
      });
      if (!res.ok) return { data: null, error: await parseError(res) };
      return { data: await res.json(), error: null };
    } catch { return { data: null, error: { message: 'El servicio de procesamiento no respondió.' } }; }
  },
};
