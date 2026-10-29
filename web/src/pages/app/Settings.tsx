import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db, storage } from '../../lib/sb';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, Select, Stat, Table, Tabs, Textarea, useToast } from '../../components/ui';
import { useClients } from '../../components/AppShell';
import { CardView, type PublicFirm } from '../public/FirmCard';
import { qrDataUrl, qrPng, qrSvg } from '../../lib/qr';
import { downloadBlob, sha256 } from '../../lib/files';
import { date, dateTime, L } from '../../lib/format';
import { useQueryParam } from '../../lib/router';
import { exportXLSX } from '../../lib/export';

const TABS = [
  { id: 'marca', label: 'Marca e identidad' }, { id: 'tarjeta', label: 'Tarjeta y QR' }, { id: 'equipo', label: 'Equipo' }, { id: 'permisos', label: 'Permisos' },
  { id: 'automatizaciones', label: 'Automatizaciones' }, { id: 'canales', label: 'Correo y WhatsApp' }, { id: 'privacidad', label: 'Protección de datos' },
  { id: 'citas', label: 'Citas' }, { id: 'auditoria', label: 'Auditoría' }, { id: 'plan', label: 'Plan y uso' },
];

export function Settings() {
  const s = useSession();
  const [tab, setTab] = useState(useQueryParam('tab') || (location.hash ? location.hash.slice(1) : 'marca'));
  if (s.role !== 'admin') return <Empty title="Solo para el contador administrador" icon="lock" />;
  return (
    <>
      <div className="page-h"><div><h2>Configuración de la firma</h2><p className="muted small">{s.org?.name} · identificador público <span className="mono">{s.org?.slug}</span></p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={TABS} />
      {tab === 'marca' && <Brand />}{tab === 'tarjeta' && <CardQr />}{tab === 'equipo' && <Team />}{tab === 'permisos' && <Permissions />}
      {tab === 'automatizaciones' && <Automations />}{tab === 'canales' && <Channels />}{tab === 'privacidad' && <Privacy />}
      {tab === 'citas' && <Appointments />}{tab === 'auditoria' && <Audit />}{tab === 'plan' && <Plan />}
    </>
  );
}

function useFirm() {
  const s = useSession();
  return useAsync(async () => (await db.from('firm_profiles').select('*').eq('org_id', s.org!.id).maybeSingle()).data as any, [s.org?.id]);
}

