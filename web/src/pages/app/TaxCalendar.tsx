import { useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Card, Empty, Field, Icon, Input, Loading, Modal, Select, Table, Tabs, Textarea, cx, useToast } from '../../components/ui';
import { ClientPicker, NeedClient, useClients } from '../../components/AppShell';
import { date, dateTime, daysUntil, L, today } from '../../lib/format';

export function TaxCalendar() {
  const s = useSession();
  const [tab, setTab] = useState('calendario');
  return (
    <>
      <div className="page-h">
        <div><h2>Calendario tributario</h2><p className="muted small">Obligaciones por cliente según sus responsabilidades. Las fechas provienen de reglas configurables con fuente, versión y estado de verificación.</p></div>
        <ClientPicker />
      </div>
      <Alert kind="warn">La plataforma no trae fechas oficiales precargadas. Cargue las fechas del calendario tributario vigente y marque cada regla como verificada indicando la fuente oficial consultada. Mientras tanto, las fechas se muestran como <strong>por confirmar</strong>.</Alert>
      <NeedClient>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'calendario', label: 'Calendario' }, { id: 'obligaciones', label: 'Obligaciones del cliente' }, ...(s.role === 'admin' ? [{ id: 'reglas', label: 'Reglas y fechas' }] : [])]} />
        {tab === 'calendario' && <Month />}
        {tab === 'obligaciones' && <Obligations />}
        {tab === 'reglas' && <Rules />}
      </NeedClient>
    </>
  );
}

function Month() {
  const s = useSession(); const { clientId } = useClients();
  const [all, setAll] = useState(true); const [cursor, setCursor] = useState(() => today().slice(0, 7));
  const [y, m] = cursor.split('-').map(Number);
  const first = new Date(y, m - 1, 1); const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { data } = useAsync(async () => {
    let q = db.from('obligations').select('id,name,due_date,status,date_confirmed,client:clients(name)').eq('org_id', s.org!.id).gte('due_date', iso(days[0])).lte('due_date', iso(days[41]));
    if (!all) q = q.eq('client_id', clientId);
    return ((await q.limit(1000)).data as any[]) || [];
  }, [cursor, all, clientId]);
  const byDay = useMemo(() => { const m: Record<string, any[]> = {}; for (const o of data || []) (m[o.due_date] ||= []).push(o); return m; }, [data]);
  const move = (n: number) => { const d = new Date(y, m - 1 + n, 1); setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  return (
    <Card title={first.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })} actions={<>
      <label className="check"><input type="checkbox" checked={all} onChange={(e: any) => setAll(e.target.checked)} />Todos los clientes</label>
      <Button size="s" variant="ghost" onClick={() => move(-1)} aria-label="Mes anterior"><Icon name="back" /></Button>
      <Button size="s" variant="ghost" onClick={() => setCursor(today().slice(0, 7))}>Hoy</Button>
      <Button size="s" variant="ghost" onClick={() => move(1)} aria-label="Mes siguiente"><Icon name="chevron" /></Button></>}>
      <div className="cal">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d} className="cal-h">{d}</div>)}
        {days.map((d) => {
          const k = iso(d); const evs = byDay[k] || [];
          return <div key={k} className={cx('cal-d', d.getMonth() !== m - 1 && 'out', k === today() && 'today')}>
            <div className="dim">{d.getDate()}</div>
            {evs.slice(0, 3).map((o) => <span key={o.id} title={`${o.name} · ${o.client?.name}`} className={cx('cal-ev', ['pagada', 'presentada'].includes(o.status) ? 'ok' : o.status === 'vencida' ? 'bad' : !o.date_confirmed ? 'warn' : '')}>{all ? `${o.client?.name?.split(' ')[0]}: ` : ''}{o.name}</span>)}
            {evs.length > 3 && <span className="dim xs">+{evs.length - 3} más</span>}
          </div>;
        })}
      </div>
      <div className="row gap wrap mt small muted"><span className="cal-ev">Confirmada</span><span className="cal-ev warn">Fecha por confirmar</span><span className="cal-ev bad">Vencida</span><span className="cal-ev ok">Presentada / pagada</span></div>
    </Card>
  );
}

