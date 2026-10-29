import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Card, Confirm, Empty, Field, Icon, Input, Loading, Modal, Select, Table, Tabs, useToast } from '../../components/ui';
import { ClientPicker, NeedClient, useClients } from '../../components/AppShell';
import { amount, currentPeriod, date, dateTime, L, money, monthBounds, today } from '../../lib/format';
import { navigate, useQueryParam } from '../../lib/router';
import { readTable, toObjects, parseAmount } from '../../lib/tabular';
import { exportXLSX } from '../../lib/export';

export function Accounting() {
  const [tab, setTab] = useState('comprobantes');
  return (
    <>
      <div className="page-h">
        <div><h2>Contabilidad</h2><p className="muted small">Comprobantes con partida doble, plan de cuentas por cliente, terceros y periodos.</p></div>
        <ClientPicker />
      </div>
      <NeedClient>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'comprobantes', label: 'Comprobantes' }, { id: 'cuentas', label: 'Plan de cuentas' }, { id: 'terceros', label: 'Terceros' }, { id: 'centros', label: 'Centros de costo' }, { id: 'periodos', label: 'Periodos' }]} />
        {tab === 'comprobantes' && <Vouchers />}
        {tab === 'cuentas' && <Accounts />}
        {tab === 'terceros' && <ThirdParties />}
        {tab === 'centros' && <CostCenters />}
        {tab === 'periodos' && <Periods />}
      </NeedClient>
    </>
  );
}

// ======================= Comprobantes =======================
function Vouchers() {
  const { clientId } = useClients(); const s = useSession();
  const initial = useQueryParam('comprobante'); const isNew = useQueryParam('nuevo') === '1';
  const [period, setPeriod] = useState(currentPeriod()); const [status, setStatus] = useState(''); const [type, setType] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(isNew ? 'new' : initial);
  const { data, loading, reload } = useAsync(async () => {
    if (!clientId) return [];
    let q = db.from('vouchers').select('id,voucher_type,number,date,description,status,source,total_debit,total_credit,prepared_by,reversal_of,reversed_by').eq('client_id', clientId);
    if (period) { const b = monthBounds(period); q = q.gte('date', b.from).lte('date', b.to); }
    if (status) q = q.eq('status', status); if (type) q = q.eq('voucher_type', type);
    return ((await q.order('date', { ascending: false }).order('number', { ascending: false }).limit(500)).data as any[]) || [];
  }, [clientId, period, status, type]);
  return (
    <>
      <div className="toolbar">
        <Input type="month" value={period} onChange={(e: any) => setPeriod(e.target.value)} aria-label="Periodo" />
        <Select value={status} onChange={(e: any) => setStatus(e.target.value)} placeholder="Todos los estados" options={['borrador', 'en_revision', 'devuelto', 'contabilizado']} />
        <Input value={type} onChange={(e: any) => setType(e.target.value.toUpperCase())} placeholder="Tipo (ej. CE)" maxLength={4} style={{ width: 120 }} />
        <div className="grow" />
        {s.can('contabilidad', 'crear') && <Button icon="plus" onClick={() => setEditing('new')}>Nuevo comprobante</Button>}
      </div>
      <Card pad={false}>
        {loading ? <Loading /> : <Table rows={data || []} onRow={(r) => setEditing(r.id)} empty={<Empty title="Sin comprobantes en el periodo" icon="book" />} columns={[
          { key: 'n', label: 'Comprobante', render: (r) => <span className="mono">{r.voucher_type}-{r.number ?? 'borrador'}</span> },
          { key: 'date', label: 'Fecha', render: (r) => date(r.date) },
          { key: 'description', label: 'Descripción', render: (r) => <div style={{ maxWidth: 420 }}>{r.description}{r.reversal_of && <div><Badge t="muted">Reverso</Badge></div>}{r.reversed_by && <div><Badge t="warn">Reversado</Badge></div>}</div> },
          { key: 'src', label: 'Origen', render: (r) => <span className="dim small">{L(r.source)}</span> },
          { key: 'd', label: 'Débitos', num: true, render: (r) => amount(r.total_debit) },
          { key: 'c', label: 'Créditos', num: true, render: (r) => amount(r.total_credit) },
          { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> },
        ]} />}
      </Card>
      {editing && <VoucherEditor id={editing === 'new' ? null : editing} onClose={() => { setEditing(null); if (initial || isNew) navigate('/app/contabilidad', { replace: true }); }} onSaved={reload} />}
    </>
  );
}