function Brand() {
  const s = useSession(); const toast = useToast(); const { data, loading, reload } = useFirm();
  const [v, setV] = useState<any>(null); const [org, setOrg] = useState<any>({}); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setV({ ...data, services: (data.services || []).join('\n'), socials: data.socials || {} }); setOrg({ name: s.org!.name, legal_name: s.org!.legal_name || '', nit: s.org!.nit || '', require_segregation: s.org!.require_segregation }); } }, [data]);
  if (loading || !v) return <Loading />;
  const upload = async (kind: 'logo_url' | 'photo_url', f?: File) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 3 * 1024 * 1024) return toast('Use PNG, JPG o WEBP de máximo 3 MB', 'bad');
    const path = `${s.org!.id}/${kind === 'logo_url' ? 'logo' : 'foto'}-${(await sha256(await f.arrayBuffer())).slice(0, 12)}.${f.type.split('/')[1]}`;
    const r = await storage.replace('marca', path, f, f.type);
    if (r.error) return toast(r.error.message, 'bad');
    setV({ ...v, [kind]: storage.publicUrl('marca', path) }); toast('Imagen cargada; recuerde guardar');
  };
  const save = async () => {
    if (!v.commercial_name?.trim()) return toast('El nombre comercial es obligatorio', 'bad');
    for (const k of ['color_primary', 'color_secondary', 'color_accent']) if (!/^#[0-9a-fA-F]{6}$/.test(v[k])) return toast('Colores en formato #RRGGBB', 'bad');
    setBusy(true);
    const socials = Object.fromEntries(Object.entries(v.socials || {}).filter(([, u]) => typeof u === 'string' && /^https:\/\//.test(u as string)));
    const r1 = await db.from('firm_profiles').update({ commercial_name: v.commercial_name.trim(), accountant_name: v.accountant_name || null, headline: v.headline || null, description: v.description || null,
      services: v.services.split('\n').map((x: string) => x.trim()).filter(Boolean).slice(0, 20), phone: v.phone || null, whatsapp: v.whatsapp || null, email: v.email || null, address: v.address || null,
      map_url: v.map_url || null, hours: v.hours || null, socials, logo_url: v.logo_url || null, photo_url: v.photo_url || null, color_primary: v.color_primary, color_secondary: v.color_secondary,
      color_accent: v.color_accent, custom_domain: v.custom_domain || null, is_published: v.is_published }).eq('org_id', s.org!.id);
    const r2 = await db.from('organizations').update({ name: org.name, legal_name: org.legal_name || null, nit: org.nit || null, require_segregation: org.require_segregation }).eq('id', s.org!.id);
    setBusy(false);
    if (r1.error || r2.error) return toast((r1.error || r2.error)!.message, 'bad');
    toast('Identidad guardada'); reload(); s.reload();
  };
  const f = (k: string) => ({ value: v[k] || '', onChange: (e: any) => setV({ ...v, [k]: e.target.value }) });
  return (
    <div className="grid g2">
      <Card title="Datos de la firma" subtitle="El nombre CONTABILIDAD DIGITAL es provisional: cámbielo aquí cuando esté definido.">
        <div className="form-grid">
          <Field label="Nombre comercial (marca)" className="full"><Input {...f('commercial_name')} /></Field>
          <Field label="Nombre interno de la organización"><Input value={org.name} onChange={(e: any) => setOrg({ ...org, name: e.target.value })} /></Field>
          <Field label="Razón social"><Input value={org.legal_name} onChange={(e: any) => setOrg({ ...org, legal_name: e.target.value })} /></Field>
          <Field label="NIT de la firma"><Input value={org.nit} onChange={(e: any) => setOrg({ ...org, nit: e.target.value })} /></Field>
          <Field label="Nombre del contador"><Input {...f('accountant_name')} /></Field>
          <Field label="Título o eslogan" className="full"><Input {...f('headline')} placeholder="Contador público · Asesoría tributaria" /></Field>
          <Field label="Descripción profesional" className="full"><Textarea {...f('description')} /></Field>
          <Field label="Servicios (uno por línea)" className="full"><Textarea {...f('services')} rows={4} /></Field>
        </div>
        <label className="check mt"><input type="checkbox" checked={org.require_segregation} onChange={(e: any) => setOrg({ ...org, require_segregation: e.target.checked })} />
          <span>Exigir separación de funciones: quien prepara un comprobante no puede aprobarlo.</span></label>
      </Card>
      <Card title="Contacto, imagen y colores">
        <div className="form-grid">
          <Field label="Teléfono"><Input type="tel" {...f('phone')} /></Field><Field label="WhatsApp"><Input type="tel" {...f('whatsapp')} placeholder="3001234567" /></Field>
          <Field label="Correo"><Input type="email" {...f('email')} /></Field><Field label="Horario de atención"><Input {...f('hours')} placeholder="Lun a vie 8:00 a 17:00" /></Field>
          <Field label="Dirección" className="full"><Input {...f('address')} /></Field>
          <Field label="Enlace de mapa (https)" className="full"><Input {...f('map_url')} /></Field>
          {['facebook', 'instagram', 'linkedin', 'tiktok', 'web'].map((k) => <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><Input value={v.socials?.[k] || ''} placeholder="https://…" onChange={(e: any) => setV({ ...v, socials: { ...v.socials, [k]: e.target.value } })} /></Field>)}
          <Field label="Dominio personalizado" hint="Cuando esté disponible"><Input {...f('custom_domain')} /></Field>
          <Field label="Logotipo"><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e: any) => upload('logo_url', e.target.files?.[0])} /></Field>
          <Field label="Fotografía del contador"><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e: any) => upload('photo_url', e.target.files?.[0])} /></Field>
          <Field label="Color principal"><Input type="color" {...f('color_primary')} /></Field><Field label="Color de fondo"><Input type="color" {...f('color_secondary')} /></Field>
          <Field label="Color de acento (dorado)"><Input type="color" {...f('color_accent')} /></Field>
        </div>
        <label className="check mt"><input type="checkbox" checked={v.is_published} onChange={(e: any) => setV({ ...v, is_published: e.target.checked })} /><span><strong>Publicar tarjeta digital.</strong> Solo se muestran estos datos de contacto; nunca información de clientes.</span></label>
        <div className="mt"><Button loading={busy} onClick={save}>Guardar cambios</Button></div>
      </Card>
    </div>
  );
}