function Obligations() {
  const s = useSession(); const toast = useToast(); const { clientId, clients } = useClients();
  const client = clients.find((c) => c.id === clientId);
  const [year, setYear] = useState(new Date().getFullYear()); const [edit, setEdit] = useState<any>(null); const [gen, setGen] = useState(false); const [manual, setManual] = useState(false);
  const { data, loading, reload } = useAsync(async () => {
    const [o, r, m] = await Promise.all([
      db.from('obligations').select('*,rule:tax_rules(code,validation_status,source_url)').eq('client_id', clientId).like('period_label', `${year}*`).order('due_date', { nullsFirst: false }),
      db.from('tax_rules').select('id,code,name,validation_status,periodicity,responsibility_code').eq('org_id', s.org!.id).order('code'),
      db.rpc('org_members', { p_org: s.org!.id }),
    ]);
    return { obl: (o.data as any[]) || [], rules: (r.data as any[]) || [], staff: ((m.data as any[]) || []).filter((x) => x.role !== 'cliente') };
  }, [clientId, year]);
  const save = async () => {
    const r = await db.from('obligations').update({ status: edit.status, responsible_id: edit.responsible_id || null, presented_at: edit.presented_at || null, paid_at: edit.paid_at || null,
      due_date: edit.due_date || null, notes: edit.notes || null }).eq('id', edit.id);
    if (r.error) return toast(r.error.message, 'bad'); setEdit(null); reload();
  };
  return (
    <>
      <div className="toolbar">
        <Select value={String(year)} onChange={(e: any) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map(String).map((x) => ({ value: x, label: x }))} />
        <span className="small muted">Responsabilidades del cliente (RUT): <strong>{(client as any)?.fiscal_responsibilities?.join?.(', ') || 'ver ficha'}</strong></span>
        <div className="grow" />
        {s.can('tributario', 'crear') && <><Button variant="outline" onClick={() => setManual(true)}>Obligación manual</Button><Button icon="calendar" onClick={() => setGen(true)}>Generar desde reglas</Button></>}
      </div>
      <Card pad={false}>
        {loading || !data ? <Loading /> : <Table rows={data.obl} onRow={s.can('tributario', 'editar') ? (r) => setEdit({ ...r }) : undefined} empty={<Empty title="Sin obligaciones para este año" icon="calendar">Genere las obligaciones a partir de las reglas configuradas que apliquen a este cliente.</Empty>} columns={[
          { key: 'name', label: 'Obligación', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div className="dim xs">{r.rule?.code}</div></div> },
          { key: 'due', label: 'Vencimiento', render: (r) => { const d = daysUntil(r.due_date); return <div>{date(r.due_date)}{d !== null && !['presentada', 'pagada', 'no_aplica'].includes(r.status) && <div className={`xs ${d < 0 ? 'diff-bad' : 'dim'}`}>{d < 0 ? `vencida hace ${-d} d` : `en ${d} d`}</div>}</div>; } },
          { key: 'conf', label: 'Fecha', render: (r) => r.date_confirmed ? <Badge t="ok">Verificada</Badge> : <Badge t="warn">Por confirmar</Badge> },
          { key: 'resp', label: 'Responsable', render: (r) => data.staff.find((x: any) => x.user_id === r.responsible_id)?.full_name || <span className="dim">Sin asignar</span> },
          { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> },
        ]} />}
      </Card>
      {edit && <Modal open title={edit.name} onClose={() => setEdit(null)} footer={<Button onClick={save}>Guardar</Button>}>
        {!edit.date_confirmed && <Alert kind="warn">La fecha no está verificada con fuente oficial. Confírmela antes de comprometerla con el cliente.</Alert>}
        <div className="form-grid">
          <Field label="Estado"><Select value={edit.status} onChange={(e: any) => setEdit({ ...edit, status: e.target.value })} options={['pendiente', 'en_preparacion', 'presentada', 'pagada', 'vencida', 'no_aplica']} /></Field>
          <Field label="Responsable"><Select value={edit.responsible_id || ''} onChange={(e: any) => setEdit({ ...edit, responsible_id: e.target.value })} placeholder="Sin asignar" options={(data?.staff || []).map((x: any) => ({ value: x.user_id, label: x.full_name || x.email }))} /></Field>
          <Field label="Vencimiento" hint="Cambiarla la marca como no verificada"><Input type="date" value={edit.due_date || ''} onChange={(e: any) => setEdit({ ...edit, due_date: e.target.value })} /></Field>
          <Field label="Presentada el"><Input type="date" value={edit.presented_at || ''} onChange={(e: any) => setEdit({ ...edit, presented_at: e.target.value })} /></Field>
          <Field label="Pagada el"><Input type="date" value={edit.paid_at || ''} onChange={(e: any) => setEdit({ ...edit, paid_at: e.target.value })} /></Field>
          <Field label="Observaciones" className="full"><Textarea value={edit.notes || ''} onChange={(e: any) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div>
        <p className="dim xs">Adjunte el soporte de presentación o pago en el centro documental (tipo "Declaración").</p>
      </Modal>}
      {gen && data && <Generate rules={data.rules} clientId={clientId} year={year} onClose={() => setGen(false)} onDone={() => { setGen(false); reload(); }} />}
      {manual && data && <ManualObligation rules={data.rules} clientId={clientId} onClose={() => setManual(false)} onDone={() => { setManual(false); reload(); }} />}
    </>
  );
}

function Generate({ rules, clientId, year, onClose, onDone }: any) {
  const toast = useToast(); const [sel, setSel] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); let total = 0;
    for (const r of sel) { const res = await db.rpc<number>('generate_obligations', { p_client: clientId, p_rule: r, p_year: year }); if (res.error) { setBusy(false); return toast(res.error.message, 'bad'); } total += res.data || 0; }
    setBusy(false);
    toast(total ? `${total} obligaciones generadas` : 'No se generaron obligaciones: verifique que las reglas tengan fechas cargadas para ese año y el dígito del NIT', total ? 'ok' : 'info');
    onDone();
  };
  return (
    <Modal open title={`Generar obligaciones ${year}`} onClose={onClose} footer={<Button disabled={!sel.length} loading={busy} onClick={go}>Generar</Button>}>
      <Alert kind="info">Seleccione solo las reglas que aplican a este cliente según su RUT. Se usan las fechas cargadas para el año y el último dígito del NIT. Las obligaciones existentes no se duplican.</Alert>
      {!rules.length && <p className="muted">No hay reglas en la firma. El administrador puede cargarlas en "Reglas y fechas".</p>}
      {rules.map((r: any) => <label key={r.id} className="check"><input type="checkbox" checked={sel.includes(r.id)} onChange={(e: any) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} />
        <span><strong>{r.name}</strong> <span className="dim xs">({r.code}{r.responsibility_code ? ` · resp. ${r.responsibility_code}` : ''})</span> <Badge status={r.validation_status} /></span></label>)}
    </Modal>
  );
}

