import { useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, Select, Table, Tabs, Textarea, useToast } from '../../components/ui';
import { useClients } from '../../components/AppShell';
import { date, dateTime, L, today } from '../../lib/format';

const COLS = [
  { id: 'pendiente', label: 'Pendiente', st: ['pendiente'] }, { id: 'en_proceso', label: 'En proceso', st: ['en_proceso'] },
  { id: 'en_revision', label: 'En revisión', st: ['en_revision'] }, { id: 'atencion', label: 'Devuelta / bloqueada', st: ['devuelta', 'bloqueada'] },
];
const ALL = ['pendiente', 'en_proceso', 'en_revision', 'devuelta', 'aprobada', 'completada', 'bloqueada'];
const PRI: Record<string, number> = { urgente: 0, alta: 1, media: 2, baja: 3 };

export function Tasks() {
  const s = useSession(); const { clients } = useClients();
  const [view, setView] = useState('tablero'); const [who, setWho] = useState('todas'); const [client, setClient] = useState(''); const [pri, setPri] = useState('');
  const [open, setOpen] = useState<any>(null);
  const { data, loading, reload } = useAsync(async () => {
    let q = db.from('tasks').select('*,client:clients(name)').eq('org_id', s.org!.id);
    if (view === 'tablero') q = q.in('status', ['pendiente', 'en_proceso', 'en_revision', 'devuelta', 'bloqueada']);
    if (who === 'mias') q = q.eq('assignee_id', s.session!.user.id); else if (who === 'sin') q = q.is('assignee_id', null);
    if (client) q = q.eq('client_id', client); if (pri) q = q.eq('priority', pri);
    const [t, m] = await Promise.all([q.order('due_date', { nullsFirst: false }).limit(800), db.rpc('org_members', { p_org: s.org!.id })]);
    return { tasks: ((t.data as any[]) || []).sort((a, b) => PRI[a.priority] - PRI[b.priority] || String(a.due_date || '9').localeCompare(String(b.due_date || '9'))), staff: ((m.data as any[]) || []).filter((x) => x.role !== 'cliente') };
  }, [view, who, client, pri]);
  const name = (id: string) => data?.staff.find((x: any) => x.user_id === id)?.full_name || '';
  return (
    <>
      <div className="page-h">
        <div><h2>Centro de tareas</h2><p className="muted small">Tareas manuales y automáticas (documentos recibidos, vencimientos, devoluciones, diferencias de conciliación), sin duplicados.</p></div>
        {s.can('tareas', 'crear') && <Button icon="plus" onClick={() => setOpen({ title: '', description: '', priority: 'media', due_date: '', client_id: '', assignee_id: s.session!.user.id, status: 'pendiente', task_type: 'general' })}>Nueva tarea</Button>}
      </div>
      <div className="toolbar">
        <Tabs value={view} onChange={setView} tabs={[{ id: 'tablero', label: 'Tablero' }, { id: 'lista', label: 'Lista completa' }]} />
        <Select value={who} onChange={(e: any) => setWho(e.target.value)} options={[{ value: 'todas', label: 'Todas las visibles' }, { value: 'mias', label: 'Asignadas a mí' }, { value: 'sin', label: 'Sin responsable' }]} />
        <Select value={client} onChange={(e: any) => setClient(e.target.value)} placeholder="Todos los clientes" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        <Select value={pri} onChange={(e: any) => setPri(e.target.value)} placeholder="Toda prioridad" options={['urgente', 'alta', 'media', 'baja']} />
      </div>
      {loading || !data ? <Loading /> : view === 'tablero' ? (
        <div className="kanban">
          {COLS.map((c) => { const items = data.tasks.filter((t) => c.st.includes(t.status)); return (
            <div key={c.id} className="kcol"><div className="row between"><strong>{c.label}</strong><span className="tab-c">{items.length}</span></div>
              {items.map((t) => <div key={t.id} className="kcard" onClick={() => setOpen(t)} tabIndex={0} onKeyDown={(e: any) => e.key === 'Enter' && setOpen(t)}>
                <div className="row between gap-s"><Badge status={t.priority} />{t.due_date && <span className={`xs ${t.due_date < today() ? 'diff-bad' : 'dim'}`}>{date(t.due_date)}</span>}</div>
                <div className="mt-s" style={{ fontWeight: 650 }}>{t.title}</div>
                <div className="dim xs mt-s">{t.client?.name || 'General'}{t.assignee_id ? ` · ${name(t.assignee_id)}` : ' · sin responsable'}</div>
              </div>)}
              {!items.length && <p className="dim xs">Nada aquí.</p>}
            </div>); })}
        </div>
      ) : (
        <Card pad={false}><Table rows={data.tasks} onRow={(t) => setOpen(t)} empty={<Empty title="Sin tareas" icon="checks" />} columns={[
          { key: 'title', label: 'Tarea', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.title}</div><div className="dim xs">{L(r.task_type)}</div></div> },
          { key: 'client', label: 'Cliente', render: (r) => r.client?.name || 'General' }, { key: 'as', label: 'Responsable', render: (r) => name(r.assignee_id) || '—' },
          { key: 'pri', label: 'Prioridad', render: (r) => <Badge status={r.priority} /> }, { key: 'due', label: 'Límite', render: (r) => date(r.due_date) },
          { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> }]} /></Card>
      )}
      {open && <TaskModal task={open} staff={data?.staff || []} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function TaskModal({ task, staff, onClose, onSaved }: any) {
  const s = useSession(); const toast = useToast(); const { clients } = useClients();
  const [v, setV] = useState<any>({ ...task, due_date: task.due_date || '', client_id: task.client_id || '', assignee_id: task.assignee_id || '' });
  const { data: hist } = useAsync(async () => task.id ? ((await db.from('task_events').select('*').eq('task_id', task.id).order('at', { ascending: false })).data as any[]) || [] : [], [task.id]);
  const statuses = useMemo(() => ALL.filter((x) => x !== 'aprobada' || s.role === 'admin'), [s.role]);
  const save = async () => {
    if (v.title.trim().length < 3) return toast('Escriba el título', 'bad');
    const row = { title: v.title.trim(), description: v.description || null, priority: v.priority, due_date: v.due_date || null, assignee_id: v.assignee_id || null, status: v.status, notes: v.notes || null };
    const r = task.id ? await db.from('tasks').update(row).eq('id', task.id)
      : await db.from('tasks').insert({ ...row, org_id: s.org!.id, client_id: v.client_id || null, task_type: 'general' });
    if (r.error) return toast(r.error.message, 'bad'); toast('Tarea guardada'); onSaved();
  };
  const nm = (id: string) => staff.find((x: any) => x.user_id === id)?.full_name || 'Sistema';
  return (
    <Modal open wide title={task.id ? 'Tarea' : 'Nueva tarea'} onClose={onClose} footer={<Button onClick={save}>Guardar</Button>}>
      <div className="form-grid">
        <Field label="Título" className="full"><Input value={v.title} onChange={(e: any) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Cliente"><Select value={v.client_id} disabled={!!task.id} onChange={(e: any) => setV({ ...v, client_id: e.target.value })} placeholder="General (sin cliente)" options={clients.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Responsable"><Select value={v.assignee_id} onChange={(e: any) => setV({ ...v, assignee_id: e.target.value })} placeholder="Sin asignar" options={staff.map((x: any) => ({ value: x.user_id, label: x.full_name || x.email }))} /></Field>
        <Field label="Prioridad"><Select value={v.priority} onChange={(e: any) => setV({ ...v, priority: e.target.value })} options={['baja', 'media', 'alta', 'urgente']} /></Field>
        <Field label="Fecha límite"><Input type="date" value={v.due_date} onChange={(e: any) => setV({ ...v, due_date: e.target.value })} /></Field>
        <Field label="Estado"><Select value={v.status} onChange={(e: any) => setV({ ...v, status: e.target.value })} options={statuses} /></Field>
        <Field label="Descripción" className="full"><Textarea value={v.description || ''} onChange={(e: any) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="Observaciones" className="full"><Textarea value={v.notes || ''} onChange={(e: any) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
      {(task.document_id || task.voucher_id || task.obligation_id || task.statement_id) && <p className="small muted">Relacionada con: {[task.document_id && 'documento', task.voucher_id && 'comprobante', task.obligation_id && 'obligación', task.statement_id && 'conciliación'].filter(Boolean).join(', ')}.</p>}
      {task.id && <><h4>Historial</h4>
        <Table dense rows={hist || []} empty={<p className="muted small">Sin cambios.</p>} columns={[{ key: 'at', label: 'Fecha', render: (r) => dateTime(r.at) }, { key: 'u', label: 'Usuario', render: (r) => nm(r.user_id) },
          { key: 'c', label: 'Cambio', render: (r) => `${r.from_status ? L(r.from_status) + ' → ' : ''}${L(r.to_status)}${r.comment ? ` · ${r.comment}` : ''}` }]} /></>}
    </Modal>
  );
}
