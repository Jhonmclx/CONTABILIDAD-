import { useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Card, Confirm, Empty, Field, Icon, Input, Loading, Modal, Tabs, Table, Textarea, useToast } from '../../components/ui';
import { ClientForm } from './ClientForm';
import { Link, navigate } from '../../lib/router';
import { date, dateTime, L } from '../../lib/format';
import { useClients } from '../../components/AppShell';

export function ClientDetail({ id }: { id: string }) {
  const s = useSession(); const toast = useToast(); const shell = useClients();
  const [tab, setTab] = useState('resumen');
  const [edit, setEdit] = useState(false); const [del, setDel] = useState(false);
  const { data: c, loading, reload } = useAsync(async () => (await db.from('clients').select('*').eq('id', id).maybeSingle()).data, [id]);
  if (loading) return <Loading />;
  if (!c) return <Empty title="Cliente no encontrado">Puede que no exista o que no tenga acceso a él.</Empty>;
  return (
    <>
      <div className="page-h">
        <div>
          <Link to="/app/clientes" className="small">← Clientes</Link>
          <h2 className="mt-s">{c.name}</h2>
          <div className="row gap-s wrap mt-s"><span className="mono muted">{c.id_type} {c.id_number}{c.dv ? `-${c.dv}` : ''}</span><Badge status={c.status} /><Badge status={c.file_status} /></div>
        </div>
        <div className="row gap-s wrap">
          <Button variant="outline" icon="file" onClick={() => { shell.setClientId(c.id); navigate('/app/documentos'); }}>Documentos</Button>
          <Button variant="outline" icon="book" onClick={() => { shell.setClientId(c.id); navigate('/app/contabilidad'); }}>Contabilidad</Button>
          {s.can('clientes', 'editar') && <Button icon="edit" onClick={() => setEdit(true)}>Editar</Button>}
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'resumen', label: 'Resumen' }, { id: 'contactos', label: 'Contactos' }, { id: 'notas', label: 'Notas internas' },
        { id: 'actividad', label: 'Actividad' }, ...(s.role === 'admin' ? [{ id: 'portal', label: 'Acceso al portal' }, { id: 'historial', label: 'Historial' }] : [])]} />
      {tab === 'resumen' && <Summary c={c} />}
      {tab === 'contactos' && <Contacts clientId={id} />}
      {tab === 'notas' && <Notes clientId={id} />}
      {tab === 'actividad' && <Activity clientId={id} />}
      {tab === 'portal' && <PortalAccess client={c} />}
      {tab === 'historial' && <History clientId={id} />}
      {s.role === 'admin' && tab === 'resumen' && <div><Button variant="danger" size="s" icon="trash" onClick={() => setDel(true)}>Eliminar cliente</Button></div>}
      <ClientForm open={edit} client={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); toast('Cliente actualizado'); reload(); shell.reload(); }} />
      <Confirm open={del} danger title="Eliminar cliente" confirmLabel="Eliminar definitivamente" onClose={() => setDel(false)} needReason onConfirm={async (reason: string) => {
        await db.rpc('log_event', { p_org: s.org!.id, p_action: 'eliminacion_cliente', p_entity: 'clients', p_entity_id: id, p_reason: reason });
        const r = await db.from('clients').delete().eq('id', id);
        if (r.error) return toast(r.error.message, 'bad');
        toast('Cliente eliminado'); shell.reload(); navigate('/app/clientes');
      }}>
        <Alert kind="warn">Se eliminarán también sus documentos registrados, contabilidad y tareas. Si solo deja de atenderlo, márquelo como <strong>inactivo</strong>. Verifique primero la política de retención documental.</Alert>
      </Confirm>
    </>
  );
}

function Summary({ c }: any) {
  return (
    <div className="grid g2">
      <Card title="Datos generales">
        <dl className="kv">
          <dt>Tipo de persona</dt><dd>{L(c.person_type)}</dd>
          <dt>Correo</dt><dd>{c.email || '—'}</dd><dt>Teléfono</dt><dd>{c.phone || '—'}</dd>
          <dt>Dirección</dt><dd>{c.address || '—'}{c.city ? `, ${c.city}` : ''}</dd>
          <dt>Etiquetas</dt><dd>{(c.tags || []).length ? c.tags.map((t: string) => <span key={t} className="chip" style={{ marginRight: 6 }}>{t}</span>) : '—'}</dd>
          <dt>Creado</dt><dd>{date(c.created_at)}</dd>
        </dl>
      </Card>
      <Card title="Información tributaria" subtitle="Según el RUT del cliente. Verifique antes de configurar obligaciones.">
        <dl className="kv">
          <dt>Actividad (CIIU)</dt><dd>{c.economic_activity || '—'}</dd>
          <dt>Régimen</dt><dd>{c.tax_regime || '—'}</dd>
          <dt>Responsabilidades</dt><dd>{(c.fiscal_responsibilities || []).join(', ') || '—'}</dd>
          <dt>Periodicidad contable</dt><dd>{L(c.accounting_period)}</dd>
        </dl>
      </Card>
    </div>
  );
}