function ManualObligation({ rules, clientId, onClose, onDone }: any) {
  const s = useSession(); const toast = useToast(); const [v, setV] = useState({ rule_id: '', name: '', period_label: '', due_date: '' });
  const go = async () => {
    if (!v.name || !v.period_label) return toast('Nombre y periodo obligatorios', 'bad');
    const r = await db.from('obligations').insert({ client_id: clientId, org_id: s.org!.id, rule_id: v.rule_id || null, name: v.name, period_label: v.period_label, due_date: v.due_date || null, date_confirmed: false });
    if (r.error) return toast(r.error.message, 'bad'); onDone();
  };
  return (
    <Modal open title="Obligación manual" onClose={onClose} footer={<Button onClick={go}>Crear</Button>}>
      <Field label="Regla (opcional)"><Select value={v.rule_id} onChange={(e: any) => { const r = rules.find((x: any) => x.id === e.target.value); setV({ ...v, rule_id: e.target.value, name: r ? r.name : v.name }); }} placeholder="Ninguna" options={rules.map((r: any) => ({ value: r.id, label: r.name }))} /></Field>
      <Field label="Nombre"><Input value={v.name} onChange={(e: any) => setV({ ...v, name: e.target.value })} /></Field>
      <div className="form-grid"><Field label="Periodo" hint="Ej.: 2026-10, 2026-B5, 2026"><Input value={v.period_label} onChange={(e: any) => setV({ ...v, period_label: e.target.value })} /></Field>
        <Field label="Vencimiento"><Input type="date" value={v.due_date} onChange={(e: any) => setV({ ...v, due_date: e.target.value })} /></Field></div>
      <p className="dim xs">Las obligaciones manuales quedan con fecha por confirmar.</p>
    </Modal>
  );
}