function CardQr() {
  const s = useSession(); const toast = useToast(); const { data, loading } = useFirm();
  const [ref, setRef] = useState(''); const [fg, setFg] = useState('#0b1530');
  const base = `${location.origin}/f/${s.org!.slug}`;
  const url = ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
  const svg = useMemo(() => qrDataUrl(url, { dark: fg }), [url, fg]);
  const { data: visits } = useAsync(async () => ((await db.from('card_visits').select('card_ref,at').eq('org_id', s.org!.id).order('at', { ascending: false }).limit(2000)).data as any[]) || [], []);
  if (loading || !data) return <Loading />;
  const f: PublicFirm = { ...data, slug: s.org!.slug, services: data.services || [], socials: data.socials || {} };
  const byRef = Object.entries((visits || []).reduce((m: any, v: any) => { const k = v.card_ref || '(directo)'; m[k] = (m[k] || 0) + 1; return m; }, {}));
  const printCard = () => {
    const w = window.open('', '_blank', 'width=900,height=700'); if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Tarjeta ${f.commercial_name}</title><style>
      @page{size:A4;margin:12mm}body{font-family:system-ui,sans-serif;margin:0}.grid{display:grid;grid-template-columns:repeat(2,85.6mm);gap:6mm}
      .c{width:85.6mm;height:54mm;border-radius:3mm;overflow:hidden;display:flex;gap:3mm;padding:4mm;box-sizing:border-box;color:#fff;background:linear-gradient(135deg,${f.color_secondary},#0d2b45 60%,${f.color_primary});-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .t{flex:1;display:flex;flex-direction:column;justify-content:space-between;font-size:2.7mm}.n{font-size:4.2mm;font-weight:800}.g{color:${f.color_accent};font-weight:700;letter-spacing:.08em;font-size:2.4mm}
      .q{background:#fff;border-radius:2mm;padding:1.4mm;align-self:center}.q img{width:30mm;height:30mm;display:block}</style></head><body><div class="grid">
      ${Array.from({ length: 8 }).map(() => `<div class="c"><div class="t"><div><div class="g">${esc(f.commercial_name.toUpperCase())}</div><div class="n">${esc(f.accountant_name || f.commercial_name)}</div><div>${esc(f.headline || '')}</div></div>
      <div>${esc(f.phone || '')}<br>${esc(f.email || '')}<br>${esc(f.address || '')}</div></div><div class="q"><img src="${qrDataUrl(url, { dark: '#000' })}"></div></div>`).join('')}
      </div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };
  return (
    <div className="grid g2">
      <Card title="Código QR permanente" subtitle="Apunta a una dirección fija: si cambia sus datos, las tarjetas impresas siguen funcionando.">
        {!data.is_published && <Alert kind="warn">La tarjeta no está publicada. Actívela en "Marca e identidad" para que el QR funcione.</Alert>}
        <div className="row gap-l wrap mt" style={{ alignItems: 'flex-start' }}>
          <div className="qr-box"><img src={svg} alt={`Código QR hacia ${url}`} /></div>
          <div className="col gap grow">
            <Field label="Identificador de campaña (opcional)" hint="Para saber qué tarjeta o material generó la visita. Sin datos personales."><Input value={ref} onChange={(e: any) => setRef(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40))} placeholder="feria-2026" /></Field>
            <Field label="Color del QR"><Input type="color" value={fg} onChange={(e: any) => setFg(e.target.value)} /></Field>
            <Field label="Dirección"><Input value={url} readOnly onFocus={(e: any) => e.target.select()} /></Field>
            <div className="row gap-s wrap">
              <Button size="s" onClick={async () => downloadBlob(await qrPng(url, 1600, { dark: fg }), `qr-${s.org!.slug}${ref ? '-' + ref : ''}.png`)}>Descargar PNG</Button>
              <Button size="s" variant="outline" onClick={() => downloadBlob(new Blob([qrSvg(url, { dark: fg })], { type: 'image/svg+xml' }), `qr-${s.org!.slug}${ref ? '-' + ref : ''}.svg`)}>Descargar SVG</Button>
              <Button size="s" variant="outline" onClick={() => { navigator.clipboard?.writeText(url).then(() => toast('Enlace copiado')); }}>Copiar enlace</Button>
              <a className="btn btn-s btn-ghost" href={url} target="_blank" rel="noopener">Probar enlace</a>
              <Button size="s" variant="gold" onClick={printCard}>Tarjetas para imprimir</Button>
            </div>
          </div>
        </div>
        <h4 className="mt-l">Visitas por origen</h4>
        <Table dense rowKey="0" rows={byRef.map(([k, n]) => ({ 0: k, k, n }))} empty={<p className="muted small mt-s">Aún no hay visitas registradas.</p>} columns={[{ key: 'k', label: 'Origen' }, { key: 'n', label: 'Visitas', num: true }]} />
      </Card>
      <Card title="Vista previa de la tarjeta"><div className="row" style={{ justifyContent: 'center' }}><CardView f={f} preview /></div></Card>
    </div>
  );
}
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function Team() {
  const s = useSession(); const toast = useToast(); const { clients } = useClients();
  const { data, loading, reload } = useAsync(async () => {
    const [m, i] = await Promise.all([db.rpc('org_members', { p_org: s.org!.id }), db.from('invitations').select('*').eq('org_id', s.org!.id).eq('status', 'pendiente').order('created_at', { ascending: false })]);
    return { members: ((m.data as any[]) || []).filter((x) => x.role !== 'cliente'), inv: ((i.data as any[]) || []).filter((x) => x.role !== 'cliente') };
  }, []);
  const [inv, setInv] = useState({ email: '', role: 'auxiliar' }); const [assign, setAssign] = useState<any>(null);
  const invite = async () => {
    const r = await db.rpc('invite_member', { p_org: s.org!.id, p_email: inv.email.trim(), p_role: inv.role });
    if (r.error) return toast(r.error.message, 'bad'); toast('Invitación registrada'); setInv({ email: '', role: 'auxiliar' }); reload();
  };
  const update = async (m: any, role: string, status: string) => { const r = await db.rpc('update_member', { p_membership: m.membership_id, p_role: role, p_status: status }); if (r.error) return toast(r.error.message, 'bad'); toast('Miembro actualizado'); reload(); };
  if (loading || !data) return <Loading />;
  return (
    <>
      <Card title="Invitar al equipo" subtitle="La persona debe crear su cuenta (o ingresar) con este correo y confirmarlo; el acceso se activa automáticamente.">
        <div className="row gap-s wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Correo" className="grow"><Input type="email" value={inv.email} onChange={(e: any) => setInv({ ...inv, email: e.target.value })} /></Field>
          <Field label="Rol"><Select value={inv.role} onChange={(e: any) => setInv({ ...inv, role: e.target.value })} options={[{ value: 'auxiliar', label: 'Auxiliar contable' }, { value: 'admin', label: 'Contador administrador' }]} /></Field>
          <Button onClick={invite} icon="send">Invitar</Button>
        </div>
        <p className="dim xs mt-s">Enlace para compartir: <span className="mono">{location.origin}/registro</span>. El envío automático por correo se activa al configurar un proveedor.</p>
      </Card>
      <Card title="Miembros" pad={false}>
        <Table rows={data.members} rowKey="membership_id" columns={[
          { key: 'n', label: 'Nombre', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.full_name}{r.user_id === s.session!.user.id && ' (usted)'}</div><div className="dim xs">{r.email}</div></div> },
          { key: 'role', label: 'Rol', render: (r) => <Select value={r.role} onChange={(e: any) => update(r, e.target.value, r.status)} options={[{ value: 'auxiliar', label: 'Auxiliar' }, { value: 'admin', label: 'Administrador' }]} style={{ minHeight: 34 }} /> },
          { key: 'cl', label: 'Clientes asignados', render: (r) => r.role === 'admin' ? <span className="dim xs">Todos</span> : <Button size="s" variant="outline" onClick={() => setAssign(r)}>{(r.assigned || []).length} clientes</Button> },
          { key: 'st', label: 'Estado', render: (r) => <Button size="s" variant="ghost" onClick={() => update(r, r.role, r.status === 'activa' ? 'suspendida' : 'activa')}><Badge status={r.status} /></Button> },
        ]} />
      </Card>
      {data.inv.length > 0 && <Card title="Invitaciones pendientes" pad={false}><Table dense rows={data.inv} columns={[{ key: 'email', label: 'Correo' }, { key: 'role', label: 'Rol', render: (r) => L(r.role) }, { key: 'e', label: 'Vence', render: (r) => date(r.expires_at) },
        { key: 'x', label: '', render: (r) => <Button size="s" variant="ghost" onClick={async () => { await db.from('invitations').update({ status: 'revocada' }).eq('id', r.id); reload(); }}>Revocar</Button> }]} /></Card>}
      {assign && <AssignModal member={assign} clients={clients} onClose={() => setAssign(null)} onDone={() => { setAssign(null); reload(); }} />}
    </>
  );
}

