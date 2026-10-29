import { useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync, useDebounced } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, Select, Table, useToast } from '../../components/ui';
import { ClientForm, clientSchema, toClientRow } from './ClientForm';
import { navigate, useQueryParam } from '../../lib/router';
import { useClients } from '../../components/AppShell';
import { readTable, toObjects } from '../../lib/tabular';
import { exportXLSX } from '../../lib/export';
import { L, nitDV } from '../../lib/format';

export function Clients() {
  const s = useSession(); const toast = useToast(); const shell = useClients();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [status, setStatus] = useState(''); const [file, setFile] = useState(''); const [tag, setTag] = useState('');
  const [sort, setSort] = useState('name');
  const [form, setForm] = useState(useQueryParam('nuevo') === '1');
  const [importing, setImporting] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    let qq = db.from('clients').select('id,name,id_type,id_number,dv,person_type,city,status,file_status,tags,email,phone,economic_activity,created_at').eq('org_id', s.org!.id);
    if (status) qq = qq.eq('status', status);
    if (file) qq = qq.eq('file_status', file);
    if (tag) qq = qq.contains('tags', [tag]);
    if (dq.trim()) { const t = dq.trim().replace(/[,()]/g, ' '); qq = qq.or(`name.ilike.*${t}*,id_number.ilike.*${t}*,email.ilike.*${t}*`); }
    qq = sort === 'recent' ? qq.order('created_at', { ascending: false }) : qq.order(sort);
    const r = await qq.limit(500);
    if (r.error) throw new Error(r.error.message);
    return r.data as any[];
  }, [s.org?.id, dq, status, file, tag, sort]);
  const tags = useMemo(() => Array.from(new Set((data || []).flatMap((c) => c.tags || []))).sort(), [data]);
  const canCreate = s.can('clientes', 'crear');

  return (
    <>
      <div className="page-h">
        <div><h2>Clientes</h2><p className="muted small">Ficha, documentos, obligaciones y estado del expediente de cada cliente.</p></div>
        <div className="row gap-s wrap">
          <Button variant="outline" icon="download" disabled={!data?.length} onClick={() => exportXLSX({
            orgId: s.org!.id, title: 'Clientes', filename: 'clientes',
            headers: ['Nombre', 'Tipo ID', 'Identificación', 'DV', 'Persona', 'Ciudad', 'Correo', 'Teléfono', 'CIIU', 'Estado', 'Expediente', 'Etiquetas'],
            rows: (data || []).map((c) => [c.name, c.id_type, c.id_number, c.dv, L(c.person_type), c.city, c.email, c.phone, c.economic_activity, L(c.status), L(c.file_status), (c.tags || []).join(', ')]),
          })}>Exportar</Button>
          {canCreate && <Button variant="outline" icon="upload" onClick={() => setImporting(true)}>Importar</Button>}
          {canCreate && <Button icon="plus" onClick={() => setForm(true)}>Nuevo cliente</Button>}
        </div>
      </div>
      <div className="toolbar">
        <Input className="input search" placeholder="Buscar por nombre, NIT o correo…" value={q} onChange={(e: any) => setQ(e.target.value)} aria-label="Buscar clientes" />
        <Select value={status} onChange={(e: any) => setStatus(e.target.value)} placeholder="Todos los estados" options={['activo', 'prospecto', 'inactivo']} />
        <Select value={file} onChange={(e: any) => setFile(e.target.value)} placeholder="Todo expediente" options={['al_dia', 'pendiente_documentos', 'en_revision', 'con_alertas']} />
        {tags.length > 0 && <Select value={tag} onChange={(e: any) => setTag(e.target.value)} placeholder="Todas las etiquetas" options={tags.map((t) => ({ value: t, label: t }))} />}
        <Select value={sort} onChange={(e: any) => setSort(e.target.value)} options={[{ value: 'name', label: 'Orden: nombre' }, { value: 'recent', label: 'Orden: más recientes' }, { value: 'city', label: 'Orden: ciudad' }]} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading ? <Loading /> : <Table rows={data || []} onRow={(r) => navigate(`/app/clientes/${r.id}`)} empty={<Empty title="Aún no hay clientes" icon="users"
          action={canCreate && <Button className="mt" onClick={() => setForm(true)}>Crear el primero</Button>}>Cree sus clientes uno a uno o impórtelos desde una hoja de cálculo.</Empty>}
          columns={[
            { key: 'name', label: 'Cliente', render: (r) => <div><div style={{ fontWeight: 650 }}>{r.name}</div><div className="dim xs">{L(r.person_type)}{r.city ? ` · ${r.city}` : ''}</div></div> },
            { key: 'id', label: 'Identificación', render: (r) => <span className="mono">{r.id_type} {r.id_number}{r.dv ? `-${r.dv}` : ''}</span> },
            { key: 'contact', label: 'Contacto', render: (r) => <div className="small">{r.email || '—'}<div className="dim xs">{r.phone}</div></div> },
            { key: 'file', label: 'Expediente', render: (r) => <Badge status={r.file_status} /> },
            { key: 'status', label: 'Estado', render: (r) => <Badge status={r.status} /> },
          ]} />}
      </Card>
      <ClientForm open={form} onClose={() => setForm(false)} onSaved={(id) => { setForm(false); toast('Cliente guardado'); reload(); shell.reload(); navigate(`/app/clientes/${id}`); }} />
      <ImportClients open={importing} onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); shell.reload(); }} existing={data || []} />
    </>
  );
}