function Rules() {
  const s = useSession(); const toast = useToast();
  const [rule, setRule] = useState<any>(null); const [validate, setValidate] = useState<any>(null);
  const { data, loading, reload } = useAsync(async () => ((await db.from('tax_rules').select('*').eq('org_id', s.org!.id).order('code')).data as any[]) || [], [s.org?.id]);
  const copy = async () => { const r = await db.rpc('copy_tax_templates', { p_org: s.org!.id }); if (r.error) return toast(r.error.message, 'bad'); toast(`${r.data} plantillas copiadas (sin fechas)`); reload(); };
  return (
    <>
      <Card pad={false} title="Reglas tributarias de la firma" subtitle="Cada regla tiene fuente, versión, vigencia y estado de verificación. Editar una regla verificada la devuelve a 'sin verificar'." actions={<>
        <Button size="s" variant="outline" onClick={copy}>Copiar plantillas base</Button>
        <Button size="s" icon="plus" onClick={() => setRule({ code: '', name: '', authority: 'DIAN', periodicity: 'mensual', applies_to: '', responsibility_code: '', source_url: '', source_note: '', version: '1', valid_from: '', valid_to: '' })}>Regla</Button></>}>
        {loading ? <Loading /> : <Table rows={data || []} onRow={(r) => setRule(r)} empty={<Empty title="Sin reglas" icon="calendar">Copie las plantillas base (nombres y periodicidades, sin fechas) y cargue las fechas vigentes.</Empty>} columns={[
          { key: 'name', label: 'Regla', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div className="dim xs">{r.code} · v{r.version} · {r.authority}</div></div> },
          { key: 'p', label: 'Periodicidad', render: (r) => L(r.periodicity) }, { key: 'vig', label: 'Vigencia', render: (r) => r.valid_from ? `${date(r.valid_from)} – ${date(r.valid_to)}` : '—' },
          { key: 'st', label: 'Verificación', render: (r) => <div><Badge status={r.validation_status} />{r.validated_at && <div className="dim xs">{dateTime(r.validated_at)}</div>}</div> },
          { key: 'a', label: '', render: (r) => r.validation_status !== 'verificada' && <Button size="s" variant="outline" onClick={(e: any) => { e.stopPropagation(); setValidate(r); }}>Verificar</Button> },
        ]} />}
      </Card>
      {rule && <RuleEditor rule={rule} onClose={() => setRule(null)} onSaved={() => { setRule(null); reload(); }} />}
      {validate && <ValidateRule rule={validate} onClose={() => setValidate(null)} onDone={() => { setValidate(null); reload(); }} />}
    </>
  );
}

