import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth, db, type Session } from './sb';

export type Role = 'admin' | 'auxiliar' | 'cliente';
export interface Org { id: string; name: string; slug: string; status: string; require_segregation: boolean; plan_id: string | null; legal_name?: string; nit?: string }
export interface Membership { id: string; org_id: string; role: Role; client_id: string | null; status: string; org: Org }
export interface Profile { id: string; full_name: string | null; email: string; phone: string | null; is_superadmin: boolean }
export interface Brand { commercial_name: string; color_primary: string; color_secondary: string; color_accent: string; logo_url: string | null }

interface Ctx {
  session: Session | null;
  ready: boolean;
  profile: Profile | null;
  memberships: Membership[];
  current: Membership | null;
  org: Org | null;
  role: Role | null;
  brand: Brand | null;
  perms: Record<string, boolean>;
  can: (module: string, action: string) => boolean;
  setOrg: (orgId: string) => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionCtx = createContext<Ctx>(null as any);
export const useSession = () => useContext(SessionCtx);

const ORG_KEY = 'cd.org';
const readOrg = () => { try { return localStorage.getItem(ORG_KEY); } catch { return null; } };
const writeOrg = (v: string) => { try { localStorage.setItem(ORG_KEY, v); } catch { /* sin almacenamiento */ } };

const DEFAULT_PERMS = (role: Role | null, module: string, action: string) =>
  role === 'admin' ? true : role === 'auxiliar' ? ['ver', 'crear', 'editar'].includes(action) || (module === 'informes' && action === 'exportar') : false;

export function SessionProvider({ children }: { children: any }) {
  const [session, setSession] = useState<Session | null>(auth.session);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrgId] = useState<string | null>(readOrg());
  const [brand, setBrand] = useState<Brand | null>(null);
  const [overrides, setOverrides] = useState<any[]>([]);

  useEffect(() => auth.onChange((s) => setSession(s)) as any, []);

  const load = useCallback(async () => {
    if (!auth.session) { setProfile(null); setMemberships([]); setReady(true); return; }
    await db.rpc('accept_invitations').catch(() => null);
    const uid = auth.session?.user?.id;
    if (!uid) { setReady(true); return; }
    const [p, m] = await Promise.all([
      db.from<Profile>('profiles').select('id,full_name,email,phone,is_superadmin').eq('id', uid).maybeSingle(),
      db.from<Membership[]>('memberships').select('id,org_id,role,client_id,status,org:organizations(id,name,slug,status,require_segregation,plan_id,legal_name,nit)')
        .eq('user_id', uid).eq('status', 'activa'),
    ]);
    setProfile(p.data as any);
    const ms = ((m.data as any[]) || []).filter((x) => x.org);
    setMemberships(ms);
    setReady(true);
  }, []);

  useEffect(() => { setReady(false); load(); }, [session?.user?.id]);

  const current = useMemo(() => memberships.find((m) => m.org_id === orgId) || memberships[0] || null, [memberships, orgId]);

  useEffect(() => {
    if (!current) { setBrand(null); return; }
    db.from('firm_profiles').select('commercial_name,color_primary,color_secondary,color_accent,logo_url').eq('org_id', current.org_id).maybeSingle()
      .then((r) => setBrand(r.data as any));
    if (current.role === 'auxiliar') db.from('role_permissions').select('*').eq('org_id', current.org_id).eq('role', 'auxiliar').then((r) => setOverrides((r.data as any[]) || []));
    else setOverrides([]);
  }, [current?.org_id, current?.role]);

  useEffect(() => {
    if (!brand) return;
    const r = document.documentElement.style;
    r.setProperty('--brand', brand.color_primary);
    r.setProperty('--gold', brand.color_accent);
  }, [brand]);

  const can = useCallback((module: string, action: string) => {
    const role = current?.role ?? null;
    const o = overrides.find((x) => x.module === module && x.action === action);
    return o ? !!o.allowed : DEFAULT_PERMS(role, module, action);
  }, [current?.role, overrides]);

  const value: Ctx = {
    session, ready, profile, memberships, current, org: current?.org ?? null, role: current?.role ?? null, brand,
    perms: {}, can,
    setOrg: (id) => { writeOrg(id); setOrgId(id); },
    reload: load,
    signOut: async () => { await db.rpc('log_event', { p_org: null, p_action: 'cierre_sesion', p_entity: 'auth' }).catch(() => null); await auth.signOut(); },
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
