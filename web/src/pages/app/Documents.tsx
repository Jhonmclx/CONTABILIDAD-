import { useRef, useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync, useDebounced } from '../../lib/hooks';
import { db, functions, storage } from '../../lib/sb';
import { ACCEPT, checkFile, fmtBytes, safeName } from '../../lib/files';
import { Alert, Badge, Button, Card, Empty, Field, Icon, Input, Loading, Modal, Select, Table, Tabs, Textarea, cx, useToast } from '../../components/ui';
import { ClientPicker, NeedClient, useClients } from '../../components/AppShell';
import { currentPeriod, date, dateTime, L } from '../../lib/format';
import { ReviewModal } from './Review';

const DOC_TYPES = ['factura_compra', 'factura_venta', 'extracto_bancario', 'nomina', 'soporte', 'declaracion', 'certificado', 'entregable', 'otro'];

export function Documents() {
  const [tab, setTab] = useState('docs');
  return (
    <>
      <div className="page-h">
        <div><h2>Centro documental</h2><p className="muted small">Archivos privados por cliente y periodo. Descargas con enlaces temporales y registro de cada acceso.</p></div>
        <ClientPicker />
      </div>
      <NeedClient>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'docs', label: 'Documentos' }, { id: 'req', label: 'Solicitudes al cliente' }]} />
        {tab === 'docs' ? <DocList /> : <Requests />}
      </NeedClient>
    </>
  );
}