function RuleEditor({ rule, onClose, onSaved }: any) {
  const s = useSession(); const toast = useToast(); const [v, setV] = useState<any>(rule);
  const { data: dates, reload } = useAsync(async () => rule.id ? ((await db.from('tax_rule_dates').select('*').eq('rule_id', rule.id).order('period_label').order('nit_digits')).data as any[]) || [] : [], [rule.id]);
  const [d, setD] = useState({ period_label: '', nit_digits: '*', due_date: '' }); const [bulk, setBulk] = useState('');
  const save = async () => {
    if (!v.code || !v.name) return toast('Código y nombre obligatorios', 'bad');
    const row = { code: v.code.toUpperCase(), name: v.name, authority: v.authority, periodicity: v.periodicity, applies_to: v.applies_to || null, responsibility_code: v.responsibility_code || null,
      source_url: v.source_url || null, source_note: v.source_note || null, version: v.version || '1', valid_from: v.valid_from || null, valid_to: v.valid_to || null };
    const r = v.id ? await db.from('tax_rules').update(row).eq('id', v.id) : await db.from('tax_rules').insert({ ...row, org_id: s.org!.id });
    if (r.error) return toast(r.error.message, 'bad'); toast('Regla guardada'); onSaved();
  };
  const addDate = async (rows: any[]) => {
    const r = await db.from('tax_rule_dates').insert(rows.map((x) => ({ ...x, rule_id: rule.id, org_id: s.org!.id })));
    if (r.error) return toast(r.error.message, 'bad'); reload(); toast(`${rows.length} fecha(s) agregada(s); la regla queda sin verificar`);
  };
  const parseBulk = () => {
    const rows = bulk.split(/\n/).map((l) => l.split(/[;,\t]/).map((x) => x.trim())).filter((x) => x.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(x[2]));
    if (!rows.length) return toast('Formato: periodo;dígitos;AAAA-MM-DD (una por línea)', 'bad');
    addDate(rows.map(([p, n, dd]) => ({ period_label: p, nit_digits: n || '*', due_date: dd }))); setBulk('');
  };
  return (
    <Modal open wide title={v.id ? v.name : 'Nueva regla'} onClose={onClose} footer={<Button onClick={save}>Guardar regla</Button>}>
      <div className="form-grid">
        <Field label="Código"><Input value={v.code} onChange={(e: any) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="Nombre"><Input value={v.name} onChange={(e: any) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Autoridad"><Input value={v.authority} onChange={(e: any) => setV({ ...v, authority: e.target.value })} /></Field>
        <Field label="Periodicidad"><Select value={v.periodicity} onChange={(e: any) => setV({ ...v, periodicity: e.target.value })} options={['mensual', 'bimestral', 'cuatrimestral', 'semestral', 'anual', 'unica']} /></Field>
        <Field label="Aplica a"><Input value={v.applies_to || ''} onChange={(e: any) => setV({ ...v, applies_to: e.target.value })} /></Field>
        <Field label="Código de responsabilidad RUT"><Input value={v.responsibility_code || ''} onChange={(e: any) => setV({ ...v, responsibility_code: e.target.value })} /></Field>
        <Field label="Fuente (URL oficial)"><Input value={v.source_url || ''} onChange={(e: any) => setV({ ...v, source_url: e.target.value })} /></Field>
        <Field label="Versión"><Input value={v.version} onChange={(e: any) => setV({ ...v, version: e.target.value })} /></Field>
        <Field label="Vigente desde"><Input type="date" value={v.valid_from || ''} onChange={(e: any) => setV({ ...v, valid_from: e.target.value })} /></Field>
        <Field label="Vigente hasta"><Input type="date" value={v.valid_to || ''} onChange={(e: any) => setV({ ...v, valid_to: e.target.value })} /></Field>
        <Field label="Nota de la fuente" className="full"><Textarea value={v.source_note || ''} onChange={(e: any) => setV({ ...v, source_note: e.target.value })} /></Field>
      </div>
      {v.id ? <>
        <h4>Fechas de vencimiento</h4>
        <p className="dim xs">"Dígitos" corresponde al último dígito del NIT (0-9), los dos últimos (00-99), un rango de dos dígitos (01-10) o * para todos.</p>
        <div className="row gap-s wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Periodo"><Input value={d.period_label} onChange={(e: any) => setD({ ...d, period_label: e.target.value })} placeholder="2026-01" style={{ width: 130 }} /></Field>
          <Field label="Dígitos"><Input value={d.nit_digits} onChange={(e: any) => setD({ ...d, nit_digits: e.target.value })} style={{ width: 90 }} /></Field>
          <Field label="Vence"><Input type="date" value={d.due_date} onChange={(e: any) => setD({ ...d, due_date: e.target.value })} /></Field>
          <Button onClick={() => d.period_label && d.due_date && addDate([d])}>Agregar</Button>
        </div>
        <Field label="Carga masiva" hint="Una fecha por línea: periodo;dígitos;AAAA-MM-DD"><Textarea value={bulk} onChange={(e: any) => setBulk(e.target.value)} placeholder={'2026-01;1;2026-02-10\n2026-01;2;2026-02-11'} /></Field>
        <div><Button variant="outline" size="s" onClick={parseBulk}>Agregar fechas</Button></div>
        <Table dense rows={dates || []} empty={<p className="muted small">Sin fechas cargadas.</p>} columns={[{ key: 'period_label', label: 'Periodo' }, { key: 'nit_digits', label: 'Dígitos' }, { key: 'due', label: 'Vence', render: (r) => date(r.due_date) },
          { key: 'x', label: '', render: (r) => <button className="icon-btn" aria-label="Quitar" onClick={async () => { await db.from('tax_rule_dates').delete().eq('id', r.id); reload(); }}><Icon name="trash" /></button> }]} />
      </> : <p className="muted small">Guarde la regla para cargar sus fechas.</p>}
    </Modal>
  );
}

function ValidateRule({ rule, onClose, onDone }: any) {
  const toast = useToast(); const [url, setUrl] = useState(rule.source_url || ''); const [note, setNote] = useState('');
  const go = async () => { const r = await db.rpc('validate_tax_rule', { p_rule: rule.id, p_source_url: url, p_note: note }); if (r.error) return toast(r.error.message, 'bad'); toast('Regla verificada'); onDone(); };
  return (
    <Modal open title={`Verificar: ${rule.name}`} onClose={onClose} footer={<Button onClick={go} disabled={url.trim().length < 8}>Marcar como verificada</Button>}>
      <Alert kind="warn">Confirme que contrastó las fechas cargadas con la norma oficial vigente (decreto o resolución). Esta verificación queda registrada con su usuario y fecha.</Alert>
      <Field label="Fuente oficial consultada (URL)"><Input value={url} onChange={(e: any) => setUrl(e.target.value)} placeholder="https://www.dian.gov.co/…" /></Field>
      <Field label="Norma y observaciones"><Textarea value={note} onChange={(e: any) => setNote(e.target.value)} placeholder="Ej.: Decreto … de …, artículo …" /></Field>
    </Modal>
  );
}
