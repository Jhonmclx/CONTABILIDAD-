import { LiveBackground } from '../../components/LiveBackground';
import { Icon } from '../../components/ui';
import { Link } from '../../lib/router';
import { CONFIG } from '../../lib/config';
import { useSession } from '../../lib/session';

const features = [
  { i: 'file', t: 'Centro documental inteligente', d: 'Cargue facturas, extractos y soportes por cliente y periodo. Lectura directa de XML de factura electrónica y detección de duplicados.' },
  { i: 'book', t: 'Contabilidad con partida doble', d: 'Plan de cuentas configurable, comprobantes con flujo de revisión y aprobación, cierres de periodo y reversos trazables.' },
  { i: 'bank', t: 'Conciliación bancaria asistida', d: 'Importe extractos en CSV o XLSX. El sistema propone coincidencias y usted decide; nada ambiguo se concilia solo.' },
  { i: 'calendar', t: 'Calendario tributario', d: 'Obligaciones por cliente con responsables, alertas y reglas versionadas. Las fechas se cargan y verifican con fuente oficial.' },
  { i: 'checks', t: 'Tareas automáticas', d: 'Cada documento recibido, vencimiento o comprobante devuelto genera la tarea correcta para la persona correcta, sin duplicados.' },
  { i: 'shield', t: 'Seguridad por diseño', d: 'Aislamiento entre firmas verificado en la base de datos, permisos por rol y cliente, almacenamiento privado y auditoría.' },
];

export function Landing() {
  const { session } = useSession();
  return (
    <>
      <LiveBackground variant="vivid" />
      <div className="public">
        <nav className="topbar">
          <a className="logo" href="/"><span className="logo-mark">CD</span>{CONFIG.defaultBrand}</a>
          <div className="row gap-s">
            {session ? <Link to="/app" className="btn btn-primary btn-s">Ir a mi panel</Link> : <>
              <Link to="/ingresar" className="btn btn-ghost btn-s">Ingresar</Link>
              <Link to="/registro" className="btn btn-primary btn-s hide-m">Crear cuenta</Link>
            </>}
          </div>
        </nav>

        <header className="hero">
          <div>
            <span className="eyebrow"><Icon name="spark" size={14} /> Plataforma contable digital</span>
            <h1 className="mt"><span className="text-grad">Contabilidad precisa,</span><br />trabajo repetitivo al mínimo.</h1>
            <p className="lead">Un espacio seguro para la firma, sus auxiliares y sus clientes: documentos, comprobantes, conciliaciones,
              vencimientos e informes en un solo lugar, con cada paso revisado y registrado.</p>
            <div className="row gap wrap mt-l">
              <Link to={session ? '/app' : '/ingresar'} className="btn btn-primary btn-l">{session ? 'Abrir panel' : 'Ingresar a la plataforma'} <Icon name="chevron" /></Link>
              <Link to="/ingresar?cliente=1" className="btn btn-outline btn-l"><Icon name="user" /> Portal de clientes</Link>
            </div>
            <div className="row gap-l wrap mt-l muted small">
              <span className="row gap-s"><Icon name="lock" size={16} /> Datos aislados por firma</span>
              <span className="row gap-s"><Icon name="checks" size={16} /> Partida doble validada en servidor</span>
              <span className="row gap-s"><Icon name="eye" size={16} /> Auditoría de operaciones</span>
            </div>
          </div>
          <div className="mock card glass" aria-hidden="true">
            <div className="row between"><strong>Resumen del periodo</strong><span className="badge b-ok">Al día</span></div>
            <div className="grid g2 mt">
              <div className="stat"><span className="muted small">Documentos recibidos</span><div className="stat-v">128</div></div>
              <div className="stat stat-gold"><span className="muted small">Por revisar</span><div className="stat-v">14</div></div>
            </div>
            <div className="mt"><div className="row between small muted"><span>Conciliación bancaria</span><span>86%</span></div><div className="mock-bar mt-s" style={{ width: '86%' }} /></div>
            <div className="mt"><div className="row between small muted"><span>Comprobantes aprobados</span><span>72%</span></div><div className="mock-bar mt-s" style={{ width: '72%' }} /></div>
            <div className="mt"><div className="row between small muted"><span>Obligaciones del mes</span><span>9 de 11</span></div><div className="mock-bar mt-s" style={{ width: '81%' }} /></div>
            <p className="dim xs mt">Vista ilustrativa</p>
          </div>
        </header>

        <section className="section">
          <h2>Todo el ciclo contable, conectado</h2>
          <p className="muted mt-s" style={{ maxWidth: 680 }}>Diseñado para firmas contables colombianas que atienden muchos clientes y necesitan trazabilidad en cada operación.</p>
          <div className="grid g3 mt-l">
            {features.map((f) => (
              <article key={f.t} className="feature">
                <div className="fi"><Icon name={f.i} /></div>
                <h3>{f.t}</h3>
                <p className="muted mt-s small">{f.d}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="card glass" style={{ padding: 'clamp(22px,4vw,44px)' }}>
            <div className="row between wrap gap-l">
              <div style={{ maxWidth: 640 }}>
                <span className="eyebrow"><Icon name="qr" size={14} /> Tarjeta digital</span>
                <h2 className="mt">Su firma, a un escaneo de distancia</h2>
                <p className="muted mt-s">Cada firma publica su tarjeta con WhatsApp, contacto en vCard, solicitud de citas y acceso al portal de clientes.
                  El código QR apunta a una dirección permanente: actualice sus datos sin reimprimir tarjetas.</p>
              </div>
              <Link to={session ? '/app/configuracion?tab=tarjeta' : '/registro'} className="btn btn-gold btn-l">Configurar mi tarjeta</Link>
            </div>
          </div>
        </section>

        <footer className="foot">
          <span>© {new Date().getFullYear()} {CONFIG.defaultBrand}. Nombre comercial provisional.</span>
          <span>Tratamiento de datos conforme a la política publicada por cada firma.</span>
        </footer>
      </div>
    </>
  );
}