interface Line { key: string; account_id: string; third_party_id: string; cost_center_id: string; description: string; debit: string; credit: string }
const blank = (): Line => ({ key: crypto.randomUUID(), account_id: '', third_party_id: '', cost_center_id: '', description: '', debit: '', credit: '' });

function VoucherEditor({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const [vid, setVid] = useState<string | null>(id);
  const [head, setHead] = useState<any>({ voucher_type: 'CC', date: today(), description: '' });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'return' | 'reverse' | 'delete'>(null);
  const cat = useAsync(async () => {
    const [a, t, c] = await Promise.all([
      db.from('accounts').select('id,code,name,accepts_movements,is_active,requires_third_party,requires_cost_center').eq('client_id', clientId).order('code'),
      db.from('third_parties').select('id,name,id_number').eq('client_id', clientId).order('name').limit(2000),
      db.from('cost_centers').select('id,code,name').eq('client_id', clientId).eq('is_active', true).order('code'),
    ]);
    return { accounts: (a.data as any[]) || [], third: (t.data as any[]) || [], centers: (c.data as any[]) || [] };
  }, [clientId]);
  const load = async (v: string) => {
    const [h, l] = await Promise.all([db.from('vouchers').select('*').eq('id', v).maybeSingle(), db.from('voucher_lines').select('*').eq('voucher_id', v).order('line_no')]);
    if (h.data) setHead(h.data);
    const ls = ((l.data as any[]) || []).map((x) => ({ key: x.id, account_id: x.account_id, third_party_id: x.third_party_id || '', cost_center_id: x.cost_center_id || '', description: x.description || '', debit: x.debit > 0 ? String(x.debit) : '', credit: x.credit > 0 ? String(x.credit) : '' }));
    setLines(ls.length ? ls : [blank(), blank()]);
  };
  useEffect(() => { if (id) load(id); }, [id]);
  const editable = !vid || ['borrador', 'devuelto'].includes(head.status);
  const canApprove = s.can('contabilidad', 'aprobar');
  const tot = useMemo(() => lines.reduce((a, l) => ({ d: a.d + (parseAmount(l.debit) || 0), c: a.c + (parseAmount(l.credit) || 0) }), { d: 0, c: 0 }), [lines]);
  const diff = Math.round((tot.d - tot.c) * 100) / 100;
  const set = (i: number, k: keyof Line, val: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: val, ...(k === 'debit' && val ? { credit: '' } : {}), ...(k === 'credit' && val ? { debit: '' } : {}) } : l)));
  const accounts = cat.data?.accounts || [];
  const accMap = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const selectable = accounts.filter((a) => a.accepts_movements && a.is_active);

  const save = async (andSubmit = false) => {
    if (head.description.trim().length < 3) return toast('Escriba la descripción del comprobante', 'bad');
    const valid = lines.filter((l) => l.account_id && ((parseAmount(l.debit) || 0) > 0 || (parseAmount(l.credit) || 0) > 0));
    if (valid.length < 2) return toast('Registre al menos dos líneas con cuenta y valor', 'bad');
    for (const l of valid) { const a = accMap[l.account_id]; if (a?.requires_third_party && !l.third_party_id) return toast(`La cuenta ${a.code} exige tercero`, 'bad'); if (a?.requires_cost_center && !l.cost_center_id) return toast(`La cuenta ${a.code} exige centro de costos`, 'bad'); }
    if (andSubmit && Math.abs(diff) > 0.001) return toast('No cuadra: débitos y créditos deben ser iguales para enviar a revisión', 'bad');
    setBusy('save');
    try {
      let v = vid;
      const hdr = { voucher_type: (head.voucher_type || 'CC').toUpperCase(), date: head.date, description: head.description.trim() };
      if (!v) { v = crypto.randomUUID(); const r = await db.from('vouchers').insert({ id: v, client_id: clientId, org_id: s.org!.id, ...hdr }); if (r.error) throw r.error; setVid(v); }
      else {
        if (head.status === 'devuelto') { const r0 = await db.from('vouchers').update({ status: 'borrador' }).eq('id', v); if (r0.error) throw r0.error; }
        const r = await db.from('vouchers').update(hdr).eq('id', v); if (r.error) throw r.error;
        const d = await db.from('voucher_lines').delete().eq('voucher_id', v); if (d.error) throw d.error;
      }
      const ins = await db.from('voucher_lines').insert(valid.map((l, i) => ({ voucher_id: v, client_id: clientId, org_id: s.org!.id, line_no: i + 1, account_id: l.account_id,
        third_party_id: l.third_party_id || null, cost_center_id: l.cost_center_id || null, description: l.description || null,
        debit: parseAmount(l.debit) || 0, credit: parseAmount(l.credit) || 0 })));
      if (ins.error) throw ins.error;
      if (andSubmit) { const r = await db.from('vouchers').update({ status: 'en_revision' }).eq('id', v); if (r.error) throw r.error; toast('Enviado a revisión del contador'); }
      else toast('Borrador guardado');
      await load(v!); onSaved();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(null); }
  };
  const rpc = async (fn: string, args: any, msg: string) => {
    setBusy(fn); const r = await db.rpc(fn, args); setBusy(null);
    if (r.error) { toast(r.error.message, 'bad'); return false; }
    toast(msg); onSaved(); if (vid) await load(vid); return true;
  };
  const title = vid ? `${head.voucher_type}-${head.number ?? 'borrador'}` : 'Nuevo comprobante';
  return (
    <Modal open wide title={title} onClose={onClose} footer={<>
      {vid && editable && <Button variant="danger" onClick={() => setConfirm('delete')}>Eliminar</Button>}
      <div className="grow" />
      {editable && <><Button variant="outline" loading={busy === 'save'} onClick={() => save(false)}>Guardar borrador</Button>
        <Button loading={busy === 'save'} onClick={() => save(true)}>Enviar a revisión</Button></>}
      {head.status === 'en_revision' && canApprove && <><Button variant="outline" onClick={() => setConfirm('return')}>Devolver</Button>
        <Button loading={busy === 'post_voucher'} onClick={() => rpc('post_voucher', { p_voucher: vid }, 'Comprobante contabilizado')}>Aprobar y contabilizar</Button></>}
      {head.status === 'borrador' && vid && canApprove && Math.abs(diff) < 0.001 && <Button variant="gold" loading={busy === 'post_voucher'} onClick={() => rpc('post_voucher', { p_voucher: vid }, 'Comprobante contabilizado')}>Contabilizar</Button>}
      {head.status === 'contabilizado' && canApprove && !head.reversed_by && !head.reversal_of && <Button variant="outline" icon="undo" onClick={() => setConfirm('reverse')}>Reversar</Button>}
    </>}>
      {head.status && <div className="row gap-s wrap"><Badge status={head.status} />{head.approved_at && <span className="dim small">Aprobado {dateTime(head.approved_at)}</span>}{head.source && head.source !== 'manual' && <Badge t="info">Origen: {L(head.source)}</Badge>}</div>}
      {head.status === 'devuelto' && <Alert kind="warn"><strong>Devuelto por el contador:</strong> {head.return_reason}</Alert>}
      {head.status === 'contabilizado' && <Alert kind="ok">Comprobante contabilizado: no se puede modificar. Para corregir, genere un reverso y registre el ajuste.</Alert>}
      {head.status === 'en_revision' && !canApprove && <Alert kind="info">En revisión del contador. Mientras tanto no se puede editar.</Alert>}
      {s.org?.require_segregation && head.status === 'borrador' && <p className="dim xs">La firma exige separación de funciones: quien prepara un comprobante no puede aprobarlo.</p>}
      <div className="form-grid">
        <Field label="Tipo" hint="Código interno de 1 a 4 letras (CC, CE, CI, FC, FV…)"><Input value={head.voucher_type} disabled={!editable} maxLength={4} onChange={(e: any) => setHead({ ...head, voucher_type: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></Field>
        <Field label="Fecha"><Input type="date" value={head.date} disabled={!editable} onChange={(e: any) => setHead({ ...head, date: e.target.value })} /></Field>
        <Field label="Descripción" className="full"><Input value={head.description} disabled={!editable} onChange={(e: any) => setHead({ ...head, description: e.target.value })} /></Field>
      </div>
      {cat.loading ? <Loading /> : !selectable.length ? <Alert kind="warn">Este cliente no tiene cuentas que acepten movimientos. Configure el plan de cuentas primero.</Alert> : <>
        <div className="line-grid lg-head dim xs"><span>Cuenta</span><span>Tercero</span><span>Detalle</span><span className="right">Débito</span><span className="right">Crédito</span><span /></div>
        <div className="col gap-s">
          {lines.map((l, i) => (
            <div key={l.key} className="line-grid">
              <Select className="input lg-acc" disabled={!editable} value={l.account_id} onChange={(e: any) => set(i, 'account_id', e.target.value)} placeholder="Cuenta…"
                options={(editable ? selectable : accounts).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} aria-label="Cuenta" />
              <Select disabled={!editable} value={l.third_party_id} onChange={(e: any) => set(i, 'third_party_id', e.target.value)} placeholder={accMap[l.account_id]?.requires_third_party ? 'Tercero (obligatorio)' : 'Tercero'}
                options={(cat.data?.third || []).map((t) => ({ value: t.id, label: `${t.name} · ${t.id_number}` }))} aria-label="Tercero" />
              {cat.data?.centers.length ? <Select disabled={!editable} value={l.cost_center_id} onChange={(e: any) => set(i, 'cost_center_id', e.target.value)} placeholder="Centro / detalle"
                options={cat.data.centers.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} aria-label="Centro de costos" />
                : <Input disabled={!editable} value={l.description} onChange={(e: any) => set(i, 'description', e.target.value)} placeholder="Detalle" aria-label="Detalle" />}
              <Input disabled={!editable} className="input right" inputMode="decimal" value={l.debit} onChange={(e: any) => set(i, 'debit', e.target.value)} placeholder="Débito" aria-label="Débito" />
              <Input disabled={!editable} className="input right" inputMode="decimal" value={l.credit} onChange={(e: any) => set(i, 'credit', e.target.value)} placeholder="Crédito" aria-label="Crédito" />
              {editable ? <button className="icon-btn" aria-label="Quitar línea" onClick={() => setLines(lines.length > 2 ? lines.filter((_, j) => j !== i) : lines)}><Icon name="x" /></button> : <span />}
            </div>
          ))}
        </div>
        {editable && <div><Button size="s" variant="ghost" icon="plus" onClick={() => setLines([...lines, blank()])}>Agregar línea</Button></div>}
        <div className="totals">
          <span>Débitos <strong>{money(tot.d)}</strong></span><span>Créditos <strong>{money(tot.c)}</strong></span>
          <span className={Math.abs(diff) < 0.001 ? 'diff-ok' : 'diff-bad'}>{Math.abs(diff) < 0.001 ? '✓ Cuadrado' : `Diferencia ${money(diff)}`}</span>
        </div>
      </>}
      <Confirm open={confirm === 'return'} title="Devolver para corrección" needReason confirmLabel="Devolver" onClose={() => setConfirm(null)}
        onConfirm={async (reason: string) => { if (await rpc('return_voucher', { p_voucher: vid, p_reason: reason }, 'Devuelto al auxiliar')) setConfirm(null); }}>
        <p className="muted">El auxiliar recibirá una notificación y una tarea de corrección.</p></Confirm>
      <Confirm open={confirm === 'reverse'} title="Reversar comprobante" needReason danger confirmLabel="Generar reverso" onClose={() => setConfirm(null)}
        onConfirm={async (reason: string) => { if (await rpc('reverse_voucher', { p_voucher: vid, p_reason: reason, p_date: today() }, 'Reverso contabilizado')) setConfirm(null); }}>
        <Alert kind="warn">Se creará y contabilizará un comprobante con los débitos y créditos invertidos, con fecha de hoy. El original queda intacto y vinculado.</Alert></Confirm>
      <Confirm open={confirm === 'delete'} title="Eliminar borrador" danger confirmLabel="Eliminar" onClose={() => setConfirm(null)}
        onConfirm={async () => { const r = await db.from('vouchers').delete().eq('id', vid!); if (r.error) return toast(r.error.message, 'bad'); toast('Borrador eliminado'); onSaved(); onClose(); }}>
        <p className="muted">Solo se pueden eliminar comprobantes no contabilizados.</p></Confirm>
    </Modal>
  );
}

// ======================= Plan de cuentas =======================
const TYPES = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto', 'costo', 'orden_deudora', 'orden_acreedora'];
function Accounts() {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const [q, setQ] = useState(''); const [edit, setEdit] = useState<any>(null); const [busy, setBusy] = useState(false); const [imp, setImp] = useState(false);
  const { data, loading, reload } = useAsync(async () => ((await db.from('accounts').select('*').eq('client_id', clientId).order('code')).data as any[]) || [], [clientId]);
  const rows = (data || []).filter((a) => !q || a.code.startsWith(q) || a.name.toLowerCase().includes(q.toLowerCase()));
  const loadTemplate = async () => {
    setBusy(true); const r = await db.rpc('load_puc_template', { p_client: clientId }); setBusy(false);
    if (r.error) return toast(r.error.message, 'bad');
    toast(`${r.data} cuentas de referencia agregadas`); reload();
  };
  const save = async () => {
    const v = edit;
    if (!/^\d{1,12}$/.test(v.code) || v.name.trim().length < 2) return toast('Código numérico y nombre obligatorios', 'bad');
    const row = { code: v.code, name: v.name.trim(), account_type: v.account_type, nature: v.nature, accepts_movements: v.accepts_movements, requires_third_party: v.requires_third_party, requires_cost_center: v.requires_cost_center, is_active: v.is_active };
    const r = v.id ? await db.from('accounts').update(row).eq('id', v.id) : await db.from('accounts').insert({ ...row, client_id: clientId, org_id: s.org!.id });
    if (r.error) return toast(r.error.message, 'bad');
    setEdit(null); reload();
  };
  const canEdit = s.can('contabilidad', 'editar');
  return (
    <Card pad={false} title="Plan de cuentas del cliente" subtitle="Configurable por cliente. La plantilla de referencia PUC (Decreto 2650 de 1993) es opcional y debe ajustarse a cada entidad." actions={<>
      <Input placeholder="Buscar código o nombre" value={q} onChange={(e: any) => setQ(e.target.value)} style={{ width: 220, minHeight: 36 }} />
      <Button size="s" variant="outline" icon="download" disabled={!data?.length} onClick={() => exportXLSX({ orgId: s.org!.id, title: 'Plan de cuentas', filename: 'plan-de-cuentas', headers: ['Código', 'Nombre', 'Tipo', 'Naturaleza', 'Movimiento', 'Tercero', 'Centro', 'Activa'], rows: (data || []).map((a) => [a.code, a.name, L(a.account_type), a.nature, a.accepts_movements ? 'Sí' : 'No', a.requires_third_party ? 'Sí' : 'No', a.requires_cost_center ? 'Sí' : 'No', a.is_active ? 'Sí' : 'No']) })}>Exportar</Button>
      {canEdit && <><Button size="s" variant="outline" icon="upload" onClick={() => setImp(true)}>Importar</Button>
        <Button size="s" variant="outline" loading={busy} onClick={loadTemplate}>Cargar plantilla PUC</Button>
        <Button size="s" icon="plus" onClick={() => setEdit({ code: '', name: '', account_type: 'activo', nature: 'debito', accepts_movements: true, requires_third_party: false, requires_cost_center: false, is_active: true })}>Cuenta</Button></>}
    </>}>
      {loading ? <Loading /> : <Table dense rows={rows} onRow={canEdit ? (r) => setEdit(r) : undefined} empty={<Empty title="Sin plan de cuentas" icon="book">Cargue la plantilla de referencia, importe su catálogo o cree las cuentas manualmente.</Empty>} columns={[
        { key: 'code', label: 'Código', render: (r) => <span className="mono" style={{ paddingLeft: Math.max(0, r.code.length - 1) * 6 }}>{r.code}</span> },
        { key: 'name', label: 'Nombre', render: (r) => <span style={{ fontWeight: r.accepts_movements ? 400 : 700 }}>{r.name}</span> },
        { key: 'type', label: 'Tipo', render: (r) => L(r.account_type) }, { key: 'nat', label: 'Naturaleza', render: (r) => r.nature === 'debito' ? 'Débito' : 'Crédito' },
        { key: 'mov', label: 'Movimiento', render: (r) => r.accepts_movements ? <Badge t="ok">Auxiliar</Badge> : <Badge t="muted">Título</Badge> },
        { key: 'req', label: 'Exige', render: (r) => [r.requires_third_party && 'Tercero', r.requires_cost_center && 'Centro'].filter(Boolean).join(', ') || '—' },
        { key: 'act', label: 'Estado', render: (r) => <Badge status={r.is_active ? 'activo' : 'inactivo'} /> },
      ]} />}
      {edit && <Modal open title={edit.id ? `Cuenta ${edit.code}` : 'Nueva cuenta'} onClose={() => setEdit(null)} footer={<Button onClick={save}>Guardar</Button>}>
        <div className="form-grid">
          <Field label="Código"><Input value={edit.code} disabled={!!edit.id} inputMode="numeric" onChange={(e: any) => setEdit({ ...edit, code: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Tipo"><Select value={edit.account_type} onChange={(e: any) => setEdit({ ...edit, account_type: e.target.value })} options={TYPES} /></Field>
          <Field label="Nombre" className="full"><Input value={edit.name} onChange={(e: any) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Naturaleza"><Select value={edit.nature} onChange={(e: any) => setEdit({ ...edit, nature: e.target.value })} options={[{ value: 'debito', label: 'Débito' }, { value: 'credito', label: 'Crédito' }]} /></Field>
        </div>
        {(['accepts_movements', 'requires_third_party', 'requires_cost_center', 'is_active'] as const).map((k) => <label key={k} className="check"><input type="checkbox" checked={edit[k]} onChange={(e: any) => setEdit({ ...edit, [k]: e.target.checked })} />
          {{ accepts_movements: 'Acepta movimientos (cuenta auxiliar)', requires_third_party: 'Exige tercero', requires_cost_center: 'Exige centro de costos', is_active: 'Activa' }[k]}</label>)}
      </Modal>}
      <ImportAccounts open={imp} onClose={() => setImp(false)} onDone={() => { setImp(false); reload(); }} />
    </Card>
  );
}

function ImportAccounts({ open, onClose, onDone }: any) {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const [rows, setRows] = useState<any[] | null>(null); const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f) return;
    try {
      const objs = toObjects(await readTable(f));
      setRows(objs.map((o, i) => {
        const code = (o.codigo || o.cuenta || o.code || '').replace(/\D/g, ''); const name = o.nombre || o.descripcion || o.name || '';
        const first = code[0]; const type = ({ '1': 'activo', '2': 'pasivo', '3': 'patrimonio', '4': 'ingreso', '5': 'gasto', '6': 'costo', '7': 'costo', '8': 'orden_deudora', '9': 'orden_acreedora' } as any)[first];
        const issues = [!code && 'Sin código', !name && 'Sin nombre', !type && 'Clase no reconocida'].filter(Boolean);
        return { line: i + 2, code, name, account_type: type, nature: ['1', '5', '6', '7', '8'].includes(first) ? 'debito' : 'credito', issues };
      }));
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const ok = (rows || []).filter((r) => !r.issues.length);
  const go = async () => {
    setBusy(true);
    const codes = new Set(ok.map((r) => r.code));
    const payload = ok.map((r) => ({ client_id: clientId, org_id: s.org!.id, code: r.code, name: r.name, account_type: r.account_type, nature: r.nature,
      accepts_movements: ![...codes].some((c) => c !== r.code && c.startsWith(r.code)) }));
    const res = await db.from('accounts').upsert(payload, { onConflict: 'client_id,code', ignoreDuplicates: true });
    setBusy(false);
    if (res.error) return toast(res.error.message, 'bad');
    toast(`${payload.length} cuentas procesadas (las existentes no se modifican)`); setRows(null); onDone();
  };
  return (
    <Modal open={open} onClose={() => { setRows(null); onClose(); }} wide title="Importar plan de cuentas" footer={<Button disabled={!ok.length} loading={busy} onClick={go}>Importar {ok.length}</Button>}>
      <Alert kind="info">CSV o XLSX con columnas <span className="mono">codigo, nombre</span>. Las cuentas con subcuentas quedan como cuentas de título.</Alert>
      <input type="file" className="input" accept=".csv,.xlsx" onChange={(e: any) => pick(e.target.files?.[0])} />
      {rows && <Table dense rowKey="line" rows={rows.slice(0, 300)} columns={[{ key: 'code', label: 'Código' }, { key: 'name', label: 'Nombre' }, { key: 't', label: 'Tipo', render: (r) => L(r.account_type) },
        { key: 'i', label: 'Validación', render: (r) => r.issues.length ? <span className="diff-bad small">{r.issues.join(', ')}</span> : <Badge t="ok">OK</Badge> }]} />}
    </Modal>
  );
}

function ThirdParties() {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const { data, loading, reload } = useAsync(async () => ((await db.from('third_parties').select('*').eq('client_id', clientId).order('name').limit(2000)).data as any[]) || [], [clientId]);
  const [edit, setEdit] = useState<any>(null);
  const save = async () => {
    if (!edit.id_number || edit.name.trim().length < 2) return toast('Identificación y nombre obligatorios', 'bad');
    const row = { id_type: edit.id_type, id_number: edit.id_number.trim(), dv: edit.dv || null, name: edit.name.trim(), email: edit.email || null, phone: edit.phone || null, address: edit.address || null };
    const r = edit.id ? await db.from('third_parties').update(row).eq('id', edit.id) : await db.from('third_parties').insert({ ...row, client_id: clientId, org_id: s.org!.id });
    if (r.error) return toast(r.error.message, 'bad');
    setEdit(null); reload();
  };
  return (
    <Card pad={false} title="Terceros" subtitle="Proveedores, clientes y demás terceros del cliente, para auxiliares por tercero." actions={s.can('contabilidad', 'crear') && <Button size="s" icon="plus" onClick={() => setEdit({ id_type: 'NIT', id_number: '', dv: '', name: '', email: '', phone: '', address: '' })}>Tercero</Button>}>
      {loading ? <Loading /> : <Table dense rows={data || []} onRow={(r) => setEdit(r)} empty={<Empty title="Sin terceros" icon="users">Se crean automáticamente al proponer comprobantes desde facturas.</Empty>} columns={[
        { key: 'name', label: 'Nombre' }, { key: 'id', label: 'Identificación', render: (r) => <span className="mono">{r.id_type} {r.id_number}{r.dv ? '-' + r.dv : ''}</span> }, { key: 'email', label: 'Correo' }, { key: 'phone', label: 'Teléfono' }]} />}
      {edit && <Modal open title={edit.id ? 'Editar tercero' : 'Nuevo tercero'} onClose={() => setEdit(null)} footer={<Button onClick={save}>Guardar</Button>}>
        <div className="form-grid">
          <Field label="Tipo"><Select value={edit.id_type} onChange={(e: any) => setEdit({ ...edit, id_type: e.target.value })} options={['NIT', 'CC', 'CE', 'PAS', 'OTRO'].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Número"><Input value={edit.id_number} onChange={(e: any) => setEdit({ ...edit, id_number: e.target.value })} /></Field>
          <Field label="Nombre o razón social" className="full"><Input value={edit.name} onChange={(e: any) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Correo"><Input value={edit.email || ''} onChange={(e: any) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Teléfono"><Input value={edit.phone || ''} onChange={(e: any) => setEdit({ ...edit, phone: e.target.value })} /></Field>
        </div>
      </Modal>}
    </Card>
  );
}

function CostCenters() {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const { data, reload } = useAsync(async () => ((await db.from('cost_centers').select('*').eq('client_id', clientId).order('code')).data as any[]) || [], [clientId]);
  const [v, setV] = useState({ code: '', name: '' });
  const add = async () => {
    if (!v.code || !v.name) return;
    const r = await db.from('cost_centers').insert({ ...v, client_id: clientId, org_id: s.org!.id });
    if (r.error) return toast(r.error.message, 'bad'); setV({ code: '', name: '' }); reload();
  };
  return (
    <Card title="Centros de costo" subtitle="Opcionales. Si una cuenta los exige, cada línea debe indicar uno.">
      {s.can('contabilidad', 'crear') && <div className="row gap-s wrap"><Input placeholder="Código" value={v.code} onChange={(e: any) => setV({ ...v, code: e.target.value })} style={{ width: 120 }} />
        <Input placeholder="Nombre" value={v.name} onChange={(e: any) => setV({ ...v, name: e.target.value })} style={{ flex: 1, minWidth: 180 }} /><Button onClick={add}>Agregar</Button></div>}
      <div className="mt"><Table dense rows={data || []} empty={<p className="muted small">Sin centros de costo.</p>} columns={[{ key: 'code', label: 'Código' }, { key: 'name', label: 'Nombre' },
        { key: 'a', label: 'Estado', render: (r) => <Button size="s" variant="ghost" onClick={async () => { await db.from('cost_centers').update({ is_active: !r.is_active }).eq('id', r.id); reload(); }}>{r.is_active ? 'Desactivar' : 'Activar'}</Button> }]} /></div>
    </Card>
  );
}

function Periods() {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const { data, reload } = useAsync(async () => ((await db.from('periods').select('*').eq('client_id', clientId).order('year', { ascending: false }).order('month', { ascending: false })).data as any[]) || [], [clientId]);
  const [p, setP] = useState(currentPeriod()); const [reopen, setReopen] = useState<any>(null);
  const setStatus = async (year: number, month: number, status: string, reason?: string) => {
    const r = await db.rpc('set_period_status', { p_client: clientId, p_year: year, p_month: month, p_status: status, p_reason: reason || null });
    if (r.error) return toast(r.error.message, 'bad'); toast(status === 'cerrado' ? 'Periodo cerrado' : 'Periodo reabierto'); reload();
  };
  const canApprove = s.can('contabilidad', 'aprobar');
  return (
    <Card title="Periodos contables" subtitle="Un periodo cerrado no admite nuevos comprobantes ni contabilizaciones. Solo el administrador puede reabrirlo, con motivo.">
      {canApprove && <div className="row gap-s wrap"><Input type="month" value={p} onChange={(e: any) => setP(e.target.value)} /><Button variant="outline" icon="lock" onClick={() => { const [y, m] = p.split('-').map(Number); setStatus(y, m, 'cerrado'); }}>Cerrar periodo</Button></div>}
      <div className="mt"><Table dense rows={data || []} empty={<p className="muted small">Los periodos se crean automáticamente al contabilizar.</p>} columns={[
        { key: 'p', label: 'Periodo', render: (r) => `${r.year}-${String(r.month).padStart(2, '0')}` }, { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> },
        { key: 'c', label: 'Cerrado', render: (r) => dateTime(r.closed_at) },
        { key: 'a', label: '', render: (r) => canApprove && (r.status === 'abierto' ? <Button size="s" variant="ghost" onClick={() => setStatus(r.year, r.month, 'cerrado')}>Cerrar</Button>
          : s.role === 'admin' && <Button size="s" variant="ghost" onClick={() => setReopen(r)}>Reabrir</Button>) }]} /></div>
      <Confirm open={!!reopen} title="Reabrir periodo" needReason confirmLabel="Reabrir" onClose={() => setReopen(null)} onConfirm={async (reason: string) => { await setStatus(reopen.year, reopen.month, 'abierto', reason); setReopen(null); }}>
        <Alert kind="warn">Reabrir un periodo permite registrar operaciones que pueden afectar informes ya entregados. La acción queda auditada.</Alert></Confirm>
    </Card>
  );
}