function AssignModal({ member, clients, onClose, onDone }: any) {
  const toast = useToast(); const [sel, setSel] = useState<string[]>(member.assigned || []); const [q, setQ] = useState('');
  const go = async () => {
    const r = await db.rpc('set_client_assignments', { p_membership: member.membership_id, p_clients: sel });
    if (r.error) return toast(/function|no existe|Could not find/i.test(r.error.message) ? 'La función de asignación está pendiente de activar en la base de datos (ver README, migración 0006).' : r.error.message, 'bad');
    toast('Asignaciones guardadas'); onDone();
  };
  const shown = clients.filter((c: any) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open title={`Clientes de ${member.full_name}`} onClose={onClose} footer={<Button onClick={go}>Guardar</Button>}>
      <p className="small muted">El auxiliar solo verá y trabajará con los clientes seleccionados.</p>
      <Input placeholder="Filtrar…" value={q} onChange={(e: any) => setQ(e.target.value)} />
      <div className="col gap-s" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {shown.map((c: any) => <label key={c.id} className="check"><input type="checkbox" checked={sel.includes(c.id)} onChange={(e: any) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />{c.name}</label>)}
      </div>
    </Modal>
  );
}

const MODULES = ['clientes', 'documentos', 'contabilidad', 'conciliacion', 'cartera', 'tributario', 'tareas', 'informes'];
const ACTIONS = ['ver', 'crear', 'editar', 'aprobar', 'exportar'];
function Permissions() {
  const s = useSession(); const toast = useToast();
  const { data, reload } = useAsync(async () => ((await db.from('role_permissions').select('*').eq('org_id', s.org!.id).eq('role', 'auxiliar')).data as any[]) || [], []);
  const def = (m: string, a: string) => ['ver', 'crear', 'editar'].includes(a) || (m === 'informes' && a === 'exportar');
  const val = (m: string, a: string) => { const o = (data || []).find((x) => x.module === m && x.action === a); return o ? o.allowed : def(m, a); };
  const toggle = async (m: string, a: string) => {
    const r = await db.from('role_permissions').upsert({ org_id: s.org!.id, role: 'auxiliar', module: m, action: a, allowed: !val(m, a) }, { onConflict: 'org_id,role,module,action' });
    if (r.error) return toast(r.error.message, 'bad'); reload();
  };
  return (
    <Card title="Permisos del auxiliar contable" subtitle="Se verifican en el servidor y en las políticas de la base de datos. Además, el auxiliar solo accede a los clientes asignados.">
      <div className="table-wrap"><table className="table dense"><thead><tr><th>Módulo</th>{ACTIONS.map((a) => <th key={a} className="center">{L(a)}</th>)}</tr></thead>
        <tbody>{MODULES.map((m) => <tr key={m}><td data-label="Módulo" style={{ textTransform: 'capitalize' }}>{m === 'conciliacion' ? 'Conciliación' : m === 'tributario' ? 'Calendario tributario' : m}</td>
          {ACTIONS.map((a) => <td key={a} data-label={a} className="center"><input type="checkbox" checked={val(m, a)} onChange={() => toggle(m, a)} aria-label={`${m} ${a}`} style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} /></td>)}</tr>)}</tbody></table></div>
      <Alert kind="info">"Aprobar" permite contabilizar comprobantes, confirmar pagos y aprobar conciliaciones. Con la separación de funciones activa, nadie aprueba lo que preparó.</Alert>
    </Card>
  );
}

