import { createContext, useContext, useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { db } from '../lib/sb';
import { Link, navigate, useLocation } from '../lib/router';
import { LiveBackground } from './LiveBackground';
import { Icon, Select, cx } from './ui';
import { dateTime, L } from '../lib/format';

export interface ClientLite { id: string; name: string; id_number: string; dv: string | null; status: string; file_status: string }
interface ClientsCtx { clients: ClientLite[]; clientId: string; setClientId: (id: string) => void; reload: () => void; loading: boolean }
const Ctx = createContext<ClientsCtx>({ clients: [], clientId: '', setClientId: () => {}, reload: () => {}, loading: true });
export const useClients = () => useContext(Ctx);

const NAV = [
  { sec: 'Trabajo diario' },
  { to: '/app', icon: 'home', label: 'Inicio' },
  { to: '/app/tareas', icon: 'checks', label: 'Tareas', mod: 'tareas' },
  { to: '/app/clientes', icon: 'users', label: 'Clientes', mod: 'clientes' },
  { to: '/app/documentos', icon: 'file', label: 'Documentos', mod: 'documentos' },
  { sec: 'Contabilidad' },
  { to: '/app/contabilidad', icon: 'book', label: 'Comprobantes y cuentas', mod: 'contabilidad' },
  { to: '/app/conciliacion', icon: 'bank', label: 'Conciliación bancaria', mod: 'conciliacion' },
  { to: '/app/cartera', icon: 'wallet', label: 'Cartera y tesorería', mod: 'cartera' },
  { to: '/app/calendario', icon: 'calendar', label: 'Calendario tributario', mod: 'tributario' },
  { to: '/app/informes', icon: 'chart', label: 'Informes', mod: 'informes' },
  { sec: 'Firma' },
  { to: '/app/configuracion', icon: 'gear', label: 'Configuración', admin: true },
  { to: '/app/plataforma', icon: 'building', label: 'Plataforma (SaaS)', superadmin: true },
];

export function AppShell({ children }: { children: any }) {
  const s = useSession();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [loading, setLoading] = useState(true);
  const key = `cd.client.${s.org?.id}`;
  const [clientId, setClientIdState] = useState<string>(() => { try { return localStorage.getItem(key) || ''; } catch { return ''; } });

  const loadClients = async () => {
    if (!s.org) return;
    setLoading(true);
    const r = await db.from<ClientLite[]>('clients').select('id,name,id_number,dv,status,file_status').eq('org_id', s.org.id).order('name');
    const list = (r.data as any) || [];
    setClients(list); setLoading(false);
    if (list.length && !list.some((c: ClientLite) => c.id === clientId)) setClientId(list[0].id);
  };
  const setClientId = (id: string) => { setClientIdState(id); try { localStorage.setItem(key, id); } catch { /* */ } };
  useEffect(() => { loadClients(); }, [s.org?.id]);
  useEffect(() => { setOpen(false); }, [path]);

  const brandName = s.brand?.commercial_name || 'CONTABILIDAD DIGITAL';
  return (
    <Ctx.Provider value={{ clients, clientId, setClientId, reload: loadClients, loading }}>
      <LiveBackground variant="subtle" />
      <div className="app">
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <aside className={cx('side', open && 'open')} aria-label="Navegación principal">
          <Link to="/app" className="logo"><span className="logo-mark">{s.brand?.logo_url ? <img src={s.brand.logo_url} alt="" /> : brandName.slice(0, 2)}</span><span style={{ fontSize: 13 }}>{brandName}</span></Link>
          {s.memberships.length > 1 && (
            <Select aria-label="Organización" value={s.org?.id} onChange={(e: any) => { s.setOrg(e.target.value); navigate('/app'); }}
              options={s.memberships.map((m) => ({ value: m.org_id, label: m.org.name }))} />
          )}
          {NAV.map((n, i) => {
            if ('sec' in n) return <div key={i} className="nav-sec">{n.sec}</div>;
            if (n.admin && s.role !== 'admin') return null;
            if (n.superadmin && !s.profile?.is_superadmin) return null;
            if (n.mod && !s.can(n.mod, 'ver')) return null;
            const on = n.to === '/app' ? path === '/app' : path.startsWith(n.to!);
            return <Link key={n.to} to={n.to!} className={cx('nav-a', on && 'on')} aria-current={on ? 'page' : undefined}><Icon name={n.icon!} />{n.label}</Link>;
          })}
          <div className="grow" />
          <div className="card" style={{ padding: 12, borderRadius: 14 }}>
            <div className="small" style={{ fontWeight: 700 }}>{s.profile?.full_name || s.session?.user.email}</div>
            <div className="dim xs">{L(s.role)} · {s.org?.name}</div>
            <button className="btn btn-ghost btn-s mt-s" style={{ width: '100%' }} onClick={async () => { await s.signOut(); navigate('/ingresar'); }}><Icon name="logout" /> Cerrar sesión</button>
          </div>
        </aside>
        <div className="main">
          <header className="appbar">
            <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menú"><Icon name="menu" /></button>
            <div className="grow small dim hide-m">{s.org?.name}{s.org?.status === 'suspendida' && <span className="badge b-bad" style={{ marginLeft: 8 }}>Suspendida</span>}</div>
            <div className="grow" />
            <Bell />
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

function Bell() {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const load = () => db.from('notifications').select('*').order('created_at', { ascending: false }).limit(20).then((r) => setItems((r.data as any) || []));
  useEffect(() => { load(); const t = setInterval(() => !document.hidden && load(), 60_000); return () => clearInterval(t); }, []);
  const unread = items.filter((i) => !i.read_at).length;
  const markAll = async () => {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (ids.length) await db.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
    load();
  };
  const go = async (n: any) => {
    if (!n.read_at) await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
    setOpen(false); load();
    if (n.link && n.link.startsWith('/')) navigate(n.link);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label={`Notificaciones (${unread} sin leer)`} onClick={() => setOpen(!open)}>
        <Icon name="bell" />{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <div className="drop" role="dialog" aria-label="Notificaciones">
        <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <strong>Notificaciones</strong>
          <div className="row gap-s"><button className="btn btn-ghost btn-s" onClick={markAll}>Marcar leídas</button><Link to="/app/notificaciones" className="btn btn-ghost btn-s" onClick={() => setOpen(false)}>Ver todas</Link></div>
        </div>
        {items.length === 0 && <p className="muted small" style={{ padding: 16 }}>No tiene notificaciones.</p>}
        {items.map((n) => (
          <div key={n.id} className={cx('notif', !n.read_at && 'unread')} onClick={() => go(n)}>
            {!n.read_at ? <span className="ndot" /> : <span style={{ width: 8 }} />}
            <div className="grow"><div className="small" style={{ fontWeight: 650 }}>{n.title}</div>{n.body && <div className="muted xs">{n.body}</div>}<div className="dim xs">{dateTime(n.created_at)}</div></div>
          </div>
        ))}
      </div>}
    </div>
  );
}

/** Selector de cliente para módulos contables. */
export function ClientPicker({ label = 'Cliente' }: { label?: string }) {
  const { clients, clientId, setClientId } = useClients();
  if (!clients.length) return null;
  return (
    <label className="row gap-s" style={{ minWidth: 0 }}>
      <span className="small muted hide-m">{label}</span>
      <Select value={clientId} onChange={(e: any) => setClientId(e.target.value)} options={clients.map((c) => ({ value: c.id, label: `${c.name} · ${c.id_number}` }))} style={{ maxWidth: 360 }} />
    </label>
  );
}

export function NeedClient({ children }: { children: any }) {
  const { clients, loading } = useClients();
  if (loading) return null;
  if (!clients.length) return (
    <div className="card"><div className="empty"><div className="empty-i"><Icon name="users" size={28} /></div><h4>Primero cree un cliente</h4>
      <p className="muted">Los módulos contables trabajan por cliente. Registre o importe sus clientes para comenzar.</p>
      <Link to="/app/clientes" className="btn btn-primary mt">Ir a clientes</Link></div></div>
  );
  return children;
}
