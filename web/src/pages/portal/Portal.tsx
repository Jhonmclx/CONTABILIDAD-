import { useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db, storage } from '../../lib/sb';
import { LiveBackground } from '../../components/LiveBackground';
import { Alert, Badge, Button, Card, Empty, Field, Icon, Input, Loading, Stat, Table, Tabs, useToast } from '../../components/ui';
import { UploadModal } from '../app/Documents';
import { date, dateTime, L } from '../../lib/format';
import { navigate } from '../../lib/router';
import { AccountModal } from '../../components/AccountModal';

// Portal del cliente: separado de la administración interna. Solo ve su información autorizada.
export function Portal() {
  const s = useSession(); const toast = useToast();
  const clientId = s.current!.client_id!;
  const [tab, setTab] = useState('inicio'); const [upload, setUpload] = useState(false); const [account, setAccount] = useState(false);
  const { data, loading, reload } = useAsync(async () => {
    const [c, req, docs, notif] = await Promise.all([
      db.from('clients').select('id,name,id_type,id_number,dv,email,phone,address').eq('id', clientId).maybeSingle(),
      db.from('document_requests').select('id,title,description,period,due_date,status,created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
      db.from('documents').select('id,title,doc_type,period,created_at,source,storage_path,org_id,status').eq('client_id', clientId).eq('visible_to_client', true).neq('status', 'archivado').order('created_at', { ascending: false }),
      db.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    return { client: c.data as any, req: (req.data as any[]) || [], docs: (docs.data as any[]) || [], notif: (notif.data as any[]) || [] };
  }, [clientId]);
  const download = async (d: any) => {
    const r = await storage.signedUrl('documentos', d.storage_path, 300, d.title);
    if (r.error) return toast(r.error.message, 'bad');
    db.from('document_events').insert({ document_id: d.id, org_id: d.org_id, user_id: s.session!.user.id, event: 'descargado' });
    window.open(r.data!, '_blank', 'noopener');
  };
  const brand = s.brand?.commercial_name || 'CONTABILIDAD DIGITAL';
  const pending = (data?.req || []).filter((r) => r.status === 'pendiente');
  const deliverables = (data?.docs || []).filter((d) => d.source === 'firma');
  return (
    <>
      <LiveBackground variant="subtle" />
      <div className="public">
        <nav className="topbar">
          <span className="logo"><span className="logo-mark">{s.brand?.logo_url ? <img src={s.brand.logo_url} alt="" /> : brand.slice(0, 2)}</span>{brand}</span>
          <div className="row gap-s"><span className="small muted hide-m">{s.profile?.full_name}</span><Button size="s" variant="ghost" icon="lock" onClick={() => setAccount(true)}>Contraseña</Button><Button size="s" variant="ghost" icon="logout" onClick={async () => { await s.signOut(); navigate('/ingresar'); }}>Salir</Button></div>
        </nav>
        <main className="content" style={{ maxWidth: 1100 }}>
          {loading || !data ? <Loading /> : <>
            <div className="page-h"><div><span className="eyebrow">Portal del cliente</span><h2 className="mt-s">{data.client?.name}</h2></div>
              <Button icon="upload" onClick={() => setUpload(true)}>Enviar documentos</Button></div>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'inicio', label: 'Inicio' }, { id: 'solicitudes', label: 'Solicitudes', count: pending.length }, { id: 'documentos', label: 'Mis documentos' }, { id: 'perfil', label: 'Mis datos' }]} />
            {tab === 'inicio' && <>
              <div className="grid g3"><Stat label="Documentos solicitados pendientes" value={pending.length} t={pending.length ? 'warn' : 'ok'} icon="inbox" />
                <Stat label="Entregables disponibles" value={deliverables.length} icon="download" /><Stat label="Avisos sin leer" value={data.notif.filter((n) => !n.read_at).length} icon="bell" /></div>
              <Card title="Avisos recientes" pad={false}><Table dense rows={data.notif.slice(0, 10)} empty={<Empty title="Sin avisos" icon="bell" />} columns={[
                { key: 't', label: 'Aviso', render: (r) => <div style={{ fontWeight: r.read_at ? 400 : 700 }}>{r.title}<div className="dim xs">{r.body}</div></div> }, { key: 'at', label: 'Fecha', render: (r) => dateTime(r.created_at) },
                { key: 'x', label: '', render: (r) => !r.read_at && <Button size="s" variant="ghost" onClick={async () => { await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', r.id); reload(); }}>Marcar leído</Button> }]} /></Card>
            </>}
            {tab === 'solicitudes' && <Card title="Documentos que su contador necesita" pad={false}>
              <Table rows={data.req} empty={<Empty title="No hay solicitudes" icon="checks">Su contador no tiene solicitudes pendientes.</Empty>} columns={[
                { key: 't', label: 'Documento', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.title}</div><div className="dim xs">{r.description}</div></div> }, { key: 'p', label: 'Periodo', render: (r) => r.period || '—' },
                { key: 'd', label: 'Fecha límite', render: (r) => date(r.due_date) }, { key: 's', label: 'Estado', render: (r) => <Badge status={r.status === 'recibido' ? 'aprobado' : r.status}>{L(r.status)}</Badge> },
                { key: 'a', label: '', render: (r) => r.status === 'pendiente' && <Button size="s" onClick={() => setUpload(true)}>Subir</Button> }]} />
            </Card>}
            {tab === 'documentos' && <Card title="Documentos" subtitle="Entregables autorizados por su contador y archivos que usted ha enviado." pad={false}>
              <Table rows={data.docs} empty={<Empty title="Sin documentos" icon="file" />} columns={[
                { key: 't', label: 'Documento', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.title}</div><div className="dim xs">{r.source === 'firma' ? 'Entregado por la firma' : 'Enviado por usted'}</div></div> },
                { key: 'p', label: 'Periodo', render: (r) => r.period || '—' }, { key: 'at', label: 'Fecha', render: (r) => date(r.created_at) },
                { key: 'a', label: '', render: (r) => <Button size="s" variant="outline" icon="download" onClick={() => download(r)}>Descargar</Button> }]} />
            </Card>}
            {tab === 'perfil' && <Profile client={data.client} onSaved={reload} />}
            <p className="dim xs center"><Icon name="lock" size={12} /> Sus archivos se guardan en almacenamiento privado y solo su firma contable puede consultarlos.</p>
          </>}
        </main>
      </div>
      <AccountModal open={account} onClose={() => setAccount(false)} />
      <UploadModal open={upload} asClient clientIdOverride={clientId} onClose={() => setUpload(false)} onDone={() => { setUpload(false); reload(); }} />
    </>
  );
}

function Profile({ client, onSaved }: any) {
  const toast = useToast(); const [v, setV] = useState({ email: client?.email || '', phone: client?.phone || '', address: client?.address || '' });
  const save = async () => { const r = await db.rpc('client_update_contact', { p_client: client.id, p_email: v.email, p_phone: v.phone, p_address: v.address }); if (r.error) return toast(r.error.message, 'bad'); toast('Datos actualizados'); onSaved(); };
  return (
    <Card title="Datos de contacto">
      <dl className="kv mb"><dt>Razón social</dt><dd>{client?.name}</dd><dt>Identificación</dt><dd>{client?.id_type} {client?.id_number}{client?.dv ? '-' + client.dv : ''}</dd></dl>
      <div className="form-grid">
        <Field label="Correo"><Input type="email" value={v.email} onChange={(e: any) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Teléfono"><Input type="tel" value={v.phone} onChange={(e: any) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Dirección" className="full"><Input value={v.address} onChange={(e: any) => setV({ ...v, address: e.target.value })} /></Field>
      </div>
      <div className="mt"><Button onClick={save}>Guardar</Button></div>
      <Alert kind="info">Para cambiar la razón social o la identificación, solicítelo a su contador.</Alert>
    </Card>
  );
}