const EVENTS: Record<string, string> = { documento_recibido: 'Documento recibido → tarea de revisión', documento_faltante: 'Documento faltante → aviso al cliente', vencimiento_proximo: 'Vencimiento próximo → aviso y tarea al responsable', conciliacion_diferencias: 'Diferencias de conciliación → tarea de investigación', comprobante_devuelto: 'Comprobante devuelto → aviso y tarea al auxiliar' };
function Automations() {
  const s = useSession(); const toast = useToast();
  const { data, reload } = useAsync(async () => {
    const [r, m, j] = await Promise.all([db.from('automation_rules').select('*').eq('org_id', s.org!.id), db.rpc('org_members', { p_org: s.org!.id }), db.from('job_runs').select('*').order('at', { ascending: false }).limit(10)]);
    return { rules: (r.data as any[]) || [], staff: ((m.data as any[]) || []).filter((x) => x.role !== 'cliente'), jobs: (j.data as any[]) || [] };
  }, []);
  const upd = async (r: any, patch: any) => { const x = await db.from('automation_rules').update(patch).eq('id', r.id); if (x.error) return toast(x.error.message, 'bad'); reload(); };
  return (
    <Card title="Reglas de automatización" subtitle="Cada evento genera una sola tarea o aviso aunque se procese varias veces (clave de deduplicación). Los vencimientos se revisan cada hora." pad={false}>
      <Table rows={data?.rules || []} columns={[
        { key: 'e', label: 'Evento', render: (r) => EVENTS[r.event] || r.event },
        { key: 'a', label: 'Activa', render: (r) => <input type="checkbox" checked={r.is_active} onChange={(e: any) => upd(r, { is_active: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} aria-label="Activa" /> },
        { key: 'as', label: 'Responsable por defecto', render: (r) => <Select value={r.default_assignee_id || ''} onChange={(e: any) => upd(r, { default_assignee_id: e.target.value || null })} placeholder="Sin asignar" options={(data?.staff || []).map((x: any) => ({ value: x.user_id, label: x.full_name || x.email }))} style={{ minHeight: 34 }} /> },
        { key: 'p', label: 'Prioridad', render: (r) => <Select value={r.priority} onChange={(e: any) => upd(r, { priority: e.target.value })} options={['baja', 'media', 'alta', 'urgente']} style={{ minHeight: 34 }} /> },
        { key: 'd', label: 'Días de anticipación', render: (r) => r.event === 'vencimiento_proximo' ? <Input type="number" min={1} max={60} value={r.days_before} onChange={(e: any) => upd(r, { days_before: Math.max(1, Math.min(60, Number(e.target.value) || 5)) })} style={{ width: 90, minHeight: 34 }} /> : '—' },
      ]} />
    </Card>
  );
}

function Channels() {
  const s = useSession(); const toast = useToast();
  const { data, reload } = useAsync(async () => {
    const [c, q] = await Promise.all([db.from('channel_settings').select('*').eq('org_id', s.org!.id), db.from('outbound_messages').select('*').eq('org_id', s.org!.id).order('created_at', { ascending: false }).limit(50)]);
    return { ch: (c.data as any[]) || [], queue: (q.data as any[]) || [] };
  }, []);
  const upd = async (c: any, patch: any) => { const r = await db.from('channel_settings').update(patch).eq('org_id', c.org_id).eq('channel', c.channel); if (r.error) return toast(r.error.message, 'bad'); reload(); };
  return (
    <>
      <Alert kind="warn">No se envían mensajes reales hasta que el canal esté habilitado <strong>y</strong> el servidor tenga credenciales de un proveedor autorizado. Los mensajes nunca incluyen cifras ni datos financieros: solo invitan a ingresar a la plataforma.</Alert>
      <div className="grid g2">
        {(data?.ch || []).map((c) => (
          <Card key={c.channel} title={c.channel === 'email' ? 'Correo electrónico' : 'WhatsApp'} actions={c.provider_configured ? <Badge t="ok">Proveedor configurado</Badge> : <Badge t="warn">Sin credenciales</Badge>}>
            <label className="check"><input type="checkbox" checked={c.enabled} onChange={(e: any) => upd(c, { enabled: e.target.checked })} /><span>Habilitar envíos por este canal</span></label>
            <div className="form-grid mt">
              <Field label="Proveedor" hint={c.channel === 'email' ? 'Ej.: Resend (secretos RESEND_API_KEY y MAIL_FROM)' : 'Requiere un proveedor autorizado de la API de WhatsApp Business y plantillas aprobadas'}><Input value={c.provider || ''} onChange={(e: any) => upd(c, { provider: e.target.value })} /></Field>
              <Field label="Máximo de mensajes por hora"><Input type="number" min={1} max={1000} value={c.max_per_hour} onChange={(e: any) => upd(c, { max_per_hour: Number(e.target.value) || 30 })} /></Field>
            </div>
            <p className="dim xs mt-s">Tipos de aviso permitidos: {(c.allowed_kinds || []).map((k: string) => L(k)).join(', ')}</p>
          </Card>
        ))}
      </div>
      <Card title="Registro de envíos" pad={false}><Table dense rows={data?.queue || []} empty={<p className="muted small" style={{ padding: 16 }}>Sin mensajes en cola.</p>} columns={[
        { key: 'at', label: 'Fecha', render: (r) => dateTime(r.created_at) }, { key: 'ch', label: 'Canal' }, { key: 'to', label: 'Destino', render: (r) => r.to_address.replace(/(.{2}).+(@.+)/, '$1•••$2') },
        { key: 'k', label: 'Tipo', render: (r) => L(r.kind) }, { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> }, { key: 'e', label: 'Detalle', render: (r) => r.last_error || '—' }]} /></Card>
    </>
  );
}

function Privacy() {
  const s = useSession(); const toast = useToast();
  const { data, reload } = useAsync(async () => {
    const [p, r] = await Promise.all([db.from('privacy_policies').select('*').eq('org_id', s.org!.id).order('created_at', { ascending: false }), db.from('data_subject_requests').select('*').eq('org_id', s.org!.id).order('created_at', { ascending: false })]);
    return { policies: (p.data as any[]) || [], reqs: (r.data as any[]) || [] };
  }, []);
  const [pol, setPol] = useState<any>(null); const [req, setReq] = useState<any>(null);
  const template = `POLÍTICA DE TRATAMIENTO DE DATOS PERSONALES\n\nResponsable: [razón social], NIT [número], [dirección], [correo], [teléfono].\n\nFinalidades: prestación de servicios contables y tributarios, gestión de la relación con clientes, cumplimiento de obligaciones legales y atención de solicitudes.\n\nDerechos del titular (Ley 1581 de 2012): conocer, actualizar y rectificar sus datos; solicitar prueba de la autorización; ser informado del uso; presentar quejas ante la Superintendencia de Industria y Comercio; revocar la autorización o solicitar la supresión cuando proceda; acceder gratuitamente a sus datos.\n\nProcedimiento: las consultas y reclamos se radican en ${location.origin}/f/${s.org!.slug}/privacidad o al correo [correo], y se atienden dentro de los términos legales.\n\n[Revise y complete este texto con su asesor legal antes de publicarlo.]`;
  const savePol = async (publish: boolean) => {
    const row = { version: pol.version, content: pol.content, published_at: publish ? new Date().toISOString() : null };
    const r = pol.id ? await db.from('privacy_policies').update(row).eq('id', pol.id) : await db.from('privacy_policies').insert({ ...row, org_id: s.org!.id });
    if (r.error) return toast(r.error.message, 'bad'); toast(publish ? 'Política publicada' : 'Borrador guardado'); setPol(null); reload();
  };
  const saveReq = async () => { const r = await db.from('data_subject_requests').update({ status: req.status, response: req.response || null, handled_by: s.session!.user.id }).eq('id', req.id); if (r.error) return toast(r.error.message, 'bad'); setReq(null); reload(); };
  return (
    <>
      <Alert kind="info">Herramientas para gestionar la política de tratamiento, las autorizaciones y las solicitudes de titulares (Ley 1581 de 2012 y su reglamentación). La plataforma no constituye asesoría legal ni certifica cumplimiento.</Alert>
      <Card title="Políticas de tratamiento" actions={<Button size="s" icon="plus" onClick={() => setPol({ version: String((data?.policies.length || 0) + 1), content: data?.policies[0]?.content || template })}>Nueva versión</Button>} pad={false}>
        <Table dense rows={data?.policies || []} onRow={(r) => setPol(r)} empty={<p className="muted small" style={{ padding: 16 }}>Sin políticas. Cree la primera a partir de la plantilla.</p>} columns={[{ key: 'version', label: 'Versión' }, { key: 'p', label: 'Publicada', render: (r) => r.published_at ? dateTime(r.published_at) : <Badge t="muted">Borrador</Badge> }, { key: 'c', label: 'Creada', render: (r) => date(r.created_at) }]} />
      </Card>
      <Card title="Solicitudes de titulares" subtitle="Consultas: plazo de referencia 10 días hábiles. Reclamos: 15 días hábiles. Verifique los términos vigentes." pad={false}>
        <Table rows={data?.reqs || []} onRow={(r) => setReq(r)} empty={<Empty title="Sin solicitudes" icon="shield" />} columns={[
          { key: 'n', label: 'Titular', render: (r) => <div>{r.requester_name}<div className="dim xs">{r.requester_email}</div></div> }, { key: 't', label: 'Tipo', render: (r) => L(r.request_type) },
          { key: 'd', label: 'Vence (ref.)', render: (r) => date(r.due_date) }, { key: 's', label: 'Estado', render: (r) => <Badge status={r.status} /> }]} />
      </Card>
      {pol && <Modal open wide title={`Política v${pol.version}`} onClose={() => setPol(null)} footer={<><Button variant="outline" onClick={() => savePol(false)}>Guardar borrador</Button><Button onClick={() => savePol(true)}>Publicar</Button></>}>
        <Field label="Versión"><Input value={pol.version} onChange={(e: any) => setPol({ ...pol, version: e.target.value })} /></Field>
        <Field label="Contenido"><Textarea rows={16} value={pol.content} onChange={(e: any) => setPol({ ...pol, content: e.target.value })} /></Field>
      </Modal>}
      {req && <Modal open title="Solicitud de titular" onClose={() => setReq(null)} footer={<Button onClick={saveReq}>Guardar</Button>}>
        <dl className="kv"><dt>Titular</dt><dd>{req.requester_name} · {req.requester_email}</dd><dt>Documento</dt><dd>{req.requester_id_number || '—'}</dd><dt>Tipo</dt><dd>{L(req.request_type)}</dd><dt>Radicada</dt><dd>{dateTime(req.created_at)}</dd><dt>Descripción</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{req.description}</dd></dl>
        <Field label="Estado"><Select value={req.status} onChange={(e: any) => setReq({ ...req, status: e.target.value })} options={['recibida', 'en_tramite', 'respondida', 'rechazada']} /></Field>
        <Field label="Respuesta / gestión"><Textarea value={req.response || ''} onChange={(e: any) => setReq({ ...req, response: e.target.value })} /></Field>
        <p className="dim xs">La respuesta debe enviarse al correo del titular. Las supresiones se ejecutan por el administrador respetando las obligaciones legales de conservación documental.</p>
      </Modal>}
    </>
  );
}

function Appointments() {
  const s = useSession();
  const { data, reload } = useAsync(async () => ((await db.from('appointment_requests').select('*').eq('org_id', s.org!.id).order('created_at', { ascending: false })).data as any[]) || [], []);
  return (
    <Card title="Solicitudes de cita desde la tarjeta digital" pad={false}>
      <Table rows={data || []} empty={<Empty title="Sin solicitudes" icon="calendar" />} columns={[
        { key: 'n', label: 'Persona', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div className="dim xs">{r.phone} {r.email}</div></div> },
        { key: 'm', label: 'Mensaje', render: (r) => <span className="small">{r.message || '—'}</span> }, { key: 'd', label: 'Fecha preferida', render: (r) => date(r.preferred_date) },
        { key: 'ref', label: 'Origen', render: (r) => r.card_ref || 'directo' }, { key: 'at', label: 'Recibida', render: (r) => dateTime(r.created_at) },
        { key: 's', label: 'Estado', render: (r) => <Select value={r.status} onChange={async (e: any) => { await db.from('appointment_requests').update({ status: e.target.value }).eq('id', r.id); reload(); }} options={['nueva', 'contactada', 'agendada', 'descartada']} style={{ minHeight: 34 }} /> },
      ]} />
    </Card>
  );
}

function Audit() {
  const s = useSession();
  const [entity, setEntity] = useState(''); const [action, setAction] = useState(''); const [from, setFrom] = useState('');
  const { data, loading } = useAsync(async () => {
    let q = db.from('audit_log').select('id,at,user_id,action,entity,entity_id,result,reason').eq('org_id', s.org!.id);
    if (entity) q = q.eq('entity', entity); if (action) q = q.eq('action', action); if (from) q = q.gte('at', from);
    const [a, m] = await Promise.all([q.order('at', { ascending: false }).limit(500), db.rpc('org_members', { p_org: s.org!.id })]);
    return { rows: (a.data as any[]) || [], members: (m.data as any[]) || [] };
  }, [entity, action, from]);
  const who = (id: string) => data?.members.find((m: any) => m.user_id === id)?.full_name || (id ? id.slice(0, 8) : 'Sistema');
  return (
    <Card title="Registro de auditoría" subtitle="Inmodificable: nadie puede editar ni borrar estos registros desde la plataforma." pad={false} actions={<>
      <Select value={entity} onChange={(e: any) => setEntity(e.target.value)} placeholder="Toda entidad" options={['clients', 'documents', 'vouchers', 'voucher_lines', 'periods', 'memberships', 'role_permissions', 'reconciliation_matches', 'bank_statements', 'payments', 'informe', 'auth'].map((x) => ({ value: x, label: x }))} style={{ minHeight: 34 }} />
      <Select value={action} onChange={(e: any) => setAction(e.target.value)} placeholder="Toda acción" options={['insert', 'update', 'delete', 'reverso', 'exportacion', 'importacion', 'periodo_cerrado', 'periodo_abierto', 'sin_correspondencia'].map((x) => ({ value: x, label: x }))} style={{ minHeight: 34 }} />
      <Input type="date" value={from} onChange={(e: any) => setFrom(e.target.value)} style={{ minHeight: 34 }} />
      <Button size="s" variant="outline" disabled={!data?.rows.length} onClick={() => exportXLSX({ orgId: s.org!.id, title: 'Auditoría', filename: 'auditoria', headers: ['Fecha', 'Usuario', 'Acción', 'Entidad', 'Registro', 'Resultado', 'Motivo'], rows: data!.rows.map((r) => [r.at, who(r.user_id), r.action, r.entity, r.entity_id, r.result, r.reason]) })}>Exportar</Button></>}>
      {loading ? <Loading /> : <Table dense rows={data?.rows || []} empty={<Empty title="Sin eventos" />} columns={[
        { key: 'at', label: 'Fecha', render: (r) => dateTime(r.at) }, { key: 'u', label: 'Usuario', render: (r) => who(r.user_id) }, { key: 'a', label: 'Acción', render: (r) => <Badge t={r.action === 'delete' ? 'bad' : r.action === 'insert' ? 'ok' : 'info'}>{r.action}</Badge> },
        { key: 'e', label: 'Entidad' }, { key: 'id', label: 'Registro', render: (r) => <span className="mono xs">{(r.entity_id || '').slice(0, 13)}</span> }, { key: 'r', label: 'Motivo', render: (r) => r.reason || '—' }]} />}
    </Card>
  );
}

function Plan() {
  const s = useSession(); const toast = useToast();
  const { data } = useAsync(async () => (await db.rpc('org_usage', { p_org: s.org!.id })).data as any, []);
  const [hours, setHours] = useState(24); const [reason, setReason] = useState(''); const [supId, setSupId] = useState('');
  const { data: grants, reload } = useAsync(async () => ((await db.from('support_access_grants').select('*').eq('org_id', s.org!.id).order('created_at', { ascending: false })).data as any[]) || [], []);
  if (!data) return <Loading />;
  const p = data.plan || {};
  const grant = async () => {
    const r = await db.from('support_access_grants').insert({ org_id: s.org!.id, superadmin_id: supId.trim(), granted_by: s.session!.user.id, reason, expires_at: new Date(Date.now() + hours * 3600000).toISOString() });
    if (r.error) return toast(r.error.message, 'bad'); toast('Acceso de soporte autorizado'); setReason(''); reload();
  };
  return (
    <>
      <div className="grid g4">
        <Stat label="Plan" value={p.name || '—'} hint={p.price_cop ? `$ ${Number(p.price_cop).toLocaleString('es-CO')} / mes` : 'Precio por definir'} t="gold" />
        <Stat label="Usuarios internos" value={`${data.users} / ${p.max_users ?? '∞'}`} /><Stat label="Clientes" value={`${data.clients} / ${p.max_clients ?? '∞'}`} />
        <Stat label="Almacenamiento" value={`${data.storage_mb} MB`} hint={`de ${p.max_storage_mb ?? '∞'} MB · ${data.documents_month} docs este mes`} />
      </div>
      <Alert kind="info">Los cobros en línea no están activos. Se habilitarán cuando se integre y pruebe un proveedor de pagos con sus webhooks.</Alert>
      <Card title="Acceso excepcional de soporte" subtitle="El equipo de la plataforma no ve sus documentos por defecto. Solo con su autorización, por tiempo limitado (máx. 72 h) y con motivo; queda auditado.">
        <div className="form-grid">
          <Field label="Identificador del usuario de soporte"><Input value={supId} onChange={(e: any) => setSupId(e.target.value)} placeholder="UUID entregado por soporte" /></Field>
          <Field label="Duración"><Select value={String(hours)} onChange={(e: any) => setHours(Number(e.target.value))} options={['4', '24', '72'].map((h) => ({ value: h, label: `${h} horas` }))} /></Field>
          <Field label="Motivo" className="full"><Textarea value={reason} onChange={(e: any) => setReason(e.target.value)} /></Field>
        </div>
        <div className="mt"><Button variant="outline" disabled={reason.trim().length < 10 || !/^[0-9a-f-]{36}$/.test(supId.trim())} onClick={grant}>Autorizar acceso</Button></div>
        <div className="mt"><Table dense rows={grants || []} empty={<p className="muted small">Sin accesos otorgados.</p>} columns={[{ key: 'r', label: 'Motivo', render: (r) => r.reason }, { key: 'e', label: 'Expira', render: (r) => <span className={new Date(r.expires_at) < new Date() ? 'dim' : ''}>{dateTime(r.expires_at)}</span> },
          { key: 'x', label: '', render: (r) => new Date(r.expires_at) > new Date() && <Button size="s" variant="ghost" onClick={async () => { await db.from('support_access_grants').delete().eq('id', r.id); reload(); }}>Revocar</Button> }]} /></div>
      </Card>
    </>
  );
}
