import { useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, Select, Stat, Table, Tabs, useToast } from '../../components/ui';
import { ClientPicker, NeedClient, useClients } from '../../components/AppShell';
import { date, daysUntil, L, money, today } from '../../lib/format';
import { parseAmount } from '../../lib/tabular';
import { exportXLSX } from '../../lib/export';

export function Receivables() {
  const [kind, setKind] = useState<'cobrar' | 'pagar'>('cobrar');
  return (
    <>
      <div className="page-h">
        <div><h2>Cartera y tesorería</h2><p className="muted small">Facturas por cobrar y por pagar, pagos y antigüedad. Los pagos registrados quedan <strong>pendientes de confirmar</strong> hasta su verificación. No se ejecutan pagos bancarios.</p></div>
        <ClientPicker />
      </div>
      <NeedClient>
        <Tabs value={kind} onChange={(v) => setKind(v as any)} tabs={[{ id: 'cobrar', label: 'Cuentas por cobrar' }, { id: 'pagar', label: 'Cuentas por pagar' }]} />
        <InvoiceList kind={kind} />
      </NeedClient>
    </>
  );
}

const AGING = ['al_dia', '1-30', '31-60', '61-90', '>90'];

function InvoiceList({ kind }: { kind: 'cobrar' | 'pagar' }) {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const [status, setStatus] = useState('abiertas'); const [edit, setEdit] = useState<any>(null); const [pay, setPay] = useState<any>(null);
  const { data, loading, reload } = useAsync(async () => {
    let q = db.from('invoice_balances').select('*').eq('client_id', clientId).eq('kind', kind);
    if (status === 'abiertas') q = q.in('status', ['pendiente', 'parcial']); else if (status) q = q.eq('status', status);
    return ((await q.order('due_date', { nullsFirst: false }).limit(1000)).data as any[]) || [];
  }, [clientId, kind, status]);
  const rows = data || [];
  const aging = useMemo(() => Object.fromEntries(AGING.map((a) => [a, rows.filter((r) => r.aging === a).reduce((s, r) => s + Number(r.balance), 0)])), [rows]);
  const projection = useMemo(() => [30, 60, 90].map((d) => rows.filter((r) => r.due_date && (daysUntil(r.due_date) ?? 0) <= d && (daysUntil(r.due_date) ?? 0) >= 0).reduce((s, r) => s + Number(r.balance), 0)), [rows]);
  const totals = { open: rows.reduce((s, r) => s + Number(r.balance), 0), unconf: rows.reduce((s, r) => s + Number(r.paid_unconfirmed), 0), verify: rows.filter((r) => r.verification === 'por_verificar').reduce((s, r) => s + Number(r.total), 0) };
  const save = async () => {
    const v = edit; const total = parseAmount(v.total);
    if (!v.third_party_name?.trim() || !v.number?.trim() || !v.issue_date || total === null || total < 0) return toast('Complete tercero, número, fecha y total', 'bad');
    const row = { kind, third_party_name: v.third_party_name.trim(), number: v.number.trim(), issue_date: v.issue_date, due_date: v.due_date || null,
      subtotal: parseAmount(v.subtotal) || 0, tax: parseAmount(v.tax) || 0, withholding: parseAmount(v.withholding) || 0, total, verification: v.verification, notes: v.notes || null };
    const r = v.id ? await db.from('invoices').update(row).eq('id', v.id) : await db.from('invoices').insert({ ...row, client_id: clientId, org_id: s.org!.id });
    if (r.error) return toast(r.error.message, 'bad'); setEdit(null); reload();
  };
  return (
    <>
      <div className="grid g4">
        <Stat label={kind === 'cobrar' ? 'Saldo por cobrar' : 'Saldo por pagar'} value={money(totals.open)} />
        <Stat label="Pagos pendientes de confirmar" value={money(totals.unconf)} t={totals.unconf ? 'warn' : undefined} />
        <Stat label="Importes por verificar" value={money(totals.verify)} t={totals.verify ? 'gold' : undefined} hint="Facturas sin soporte documental verificado" />
        <Stat label="Vence en 30 / 60 / 90 días" value={money(projection[0])} hint={`${money(projection[1])} · ${money(projection[2])}`} />
      </div>
      <Card title="Antigüedad de saldos">
        <div className="grid g4" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
          {AGING.map((a) => <div key={a} className="stat"><div className="muted small">{a === 'al_dia' ? 'No vencido' : `${a} días`}</div><div className="stat-v" style={{ fontSize: 18 }}>{money(aging[a])}</div></div>)}
        </div>
      </Card>
      <div className="toolbar">
        <Select value={status} onChange={(e: any) => setStatus(e.target.value)} options={[{ value: 'abiertas', label: 'Abiertas' }, { value: 'pagada', label: 'Pagadas' }, { value: 'anulada', label: 'Anuladas' }, { value: '', label: 'Todas' }]} />
        <div className="grow" />
        <Button variant="outline" icon="download" disabled={!rows.length} onClick={() => exportXLSX({ orgId: s.org!.id, title: kind === 'cobrar' ? 'Cuentas por cobrar' : 'Cuentas por pagar', filename: `cartera-${kind}`,
          headers: ['Tercero', 'Número', 'Emisión', 'Vencimiento', 'Total', 'Pagado confirmado', 'Pagado sin confirmar', 'Saldo', 'Antigüedad', 'Verificación', 'Estado'],
          rows: rows.map((r) => [r.third_party_name, r.number, r.issue_date, r.due_date, Number(r.total), Number(r.paid_confirmed), Number(r.paid_unconfirmed), Number(r.balance), r.aging, L(r.verification), L(r.status)]) })}>Exportar</Button>
        {s.can('cartera', 'crear') && <Button icon="plus" onClick={() => setEdit({ third_party_name: '', number: '', issue_date: today(), due_date: '', subtotal: '', tax: '', withholding: '', total: '', verification: 'por_verificar', notes: '' })}>Registrar factura</Button>}
      </div>
      <Card pad={false}>
        {loading ? <Loading /> : <Table rows={rows} onRow={(r) => setPay(r)} empty={<Empty title="Sin facturas" icon="wallet">Se registran manualmente o desde la revisión de facturas en el centro documental.</Empty>} columns={[
          { key: 't', label: 'Tercero', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.third_party_name}</div><div className="dim xs mono">{r.number}</div></div> },
          { key: 'due', label: 'Vence', render: (r) => { const d = daysUntil(r.due_date); return <div>{date(r.due_date)}{d !== null && r.status !== 'pagada' && <div className={`xs ${d < 0 ? 'diff-bad' : 'dim'}`}>{d < 0 ? `${-d} días vencida` : `en ${d} días`}</div>}</div>; } },
          { key: 'total', label: 'Total', num: true, render: (r) => money(r.total) },
          { key: 'bal', label: 'Saldo', num: true, render: (r) => <div>{money(r.balance)}{Number(r.paid_unconfirmed) > 0 && <div className="xs" style={{ color: 'var(--warn)' }}>{money(r.paid_unconfirmed)} sin confirmar</div>}</div> },
          { key: 'v', label: 'Soporte', render: (r) => <Badge status={r.verification} /> },
          { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> },
        ]} />}
      </Card>
      {edit && <Modal open title={edit.id ? 'Editar factura' : 'Registrar factura'} onClose={() => setEdit(null)} footer={<Button onClick={save}>Guardar</Button>}>
        <div className="form-grid">
          <Field label="Tercero" className="full"><Input value={edit.third_party_name} onChange={(e: any) => setEdit({ ...edit, third_party_name: e.target.value })} /></Field>
          <Field label="Número"><Input value={edit.number} onChange={(e: any) => setEdit({ ...edit, number: e.target.value })} /></Field>
          <Field label="Soporte"><Select value={edit.verification} onChange={(e: any) => setEdit({ ...edit, verification: e.target.value })} options={['por_verificar', 'documentado']} /></Field>
          <Field label="Emisión"><Input type="date" value={edit.issue_date} onChange={(e: any) => setEdit({ ...edit, issue_date: e.target.value })} /></Field>
          <Field label="Vencimiento"><Input type="date" value={edit.due_date || ''} onChange={(e: any) => setEdit({ ...edit, due_date: e.target.value })} /></Field>
          <Field label="Subtotal"><Input inputMode="decimal" value={edit.subtotal} onChange={(e: any) => setEdit({ ...edit, subtotal: e.target.value })} /></Field>
          <Field label="Impuestos"><Input inputMode="decimal" value={edit.tax} onChange={(e: any) => setEdit({ ...edit, tax: e.target.value })} /></Field>
          <Field label="Retenciones"><Input inputMode="decimal" value={edit.withholding} onChange={(e: any) => setEdit({ ...edit, withholding: e.target.value })} /></Field>
          <Field label="Total a pagar/cobrar"><Input inputMode="decimal" value={edit.total} onChange={(e: any) => setEdit({ ...edit, total: e.target.value })} /></Field>
        </div>
      </Modal>}
      {pay && <PaymentsModal inv={pay} onClose={() => setPay(null)} onChanged={reload} onEdit={() => { setEdit({ ...pay }); setPay(null); }} />}
    </>
  );
}