function DocList() {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const [period, setPeriod] = useState(''); const [type, setType] = useState(''); const [status, setStatus] = useState('');
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [upload, setUpload] = useState(false); const [review, setReview] = useState<any>(null); const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState<any>(null);
  const { data, loading, reload } = useAsync(async () => {
    if (!clientId) return [];
    let qq = db.from('documents').select('*,extraction:extractions(id,status,provider,issues,error)').eq('client_id', clientId).neq('status', 'archivado');
    if (period) qq = qq.eq('period', period); if (type) qq = qq.eq('doc_type', type); if (status) qq = qq.eq('status', status);
    if (dq.trim()) { const t = dq.trim().replace(/[,()]/g, ' '); qq = qq.or(`title.ilike.*${t}*,tags.cs.{${t}}`); }
    return ((await qq.order('created_at', { ascending: false }).limit(300)).data as any[]) || [];
  }, [clientId, period, type, status, dq]);

  const open = async (d: any, download = false) => {
    const r = await storage.signedUrl('documentos', d.storage_path, 300, download ? d.title : undefined);
    if (r.error) return toast(r.error.message, 'bad');
    db.from('document_events').insert({ document_id: d.id, org_id: d.org_id, user_id: s.session!.user.id, event: download ? 'descargado' : 'consultado' });
    window.open(r.data!, '_blank', 'noopener');
  };
  const process = async (d: any) => {
    setBusyId(d.id);
    const r = await functions.invoke('process-document', { document_id: d.id });
    setBusyId(null);
    if (r.error) toast(r.error.message, 'bad');
    else if (r.data?.status === 'pendiente_proveedor') toast('Sin proveedor OCR configurado: registre los datos manualmente desde "Revisar".', 'info');
    else toast(r.data?.issues?.length ? 'Extraído con observaciones: requiere revisión' : 'Datos extraídos del XML');
    reload();
  };
  const patch = async (d: any, values: any, msg: string) => {
    const r = await db.from('documents').update(values).eq('id', d.id);
    if (r.error) return toast(r.error.message, 'bad');
    toast(msg); reload();
  };
  const canEdit = s.can('documentos', 'editar');
  return (
    <>
      <div className="toolbar">
        <Input className="input search" placeholder="Buscar por título o etiqueta…" value={q} onChange={(e: any) => setQ(e.target.value)} />
        <Input type="month" value={period} onChange={(e: any) => setPeriod(e.target.value)} aria-label="Periodo" />
        <Select value={type} onChange={(e: any) => setType(e.target.value)} placeholder="Todos los tipos" options={DOC_TYPES} />
        <Select value={status} onChange={(e: any) => setStatus(e.target.value)} placeholder="Todos los estados" options={['recibido', 'en_proceso', 'procesado', 'requiere_revision', 'error']} />
        <div className="grow" />
        {s.can('documentos', 'crear') && <Button icon="upload" onClick={() => setUpload(true)}>Cargar documentos</Button>}
      </div>
      <Card pad={false}>
        {loading ? <Loading /> : <Table rows={data || []} empty={<Empty title="Sin documentos" icon="file" action={<Button className="mt" icon="upload" onClick={() => setUpload(true)}>Cargar</Button>}>Arrastre facturas en XML o PDF, extractos y soportes del cliente.</Empty>}
          columns={[
            { key: 'title', label: 'Documento', render: (r) => <div><div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.title}</div>
              <div className="dim xs">{L(r.doc_type)} · {fmtBytes(r.size_bytes)} · v{r.version}{r.source === 'cliente' ? ' · subido por el cliente' : ''}</div>
              {r.duplicate_of && <Badge t="warn">Posible duplicado</Badge>}</div> },
            { key: 'period', label: 'Periodo', render: (r) => r.period || '—' },
            { key: 'status', label: 'Estado', render: (r) => <div className="col gap-s" style={{ alignItems: 'flex-start' }}><Badge status={r.status} />
              {r.extraction?.[0] && <span className="dim xs">Extracción: {L(r.extraction[0].status)}</span>}</div> },
            { key: 'vis', label: 'Cliente lo ve', render: (r) => r.visible_to_client ? <Badge t="info">Sí</Badge> : <span className="dim xs">No</span> },
            { key: 'at', label: 'Recibido', render: (r) => date(r.created_at) },
            { key: 'acts', label: '', render: (r) => <div className="row gap-s wrap" style={{ justifyContent: 'flex-end' }}>
              <button className="icon-btn" title="Ver" aria-label="Ver" onClick={() => open(r)}><Icon name="eye" /></button>
              <button className="icon-btn" title="Descargar" aria-label="Descargar" onClick={() => open(r, true)}><Icon name="download" /></button>
              {canEdit && ['factura_compra', 'factura_venta', 'soporte'].includes(r.doc_type) && <>
                <Button size="s" variant="outline" loading={busyId === r.id} onClick={() => process(r)} disabled={r.extraction?.[0]?.status === 'aprobado'}>Procesar</Button>
                <Button size="s" onClick={() => setReview(r)}>Revisar</Button></>}
              {canEdit && <Select value="" aria-label="Más acciones" onChange={(e: any) => {
                const v = e.target.value; e.target.value = '';
                if (v === 'vis') patch(r, { visible_to_client: !r.visible_to_client }, r.visible_to_client ? 'Oculto para el cliente' : 'Visible para el cliente');
                if (v === 'arch') patch(r, { status: 'archivado' }, 'Documento archivado');
                if (v === 'ver') setVersion(r);
              }} options={[{ value: 'vis', label: r.visible_to_client ? 'Ocultar al cliente' : 'Mostrar al cliente' }, { value: 'ver', label: 'Subir nueva versión' }, { value: 'arch', label: 'Archivar' }]} placeholder="Más…" style={{ width: 110, minHeight: 32, padding: '4px 28px 4px 8px', fontSize: 13 }} />}
            </div> },
          ]} />}
      </Card>
      <UploadModal open={upload || !!version} parent={version} onClose={() => { setUpload(false); setVersion(null); }} onDone={() => { setUpload(false); setVersion(null); reload(); }} />
      <ReviewModal doc={review} onClose={() => setReview(null)} onChanged={reload} />
    </>
  );
}

interface Item { file: File; status: 'listo' | 'validando' | 'subiendo' | 'ok' | 'error'; msg?: string; type: string }