function Contacts({ clientId }: { clientId: string }) {
  const s = useSession(); const toast = useToast();
  const { data, reload } = useAsync(async () => (await db.from('client_contacts').select('*').eq('client_id', clientId).order('name')).data || [], [clientId]);
  const [v, setV] = useState({ name: '', role: '', email: '', phone: '' }); const [open, setOpen] = useState(false);
  const add = async () => {
    if (v.name.trim().length < 2) return toast('Escriba el nombre', 'bad');
    const r = await db.from('client_contacts').insert({ client_id: clientId, org_id: s.org!.id, ...v });
    if (r.error) return toast(r.error.message, 'bad');
    setOpen(false); setV({ name: '', role: '', email: '', phone: '' }); reload();
  };
  return (
    <Card title="Contactos" actions={s.can('clientes', 'editar') && <Button size="s" icon="plus" onClick={() => setOpen(true)}>Agregar</Button>} pad={false}>
      <Table rows={data || []} empty={<Empty title="Sin contactos" icon="user" />} columns={[
        { key: 'name', label: 'Nombre' }, { key: 'role', label: 'Cargo' }, { key: 'email', label: 'Correo' }, { key: 'phone', label: 'Teléfono' },
        { key: 'x', label: '', render: (r) => s.can('clientes', 'editar') && <button className="icon-btn" aria-label="Eliminar" onClick={async () => { await db.from('client_contacts').delete().eq('id', r.id); reload(); }}><Icon name="trash" /></button> },
      ]} />
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo contacto" footer={<Button onClick={add}>Guardar</Button>}>
        <Field label="Nombre"><Input value={v.name} onChange={(e: any) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Cargo"><Input value={v.role} onChange={(e: any) => setV({ ...v, role: e.target.value })} /></Field>
        <div className="form-grid"><Field label="Correo"><Input type="email" value={v.email} onChange={(e: any) => setV({ ...v, email: e.target.value })} /></Field>
          <Field label="Teléfono"><Input value={v.phone} onChange={(e: any) => setV({ ...v, phone: e.target.value })} /></Field></div>
      </Modal>
    </Card>
  );
}

function Notes({ clientId }: { clientId: string }) {
  const s = useSession(); const toast = useToast();
  const { data, reload } = useAsync(async () => (await db.from('client_notes').select('*').eq('client_id', clientId).order('created_at', { ascending: false })).data || [], [clientId]);
  const [body, setBody] = useState('');
  const add = async () => {
    if (!body.trim()) return;
    const r = await db.from('client_notes').insert({ client_id: clientId, org_id: s.org!.id, body: body.trim(), author_id: s.session!.user.id });
    if (r.error) return toast(r.error.message, 'bad');
    setBody(''); reload();
  };
  return (
    <Card title="Notas internas" subtitle="Solo visibles para el equipo de la firma. El cliente nunca las ve.">
      {s.can('clientes', 'editar') && <div className="col gap-s"><Textarea value={body} onChange={(e: any) => setBody(e.target.value)} placeholder="Escriba una nota…" /><div><Button size="s" onClick={add}>Guardar nota</Button></div></div>}
      <div className="col gap mt">
        {(data || []).map((n: any) => <div key={n.id} className="stat"><div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div><div className="dim xs mt-s">{dateTime(n.created_at)}</div></div>)}
        {!data?.length && <p className="muted small">Sin notas.</p>}
      </div>
    </Card>
  );
}

function Activity({ clientId }: { clientId: string }) {
  const { data, loading } = useAsync(async () => {
    const [docs, tasks, obl, req] = await Promise.all([
      db.from('documents').select('id,title,doc_type,status,period,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(10),
      db.from('tasks').select('id,title,status,priority,due_date').eq('client_id', clientId).in('status', ['pendiente', 'en_proceso', 'en_revision', 'devuelta', 'bloqueada']).limit(10),
      db.from('obligations').select('id,name,due_date,status,date_confirmed').eq('client_id', clientId).in('status', ['pendiente', 'en_preparacion', 'vencida']).order('due_date').limit(10),
      db.from('document_requests').select('id,title,status,due_date').eq('client_id', clientId).eq('status', 'pendiente').limit(10),
    ]);
    return { docs: docs.data || [], tasks: tasks.data || [], obl: obl.data || [], req: req.data || [] };
  }, [clientId]);
  if (loading || !data) return <Loading />;
  return (
    <div className="grid g2">
      <Card title="Documentos recientes" pad={false}><Table dense rows={data.docs} empty={<Empty title="Sin documentos" icon="file" />} columns={[
        { key: 'title', label: 'Documento' }, { key: 'period', label: 'Periodo' }, { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> }]} /></Card>
      <Card title="Tareas pendientes" pad={false}><Table dense rows={data.tasks} empty={<Empty title="Sin tareas" icon="checks" />} columns={[
        { key: 'title', label: 'Tarea' }, { key: 'due', label: 'Límite', render: (r) => date(r.due_date) }, { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> }]} /></Card>
      <Card title="Obligaciones abiertas" pad={false}><Table dense rows={data.obl} empty={<Empty title="Sin obligaciones" icon="calendar" />} columns={[
        { key: 'name', label: 'Obligación' }, { key: 'due', label: 'Vence', render: (r) => date(r.due_date) }, { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> }]} /></Card>
      <Card title="Documentos solicitados al cliente" pad={false}><Table dense rows={data.req} empty={<Empty title="Sin solicitudes pendientes" icon="inbox" />} columns={[
        { key: 'title', label: 'Solicitud' }, { key: 'due', label: 'Plazo', render: (r) => date(r.due_date) }]} /></Card>
    </div>
  );
}

function PortalAccess({ client }: any) {
  const s = useSession(); const toast = useToast();
  const { data, reload } = useAsync(async () => {
    const [mem, inv] = await Promise.all([
      db.rpc('org_members', { p_org: s.org!.id }),
      db.from('invitations').select('*').eq('org_id', s.org!.id).eq('client_id', client.id).order('created_at', { ascending: false }),
    ]);
    return { users: ((mem.data as any[]) || []).filter((m) => m.client_id === client.id), inv: inv.data || [] };
  }, [client.id]);
  const [email, setEmail] = useState(client.email || ''); const [busy, setBusy] = useState(false);
  const invite = async () => {
    setBusy(true);
    const r = await db.rpc('invite_member', { p_org: s.org!.id, p_email: email.trim(), p_role: 'cliente', p_client: client.id });
    setBusy(false);
    if (r.error) return toast(r.error.message, 'bad');
    toast('Invitación registrada'); reload();
  };
  return (
    <Card title="Acceso al portal del cliente" subtitle="El cliente solo verá sus solicitudes, los documentos que usted autorice y sus notificaciones.">
      <Alert kind="info">La invitación queda registrada para ese correo. Comparta con el cliente el enlace <span className="mono">{location.origin}/registro</span>: al crear su cuenta con el mismo correo y confirmarlo, obtiene acceso automáticamente.
        {' '}El envío automático por correo se habilita cuando configure un proveedor de correo.</Alert>
      <div className="row gap-s wrap mt" style={{ alignItems: 'flex-end' }}>
        <Field label="Correo del cliente" className="grow"><Input type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} /></Field>
        <Button loading={busy} onClick={invite} icon="send">Invitar</Button>
      </div>
      <h4 className="mt-l">Usuarios con acceso</h4>
      <Table dense rows={data?.users || []} rowKey="membership_id" empty={<p className="muted small mt-s">Ninguno todavía.</p>} columns={[
        { key: 'full_name', label: 'Nombre' }, { key: 'email', label: 'Correo' }, { key: 'status', label: 'Estado', render: (r) => <Badge status={r.status} /> }]} />
      <h4 className="mt-l">Invitaciones</h4>
      <Table dense rows={data?.inv || []} empty={<p className="muted small mt-s">Sin invitaciones.</p>} columns={[
        { key: 'email', label: 'Correo' }, { key: 'status', label: 'Estado', render: (r) => <Badge status={r.status === 'pendiente' ? 'pendiente' : r.status === 'aceptada' ? 'aprobada' : 'anulada'}>{r.status}</Badge> },
        { key: 'exp', label: 'Vence', render: (r) => date(r.expires_at) },
        { key: 'x', label: '', render: (r) => r.status === 'pendiente' && <Button size="s" variant="ghost" onClick={async () => { await db.from('invitations').update({ status: 'revocada' }).eq('id', r.id); reload(); }}>Revocar</Button> }]} />
    </Card>
  );
}

function History({ clientId }: { clientId: string }) {
  const { data, loading } = useAsync(async () => (await db.from('audit_log').select('id,at,action,entity,entity_id,reason,user_id').eq('entity_id', clientId).order('at', { ascending: false }).limit(100)).data || [], [clientId]);
  if (loading) return <Loading />;
  return (
    <Card title="Historial del cliente" pad={false}>
      <Table dense rows={data || []} empty={<Empty title="Sin eventos" />} columns={[
        { key: 'at', label: 'Fecha', render: (r) => dateTime(r.at) }, { key: 'action', label: 'Acción', render: (r) => L(r.action) }, { key: 'entity', label: 'Entidad' }, { key: 'reason', label: 'Detalle', render: (r) => r.reason || '—' }]} />
    </Card>
  );
}