function PaymentsModal({ inv, onClose, onChanged, onEdit }: any) {
  const s = useSession(); const toast = useToast();
  const { data, reload } = useAsync(async () => ((await db.from('payments').select('*').eq('invoice_id', inv.id).order('date')).data as any[]) || [], [inv.id]);
  const [v, setV] = useState({ date: today(), amount: '', method: 'transferencia', reference: '' });
  const add = async () => {
    const amt = parseAmount(v.amount);
    if (!amt || amt <= 0) return toast('Valor inválido', 'bad');
    const r = await db.from('payments').insert({ invoice_id: inv.id, client_id: inv.client_id, org_id: inv.org_id, date: v.date, amount: amt, method: v.method, reference: v.reference || null });
    if (r.error) return toast(r.error.message, 'bad'); toast('Pago registrado (pendiente de confirmar)'); setV({ ...v, amount: '', reference: '' }); reload(); onChanged();
  };
  const confirm = async (p: any) => { const r = await db.rpc('confirm_payment', { p_payment: p.id }); if (r.error) return toast(r.error.message, 'bad'); toast('Pago confirmado'); reload(); onChanged(); };
  return (
    <Modal open wide title={`${inv.third_party_name} · ${inv.number}`} onClose={onClose} footer={s.can('cartera', 'editar') && <Button variant="outline" onClick={onEdit}>Editar factura</Button>}>
      <dl className="kv"><dt>Total</dt><dd>{money(inv.total)}</dd><dt>Saldo (pagos confirmados)</dt><dd><strong>{money(inv.balance)}</strong></dd><dt>Soporte</dt><dd><Badge status={inv.verification} /></dd></dl>
      <Table dense rows={data || []} empty={<p className="muted small">Sin pagos registrados.</p>} columns={[
        { key: 'date', label: 'Fecha', render: (r) => date(r.date) }, { key: 'amount', label: 'Valor', num: true, render: (r) => money(r.amount) }, { key: 'method', label: 'Medio' }, { key: 'reference', label: 'Referencia' },
        { key: 'c', label: 'Estado', render: (r) => r.confirmed ? <Badge t="ok">Confirmado</Badge> : <div className="row gap-s"><Badge t="warn">Sin confirmar</Badge>{s.can('cartera', 'aprobar') && <Button size="s" onClick={() => confirm(r)}>Confirmar</Button>}</div> }]} />
      {s.can('cartera', 'crear') && inv.status !== 'pagada' && <>
        <h4>Registrar pago recibido / realizado</h4>
        <div className="form-grid">
          <Field label="Fecha"><Input type="date" value={v.date} onChange={(e: any) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label="Valor"><Input inputMode="decimal" value={v.amount} onChange={(e: any) => setV({ ...v, amount: e.target.value })} /></Field>
          <Field label="Medio"><Select value={v.method} onChange={(e: any) => setV({ ...v, method: e.target.value })} options={[{ value: 'transferencia', label: 'Transferencia' }, { value: 'efectivo', label: 'Efectivo' }, { value: 'cheque', label: 'Cheque' }, { value: 'tarjeta', label: 'Tarjeta' }, { value: 'otro', label: 'Otro' }]} /></Field>
          <Field label="Referencia"><Input value={v.reference} onChange={(e: any) => setV({ ...v, reference: e.target.value })} /></Field>
        </div>
        <div><Button onClick={add}>Registrar pago</Button></div>
        <Alert kind="info">Registrar un pago aquí no mueve dinero. Solo un usuario con permiso de aprobación lo confirma tras verificar el soporte o la conciliación.</Alert>
      </>}
    </Modal>
  );
}