export function UploadModal({ open, onClose, onDone, parent, asClient, clientIdOverride }: any) {
  const s = useSession(); const toast = useToast(); const shell = useClients();
  const clientId = clientIdOverride || shell.clientId;
  const [items, setItems] = useState<Item[]>([]); const [period, setPeriod] = useState(currentPeriod());
  const [over, setOver] = useState(false); const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const guess = (f: File) => /\.xml$/i.test(f.name) ? 'factura_compra' : /extracto|bancolombia|davivienda|bbva|banco/i.test(f.name) ? 'extracto_bancario' : 'soporte';
  const add = (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, parent ? 1 : 50);
    setItems((x) => [...(parent ? [] : x), ...arr.map((f) => ({ file: f, status: 'listo' as const, type: parent?.doc_type || guess(f) }))]);
  };
  const run = async () => {
    setBusy(true); let ok = 0;
    const next = [...items];
    for (let i = 0; i < next.length; i++) {
      const it = next[i]; if (it.status === 'ok') continue;
      next[i] = { ...it, status: 'validando' }; setItems([...next]);
      const c = await checkFile(it.file);
      if (c.error) { next[i] = { ...it, status: 'error', msg: c.error }; setItems([...next]); continue; }
      next[i] = { ...it, status: 'subiendo' }; setItems([...next]);
      const id = crypto.randomUUID();
      const path = `${s.org!.id}/${clientId}/${id}-${safeName(it.file.name)}`;
      const up = await storage.upload('documentos', path, it.file, c.mime);
      if (up.error) { next[i] = { ...it, status: 'error', msg: up.error.message }; setItems([...next]); continue; }
      const row: any = { id, client_id: clientId, org_id: s.org!.id, title: it.file.name, storage_path: path, mime_type: c.mime, size_bytes: it.file.size,
        sha256: c.sha256, doc_type: asClient ? 'soporte' : it.type, period: period || null, uploaded_by: s.session!.user.id, source: asClient ? 'cliente' : 'firma' };
      if (parent) { row.parent_id = parent.id; row.version = (parent.version || 1) + 1; row.title = parent.title.replace(/( \(v\d+\))?$/, ` (v${row.version})`); row.visible_to_client = parent.visible_to_client; }
      const ins = await db.from('documents').insert(row);
      if (ins.error) { next[i] = { ...it, status: 'error', msg: ins.error.message }; setItems([...next]); continue; }
      if (parent) await db.from('documents').update({ status: 'archivado' }).eq('id', parent.id);
      next[i] = { ...it, status: 'ok' }; setItems([...next]); ok++;
    }
    setBusy(false);
    if (ok) { toast(`${ok} documento(s) cargado(s)`); if (next.every((x) => x.status === 'ok')) { setItems([]); onDone(); } }
  };
  return (
    <Modal open={open} onClose={() => { setItems([]); onClose(); }} wide title={parent ? `Nueva versión de "${parent.title}"` : 'Cargar documentos'} footer={<>
      <Button variant="ghost" onClick={() => { setItems([]); onClose(); }}>Cerrar</Button>
      <Button loading={busy} disabled={!items.some((i) => i.status !== 'ok')} onClick={run}>Cargar {items.filter((i) => i.status !== 'ok').length || ''}</Button></>}>
      <div className="form-grid">
        <Field label="Periodo contable"><Input type="month" value={period} onChange={(e: any) => setPeriod(e.target.value)} /></Field>
        <div className="small muted" style={{ alignSelf: 'end' }}>Formatos: PDF, JPG, PNG, XML, CSV, XLSX, ZIP · máx. 25 MB por archivo.</div>
      </div>
      <div className={cx('dropzone', over && 'over')} onClick={() => input.current?.click()}
        onDragOver={(e: any) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e: any) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <Icon name="upload" size={30} /><p className="mt-s"><strong>Arrastre archivos aquí</strong> o toque para seleccionarlos</p>
        <input ref={input} type="file" multiple={!parent} accept={ACCEPT} hidden onChange={(e: any) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {items.length > 0 && <div className="col gap-s">
        {items.map((it, i) => (
          <div key={i} className="row gap wrap" style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 12 }}>
            <Icon name="file" /><div className="grow small" style={{ overflowWrap: 'anywhere' }}>{it.file.name}<div className="dim xs">{fmtBytes(it.file.size)}</div></div>
            {!asClient && !parent && <Select value={it.type} disabled={it.status !== 'listo' && it.status !== 'error'} onChange={(e: any) => setItems(items.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} options={DOC_TYPES} style={{ width: 190, minHeight: 36 }} />}
            {it.status === 'ok' ? <Badge t="ok">Cargado</Badge> : it.status === 'error' ? <Badge t="bad">{it.msg}</Badge> : it.status === 'listo' ? <button className="icon-btn" aria-label="Quitar" onClick={() => setItems(items.filter((_, j) => j !== i))}><Icon name="x" /></button> : <span className="spinner" />}
          </div>
        ))}
      </div>}
    </Modal>
  );
}

