import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Badge, Card, Empty, Loading, Stat, Table } from '../../components/ui';
import { date, daysUntil, today, L } from '../../lib/format';
import { Link, navigate } from '../../lib/router';

async function count(table: string, f: (q: any) => any) {
  const r = await f(db.from(table).select('id', { count: 'exact' }).limit(1));
  return r.count ?? 0;
}

export function Dashboard() {
  const s = useSession();
  const orgId = s.org!.id; const uid = s.session!.user.id;
  const in15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const { data, loading } = useAsync(async () => {
    const [clients, myTasks, toReview, inReview, obligations, unrec, tasks, upcoming, docs] = await Promise.all([
      count('clients', (q) => q.eq('org_id', orgId).eq('status', 'activo')),
      count('tasks', (q) => q.eq('org_id', orgId).eq('assignee_id', uid).in('status', ['pendiente', 'en_proceso', 'devuelta'])),
      count('documents', (q) => q.eq('org_id', orgId).in('status', ['recibido', 'requiere_revision'])),
      count('vouchers', (q) => q.eq('org_id', orgId).eq('status', 'en_revision')),
      count('obligations', (q) => q.eq('org_id', orgId).in('status', ['pendiente', 'en_preparacion']).lte('due_date', in15)),
      count('bank_lines', (q) => q.eq('org_id', orgId).in('status', ['sin_conciliar', 'propuesta'])),
      db.from('tasks').select('id,title,priority,due_date,status,client:clients(name)').eq('org_id', orgId).in('status', ['pendiente', 'en_proceso', 'devuelta', 'en_revision'])
        .or(`assignee_id.eq.${uid},assignee_id.is.null`).order('due_date', { nullsFirst: false }).limit(8),
      db.from('obligations').select('id,name,due_date,status,date_confirmed,client:clients(name)').eq('org_id', orgId).in('status', ['pendiente', 'en_preparacion', 'vencida'])
        .order('due_date').limit(8),
      db.from('documents').select('id,title,doc_type,status,created_at,client:clients(name)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(6),
    ]);
    return { clients, myTasks, toReview, inReview, obligations, unrec, tasks: tasks.data || [], upcoming: upcoming.data || [], docs: docs.data || [] };
  }, [orgId]);

  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  return (
    <>
      <div className="page-h">
        <div><p className="muted small">{new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h2>{hello}, {(s.profile?.full_name || '').split(' ')[0] || 'bienvenido'}</h2></div>
      </div>
      {loading || !data ? <Loading /> : <>
        <div className="grid g4">
          <Stat label="Mis tareas abiertas" value={data.myTasks} icon="checks" t={data.myTasks ? 'warn' : 'ok'} />
          <Stat label="Documentos por revisar" value={data.toReview} icon="file" />
          <Stat label="Comprobantes en revisión" value={data.inReview} icon="book" t={data.inReview ? 'gold' : undefined} />
          <Stat label="Vencimientos (15 días)" value={data.obligations} icon="calendar" t={data.obligations ? 'bad' : 'ok'} />
        </div>
        <div className="grid g3">
          <Stat label="Clientes activos" value={data.clients} icon="users" />
          <Stat label="Movimientos bancarios sin conciliar" value={data.unrec} icon="bank" />
          <div className="stat"><div className="stat-top"><span className="muted small">Accesos rápidos</span></div>
            <div className="row gap-s wrap mt-s">
              <Link to="/app/documentos" className="btn btn-s btn-primary">Cargar documentos</Link>
              <Link to="/app/contabilidad?nuevo=1" className="btn btn-s">Nuevo comprobante</Link>
              <Link to="/app/clientes?nuevo=1" className="btn btn-s">Nuevo cliente</Link>
            </div>
          </div>
        </div>
        <div className="grid g2">
          <Card title="Tareas prioritarias" actions={<Link to="/app/tareas" className="btn btn-ghost btn-s">Ver todas</Link>} pad={false}>
            {data.tasks.length ? <Table dense onRow={() => navigate('/app/tareas')} rows={data.tasks} columns={[
              { key: 'title', label: 'Tarea', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.title}</div><div className="dim xs">{r.client?.name || 'General'}</div></div> },
              { key: 'priority', label: 'Prioridad', render: (r) => <Badge status={r.priority} /> },
              { key: 'due', label: 'Límite', render: (r) => <span className={r.due_date && r.due_date < today() ? 'diff-bad' : ''}>{date(r.due_date)}</span> },
            ]} /> : <Empty title="Sin tareas pendientes" icon="checks">Las tareas se crean automáticamente cuando llegan documentos o se acercan vencimientos.</Empty>}
          </Card>
          <Card title="Próximos vencimientos" actions={<Link to="/app/calendario" className="btn btn-ghost btn-s">Calendario</Link>} pad={false}>
            {data.upcoming.length ? <Table dense onRow={() => navigate('/app/calendario')} rows={data.upcoming} columns={[
              { key: 'name', label: 'Obligación', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div className="dim xs">{r.client?.name}</div></div> },
              { key: 'due', label: 'Vence', render: (r) => { const d = daysUntil(r.due_date); return <div>{date(r.due_date)}<div className={`xs ${d !== null && d < 0 ? 'diff-bad' : 'dim'}`}>{d === null ? 'Sin fecha' : d < 0 ? `Vencida hace ${-d} d` : d === 0 ? 'Hoy' : `En ${d} d`}</div></div>; } },
              { key: 'st', label: 'Estado', render: (r) => <div className="col gap-s" style={{ alignItems: 'flex-start' }}><Badge status={r.status} />{!r.date_confirmed && <Badge t="warn">Fecha por confirmar</Badge>}</div> },
            ]} /> : <Empty title="Sin obligaciones registradas" icon="calendar">Configure reglas tributarias y genere las obligaciones de cada cliente.</Empty>}
          </Card>
        </div>
        <Card title="Últimos documentos recibidos" pad={false}>
          {data.docs.length ? <Table dense onRow={() => navigate('/app/documentos')} rows={data.docs} columns={[
            { key: 'title', label: 'Documento' }, { key: 'client', label: 'Cliente', render: (r) => r.client?.name },
            { key: 'type', label: 'Tipo', render: (r) => L(r.doc_type) }, { key: 'status', label: 'Estado', render: (r) => <Badge status={r.status} /> },
            { key: 'at', label: 'Recibido', render: (r) => date(r.created_at) },
          ]} /> : <Empty title="Aún no hay documentos" icon="upload" />}
        </Card>
      </>}
    </>
  );
}