const MAP: Record<string, string[]> = {
  name: ['nombre', 'razon_social', 'cliente', 'name'], id_number: ['nit', 'identificacion', 'numero', 'documento', 'id_number', 'cedula'],
  id_type: ['tipo_id', 'tipo_identificacion', 'tipo_documento', 'id_type'], dv: ['dv', 'digito_verificacion'],
  person_type: ['tipo_persona', 'persona'], email: ['correo', 'email', 'correo_electronico'], phone: ['telefono', 'celular', 'phone'],
  address: ['direccion', 'address'], city: ['ciudad', 'municipio', 'city'], economic_activity: ['ciiu', 'actividad', 'actividad_economica'],
  tax_regime: ['regimen', 'regimen_tributario'], fiscal_responsibilities: ['responsabilidades', 'responsabilidades_fiscales'], tags: ['etiquetas', 'tags'],
};

function ImportClients({ open, onClose, onDone, existing }: any) {
  const s = useSession(); const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const reset = () => { setRows(null); setErr(null); };
  const pick = async (f: File | undefined) => {
    reset(); if (!f) return;
    try {
      const objs = toObjects(await readTable(f));
      if (!objs.length) throw new Error('El archivo no tiene filas.');
      if (objs.length > 2000) throw new Error('Máximo 2.000 clientes por importación.');
      const seen = new Set<string>(); const ex = new Set(existing.map((c: any) => `${c.id_type}|${c.id_number}`));
      setRows(objs.map((o, i) => {
        const v: any = { person_type: 'juridica', id_type: 'NIT', accounting_period: 'mensual', status: 'activo' };
        for (const [k, alts] of Object.entries(MAP)) { const h = alts.find((a) => o[a] !== undefined && o[a] !== ''); if (h) v[k] = o[h]; }
        v.id_number = String(v.id_number || '').replace(/[.\s]/g, '');
        const m = /^(\d+)-(\d)$/.exec(v.id_number); if (m) { v.id_number = m[1]; v.dv = m[2]; }
        v.id_type = String(v.id_type || 'NIT').toUpperCase().replace('CEDULA', 'CC');
        if (!['NIT', 'CC', 'CE', 'PAS', 'PPT', 'OTRO'].includes(v.id_type)) v.id_type = 'OTRO';
        v.person_type = /natural/i.test(v.person_type) ? 'natural' : 'juridica';
        if (v.id_type === 'NIT' && !v.dv) v.dv = nitDV(v.id_number);
        const r = clientSchema.safeParse(v); const issues = Object.values(r.errors);
        const key = `${v.id_type}|${v.id_number}`;
        if (seen.has(key)) issues.push('Duplicado dentro del archivo');
        if (ex.has(key)) issues.push('Ya existe en la plataforma');
        seen.add(key);
        return { line: i + 2, v, issues };
      }));
    } catch (e: any) { setErr(e.message); }
  };
  const valid = (rows || []).filter((r) => !r.issues.length);
  const go = async () => {
    setBusy(true);
    const payload = valid.map((r) => ({ org_id: s.org!.id, ...toClientRow(r.v) }));
    for (let i = 0; i < payload.length; i += 200) {
      const res = await db.from('clients').insert(payload.slice(i, i + 200));
      if (res.error) { setBusy(false); return setErr(`Error en el lote ${i / 200 + 1}: ${res.error.message}`); }
    }
    await db.rpc('log_event', { p_org: s.org!.id, p_action: 'importacion', p_entity: 'clients', p_reason: `${payload.length} clientes importados` });
    setBusy(false); toast(`${payload.length} clientes importados`); reset(); onDone();
  };
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} wide title="Importar clientes" footer={<>
      <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancelar</Button>
      <Button disabled={!valid.length} loading={busy} onClick={go}>Importar {valid.length || ''} válidos</Button></>}>
      <Alert kind="info">Use un archivo CSV o XLSX con encabezados como: <span className="mono">nombre, nit, dv, tipo_persona, correo, telefono, direccion, ciudad, ciiu, responsabilidades, etiquetas</span>. Verá una vista previa antes de guardar.</Alert>
      <input type="file" accept=".csv,.xlsx" className="input" onChange={(e: any) => pick(e.target.files?.[0])} />
      {err && <Alert kind="bad">{err}</Alert>}
      {rows && <>
        <p className="small"><strong>{valid.length}</strong> filas válidas · <span className="diff-bad">{rows.length - valid.length} con observaciones</span> (no se importarán)</p>
        <Table dense rows={rows.slice(0, 300)} rowKey="line" columns={[
          { key: 'line', label: 'Fila' }, { key: 'name', label: 'Nombre', render: (r) => r.v.name },
          { key: 'id', label: 'Identificación', render: (r) => `${r.v.id_type} ${r.v.id_number}${r.v.dv ? '-' + r.v.dv : ''}` },
          { key: 'email', label: 'Correo', render: (r) => r.v.email || '—' },
          { key: 'ok', label: 'Validación', render: (r) => r.issues.length ? <span className="diff-bad small">{r.issues.join(' · ')}</span> : <Badge t="ok">Lista</Badge> },
        ]} />
      </>}
    </Modal>
  );
}