function Requests() {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const { data, reload, loading } = useAsync(async () => ((await db.from('document_requests').select('*').eq('client_id', clientId).order('created_at', { ascending: false })).data as any[]) || [], [clientId]);
  const [open, setOpen] = useState(false); const [v, setV] = useState({ title: '', description: '', period: currentPeriod(), due_date: '' });
  const create = async () => {
    if (v.title.trim().length < 3) return toast('Describa el documento solicitado', 'bad');
    const r = await db.from('document_requests').insert({ client_id: clientId, org_id: s.org!.id, ...v, due_date: v.due_date || null });
    if (r.error) return toast(r.error.message, 'bad');
    toast('Solicitud enviada al portal del cliente'); setOpen(false); setV({ title: '', description: '', period: currentPeriod(), due_date: '' }); reload();
  };
  return (
    <Card title="Documentos solicitados" subtitle="El cliente los ve en su portal y recibe una notificación. Al subir un archivo, la solicitud se marca como recibida." actions={s.can('documentos', 'crear') && <Button size="s" icon="plus" onClick={() => setOpen(true)}>Nueva solicitud</Button>} pad={false}>
      {loading ? <Loading /> : <Table rows={data || []} empty={<Empty title="Sin solicitudes" icon="inbox" />} columns={[
        { key: 'title', label: 'Documento', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.title}</div><div className="dim xs">{r.description}</div></div> },
        { key: 'period', label: 'Periodo' }, { key: 'due', label: 'Plazo', render: (r) => date(r.due_date) },
        { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status === 'recibido' ? 'aprobado' : r.status}>{L(r.status)}</Badge> },
        { key: 'at', label: 'Creada', render: (r) => dateTime(r.created_at) },
        { key: 'x', label: '', render: (r) => r.status === 'pendiente' && <Button size="s" variant="ghost" onClick={async () => { await db.from('document_requests').update({ status: 'cancelado' }).eq('id', r.id); reload(); }}>Cancelar</Button> },
      ]} />}
      <Modal open={open} onClose={() => setOpen(false)} title="Solicitar documento al cliente" footer={<Button onClick={create}>Enviar solicitud</Button>}>
        <Field label="Documento solicitado"><Input value={v.title} onChange={(e: any) => setV({ ...v, title: e.target.value })} placeholder="Ej.: Extracto bancario de octubre" /></Field>
        <Field label="Detalle (opcional)"><Textarea value={v.description} onChange={(e: any) => setV({ ...v, description: e.target.value })} /></Field>
        <div className="form-grid">
          <Field label="Periodo"><Input type="month" value={v.period} onChange={(e: any) => setV({ ...v, period: e.target.value })} /></Field>
          <Field label="Fecha límite"><Input type="date" value={v.due_date} onChange={(e: any) => setV({ ...v, due_date: e.target.value })} /></Field>
        </div>
        <Alert kind="info">No incluya cifras ni datos financieros en el texto de la solicitud.</Alert>
      </Modal>
    </Card>
  );
}
