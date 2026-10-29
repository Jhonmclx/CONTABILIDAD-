import { useEffect } from 'react';
import { match, navigate, useLocation } from './lib/router';
import { useSession } from './lib/session';
import { Loading } from './components/ui';
import { Landing } from './pages/public/Landing';
import { AuthPage } from './pages/public/Auth';
import { FirmCard } from './pages/public/FirmCard';
import { FirmPrivacy } from './pages/public/FirmPrivacy';
import { AppShell } from './components/AppShell';
import { Onboarding } from './pages/app/Onboarding';
import { Dashboard } from './pages/app/Dashboard';
import { Clients } from './pages/app/Clients';
import { ClientDetail } from './pages/app/ClientDetail';
import { Documents } from './pages/app/Documents';
import { Accounting } from './pages/app/Accounting';
import { Reconciliation } from './pages/app/Reconciliation';
import { Receivables } from './pages/app/Receivables';
import { TaxCalendar } from './pages/app/TaxCalendar';
import { Tasks } from './pages/app/Tasks';
import { Reports } from './pages/app/Reports';
import { Notifications } from './pages/app/Notifications';
import { Settings } from './pages/app/Settings';
import { SuperAdmin } from './pages/app/SuperAdmin';
import { Portal } from './pages/portal/Portal';
import { LiveBackground } from './components/LiveBackground';

const staffRoutes: [string, (p: any) => any][] = [
  ['/app', Dashboard], ['/app/clientes', Clients], ['/app/clientes/:id', ClientDetail], ['/app/documentos', Documents],
  ['/app/contabilidad', Accounting], ['/app/conciliacion', Reconciliation], ['/app/cartera', Receivables],
  ['/app/calendario', TaxCalendar], ['/app/tareas', Tasks], ['/app/informes', Reports], ['/app/notificaciones', Notifications],
  ['/app/configuracion', Settings], ['/app/plataforma', SuperAdmin],
];

function Redirect({ to }: { to: string }) { useEffect(() => navigate(to, { replace: true }), [to]); return null; }

export function App() {
  const { path } = useLocation();
  const s = useSession();

  // ----- Público -----
  if (path === '/' ) return <Landing />;
  for (const p of ['/ingresar', '/registro', '/recuperar', '/nueva-clave']) if (path === p) return <AuthPage mode={p.slice(1) as any} />;
  let m = match('/f/:slug/privacidad', path); if (m) return <FirmPrivacy slug={m.slug} />;
  m = match('/f/:slug', path); if (m) return <FirmCard slug={m.slug} />;

  // ----- Privado -----
  if (path.startsWith('/app') || path.startsWith('/portal')) {
    if (!s.session) return <Redirect to={`/ingresar?next=${encodeURIComponent(path)}`} />;
    if (!s.ready) return <><LiveBackground variant="subtle" /><div className="auth-wrap"><Loading label="Preparando su espacio…" /></div></>;
    if (path === '/app/bienvenida' || (!s.memberships.length && path.startsWith('/app') && path !== '/app/plataforma')) return <Onboarding />;
    if (path.startsWith('/portal')) {
      if (s.role !== 'cliente') return <Redirect to="/app" />;
      return <Portal />;
    }
    if (s.role === 'cliente') return <Redirect to="/portal" />;
    if (path === '/app/plataforma' && !s.profile?.is_superadmin) return <Redirect to="/app" />;
    for (const [pattern, Page] of staffRoutes) {
      const mm = match(pattern, path);
      if (mm) return <AppShell><Page {...mm} /></AppShell>;
    }
  }
  return <NotFound />;
}

function NotFound() {
  return (
    <>
      <LiveBackground variant="vivid" />
      <div className="auth-wrap">
        <div className="card glass auth-card center">
          <h2>Página no encontrada</h2>
          <p className="muted mt-s">La dirección no existe o fue movida.</p>
          <a className="btn btn-primary mt" href="/">Ir al inicio</a>
        </div>
      </div>
    </>
  );
}
