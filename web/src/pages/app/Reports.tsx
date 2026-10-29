import { useState } from 'react';
import { useSession } from '../../lib/session';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Select } from '../../components/ui';
import { ClientPicker, NeedClient, useClients } from '../../components/AppShell';
import { amount, L, today } from '../../lib/format';
import { exportCSV, exportPDF, exportXLSX } from '../../lib/export';

interface Out { headers: string[]; rows: any[][]; numeric?: number[]; note?: string; missing?: string; status?: 'preliminar' | 'aprobado'; totalRow?: any[] }

const REPORTS = [
  { id: 'tb', label: 'Balance de prueba', fin: true }, { id: 'bs', label: 'Estado de situación financiera', fin: true }, { id: 'is', label: 'Estado de resultados', fin: true },
  { id: 'journal', label: 'Libro diario', fin: true }, { id: 'ledger', label: 'Libro mayor', fin: true }, { id: 'account', label: 'Movimientos por cuenta', fin: true, needAccount: true },
  { id: 'third', label: 'Auxiliar por tercero', fin: true }, { id: 'ar', label: 'Cuentas por cobrar' }, { id: 'ap', label: 'Cuentas por pagar' },
  { id: 'rec', label: 'Conciliación bancaria' }, { id: 'ie', label: 'Resumen de ingresos y gastos', fin: true },
  { id: 'pending', label: 'Actividad pendiente por cliente', org: true }, { id: 'missing', label: 'Documentos faltantes', org: true }, { id: 'oblig', label: 'Estado de obligaciones y vencimientos', org: true },
];
const r2 = (x: number) => Math.round(x * 100) / 100;

async function closedStatus(clientId: string, from: string, to: string): Promise<'preliminar' | 'aprobado'> {
  const months: string[] = []; const d = new Date(from.slice(0, 7) + '-01T12:00:00'); const end = new Date(to.slice(0, 7) + '-01T12:00:00');
  while (d <= end && months.length < 60) { months.push(`${d.getFullYear()}-${d.getMonth() + 1}`); d.setMonth(d.getMonth() + 1); }
  const p = ((await db.from('periods').select('year,month,status').eq('client_id', clientId).eq('status', 'cerrado')).data as any[]) || [];
  const closed = new Set(p.map((x) => `${x.year}-${x.month}`));
  return months.every((m) => closed.has(m)) ? 'aprobado' : 'preliminar';
}

async function tb(clientId: string, from: string, to: string) {
  const r = await db.rpc<any[]>('report_trial_balance', { p_client: clientId, p_from: from, p_to: to });
  if (r.error) throw new Error(r.error.message);
  return r.data || [];
}

async function build(id: string, clientId: string, orgId: string, from: string, to: string, account: string): Promise<Out> {
  const fin = REPORTS.find((r) => r.id === id)?.fin;
  const status = fin ? await closedStatus(clientId, from, to) : undefined;
  const none = (msg: string): Out => ({ headers: [], rows: [], missing: msg, status });
  switch (id) {
    case 'tb': {
      const d = await tb(clientId, from, to); if (!d.length) return none('No hay comprobantes contabilizados en el rango. Contabilice comprobantes para generar el balance.');
      const t = d.reduce((a, x) => ({ d: a.d + Number(x.debit), c: a.c + Number(x.credit) }), { d: 0, c: 0 });
      return { status, headers: ['Código', 'Cuenta', 'Saldo inicial', 'Débitos', 'Créditos', 'Saldo final'], numeric: [2, 3, 4, 5],
        rows: d.map((x) => [x.code, x.name, r2(+x.opening), r2(+x.debit), r2(+x.credit), r2(+x.closing)]), totalRow: ['', 'Totales', '', r2(t.d), r2(t.c), ''],
        note: Math.abs(t.d - t.c) < 0.01 ? 'Sumas iguales: débitos y créditos coinciden.' : 'ATENCIÓN: débitos y créditos no coinciden.' };
    }
    case 'bs': {
      const d = await tb(clientId, '1900-01-01', to); if (!d.length) return none('No hay saldos contabilizados a la fecha de corte.');
      const yStart = to.slice(0, 4) + '-01-01';
      const res = (await tb(clientId, yStart, to)).filter((x) => ['ingreso', 'gasto', 'costo'].includes(x.account_type));
      const result = res.reduce((s, x) => s + (x.account_type === 'ingreso' ? Number(x.credit) - Number(x.debit) : -(Number(x.debit) - Number(x.credit))), 0);
      const sec = (t: string) => d.filter((x) => x.account_type === t && Math.abs(+x.closing) > 0.004);
      const sum = (a: any[]) => a.reduce((s, x) => s + Number(x.closing), 0);
      const rows: any[][] = [];
      for (const [t, label] of [['activo', 'ACTIVO'], ['pasivo', 'PASIVO'], ['patrimonio', 'PATRIMONIO']] as const) {
        const a = sec(t); rows.push([label, '', '']); a.forEach((x) => rows.push([x.code, x.name, r2(+x.closing)]));
        if (t === 'patrimonio') rows.push(['', 'Resultado del ejercicio (no cerrado)', r2(result)]);
        rows.push(['', `Total ${label.toLowerCase()}`, r2(sum(a) + (t === 'patrimonio' ? result : 0))]);
      }
      const A = sum(sec('activo')), P = sum(sec('pasivo')), E = sum(sec('patrimonio')) + result;
      return { status, headers: ['Código', 'Cuenta', 'Saldo'], numeric: [2], rows, note: `Activo ${amount(A)} · Pasivo + Patrimonio ${amount(P + E)} · ${Math.abs(A - P - E) < 0.01 ? 'Ecuación contable cuadrada' : 'Diferencia ' + amount(A - P - E)}. Presentación por tipo de cuenta según el plan configurado.` };
    }
    case 'is': case 'ie': {
      const d = (await tb(clientId, from, to)).filter((x) => ['ingreso', 'gasto', 'costo'].includes(x.account_type));
      if (!d.length) return none('No hay movimientos de ingresos, costos o gastos contabilizados en el rango.');
      const net = (x: any) => (x.account_type === 'ingreso' ? Number(x.credit) - Number(x.debit) : Number(x.debit) - Number(x.credit));
      const by = (t: string) => d.filter((x) => x.account_type === t);
      const tot = (t: string) => by(t).reduce((s, x) => s + net(x), 0);
      if (id === 'ie') return { status, headers: ['Concepto', 'Valor'], numeric: [1], rows: [['Ingresos', r2(tot('ingreso'))], ['Costos', r2(tot('costo'))], ['Gastos', r2(tot('gasto'))], ['Resultado', r2(tot('ingreso') - tot('costo') - tot('gasto'))]] };
      const rows: any[][] = [];
      for (const [t, l] of [['ingreso', 'INGRESOS'], ['costo', 'COSTOS'], ['gasto', 'GASTOS']] as const) { rows.push([l, '', '']); by(t).forEach((x) => rows.push([x.code, x.name, r2(net(x))])); rows.push(['', `Total ${l.toLowerCase()}`, r2(tot(t))]); }
      rows.push(['', 'RESULTADO DEL PERIODO', r2(tot('ingreso') - tot('costo') - tot('gasto'))]);
      return { status, headers: ['Código', 'Cuenta', 'Valor'], numeric: [2], rows };
    }
    case 'journal': case 'ledger': case 'account': case 'third': {
      if (id === 'account' && !account) return none('Seleccione una cuenta.');
      let q = db.from('ledger_entries').select('*').eq('client_id', clientId).gte('date', from).lte('date', to);
      if (id === 'account') q = q.eq('account_id', account);
      const d = ((await q.order('date').order('number').order('line_no').limit(20000)).data as any[]) || [];
      if (!d.length) return none('No hay movimientos contabilizados en el rango seleccionado.');
      if (id === 'journal') return { status, headers: ['Fecha', 'Comprobante', 'Cuenta', 'Tercero', 'Detalle', 'Débito', 'Crédito'], numeric: [5, 6],
        rows: d.map((x) => [x.date, `${x.voucher_type}-${x.number}`, `${x.account_code} ${x.account_name}`, x.third_party_name || '', x.description || x.voucher_description, r2(+x.debit), r2(+x.credit)]),
        totalRow: ['', '', '', '', 'Totales', r2(d.reduce((s, x) => s + +x.debit, 0)), r2(d.reduce((s, x) => s + +x.credit, 0))] };
      const keyOf = (x: any) => (id === 'third' ? (x.third_party_name ? `${x.third_party_nit} ${x.third_party_name}` : 'Sin tercero') : `${x.account_code} ${x.account_name}`);
      const groups: Record<string, any[]> = {}; d.forEach((x) => (groups[keyOf(x)] ||= []).push(x));
      const rows: any[][] = [];
      for (const k of Object.keys(groups).sort()) {
        rows.push([k, '', '', '', '', '']); let bal = 0;
        for (const x of groups[k]) { bal += +x.debit - +x.credit; rows.push([x.date, `${x.voucher_type}-${x.number}`, id === 'third' ? `${x.account_code} ${x.account_name}` : (x.third_party_name || x.description || x.voucher_description), r2(+x.debit), r2(+x.credit), r2(bal)]); }
      }
      return { status, headers: ['Fecha', 'Comprobante', id === 'third' ? 'Cuenta' : 'Detalle', 'Débito', 'Crédito', 'Saldo acumulado'], numeric: [3, 4, 5], rows, note: 'Saldo acumulado de los movimientos del rango (débito − crédito).' };
    }
    case 'ar': case 'ap': {
      const d = ((await db.from('invoice_balances').select('*').eq('client_id', clientId).eq('kind', id === 'ar' ? 'cobrar' : 'pagar').in('status', ['pendiente', 'parcial']).order('due_date')).data as any[]) || [];
      if (!d.length) return none('No hay facturas abiertas registradas.');
      return { headers: ['Tercero', 'Número', 'Emisión', 'Vencimiento', 'Antigüedad', 'Total', 'Pagado (confirmado)', 'Saldo', 'Soporte'], numeric: [5, 6, 7],
        rows: d.map((x) => [x.third_party_name, x.number, x.issue_date, x.due_date, x.aging, r2(+x.total), r2(+x.paid_confirmed), r2(+x.balance), L(x.verification)]),
        totalRow: ['Total', '', '', '', '', '', '', r2(d.reduce((s, x) => s + +x.balance, 0)), ''], note: 'Solo se descuentan pagos confirmados. Los importes "por verificar" no tienen soporte documental validado.' };
    }
    case 'rec': {
      const st = ((await db.from('bank_statements').select('id,period,status,bank:bank_accounts(name)').eq('client_id', clientId).gte('period', from.slice(0, 7)).lte('period', to.slice(0, 7))).data as any[]) || [];
      if (!st.length) return none('No hay conciliaciones en el rango.');
      const lines = ((await db.from('bank_lines').select('statement_id,status,amount').in('statement_id', st.map((x) => x.id))).data as any[]) || [];
      return { headers: ['Periodo', 'Cuenta', 'Estado', 'Movimientos', 'Conciliados', 'Pendientes', 'Valor pendiente'], numeric: [3, 4, 5, 6],
        rows: st.map((x) => { const l = lines.filter((y) => y.statement_id === x.id); const p = l.filter((y) => y.status !== 'conciliada');
          return [x.period, x.bank?.name, L(x.status), l.length, l.length - p.length, p.length, r2(p.reduce((s, y) => s + +y.amount, 0))]; }) };
    }
    case 'pending': {
      const t = ((await db.from('tasks').select('client_id,status,due_date,client:clients(name)').eq('org_id', orgId).in('status', ['pendiente', 'en_proceso', 'en_revision', 'devuelta', 'bloqueada']).limit(5000)).data as any[]) || [];
      if (!t.length) return none('No hay tareas pendientes.');
      const g: Record<string, any> = {};
      for (const x of t) { const k = x.client?.name || 'General'; g[k] ||= { n: 0, late: 0, rev: 0 }; g[k].n++; if (x.due_date && x.due_date < today()) g[k].late++; if (x.status === 'en_revision') g[k].rev++; }
      return { headers: ['Cliente', 'Tareas abiertas', 'Vencidas', 'En revisión'], numeric: [1, 2, 3], rows: Object.entries(g).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, v.n, v.late, v.rev]) };
    }
    case 'missing': {
      const d = ((await db.from('document_requests').select('title,period,due_date,created_at,client:clients(name)').eq('org_id', orgId).eq('status', 'pendiente').order('due_date')).data as any[]) || [];
      if (!d.length) return none('No hay documentos solicitados pendientes.');
      return { headers: ['Cliente', 'Documento', 'Periodo', 'Plazo', 'Estado'], rows: d.map((x) => [x.client?.name, x.title, x.period, x.due_date, x.due_date && x.due_date < today() ? 'Atrasado' : 'Pendiente']) };
    }
    case 'oblig': {
      const d = ((await db.from('obligations').select('name,period_label,due_date,status,date_confirmed,client:clients(name)').eq('org_id', orgId).gte('due_date', from).lte('due_date', to).order('due_date')).data as any[]) || [];
      if (!d.length) return none('No hay obligaciones con vencimiento en el rango.');
      return { headers: ['Vence', 'Cliente', 'Obligación', 'Periodo', 'Estado', 'Fecha verificada'], rows: d.map((x) => [x.due_date, x.client?.name, x.name, x.period_label, L(x.status), x.date_confirmed ? 'Sí' : 'Por confirmar']) };
    }
  }
  return none('Informe no disponible');
}

export function Reports() {
  const s = useSession(); const { clientId, clients } = useClients();
  const [rep, setRep] = useState('tb'); const y = today().slice(0, 4);
  const [from, setFrom] = useState(`${y}-01-01`); const [to, setTo] = useState(today()); const [account, setAccount] = useState('');
  const [out, setOut] = useState<Out | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const meta = REPORTS.find((r) => r.id === rep)!;
  const client = clients.find((c) => c.id === clientId);
  const run = async () => {
    setBusy(true); setErr(null); setOut(null);
    try {
      if (meta.needAccount && !accounts.length) setAccounts(((await db.from('accounts').select('id,code,name').eq('client_id', clientId).eq('accepts_movements', true).order('code')).data as any[]) || []);
      setOut(await build(rep, clientId, s.org!.id, from, to, account));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const spec = () => ({ orgId: s.org!.id, title: meta.label, subtitle: `${meta.org ? s.org!.name : `${client?.name} · NIT ${client?.id_number}`} · ${from} a ${to}`, headers: out!.headers,
    rows: out!.totalRow ? [...out!.rows, out!.totalRow] : out!.rows, filename: `${rep}-${from}-${to}`, status: out!.status, footer: s.brand?.commercial_name });
  const canExport = s.can('informes', 'exportar');
  return (
    <>
      <div className="page-h"><div><h2>Informes</h2><p className="muted small">Generados con registros contabilizados. Se marcan como <strong>preliminares</strong> si algún mes del rango sigue abierto.</p></div>{!meta.org && <ClientPicker />}</div>
      <NeedClient>
        <Card>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            <Field label="Informe"><Select value={rep} onChange={(e: any) => { setRep(e.target.value); setOut(null); }} options={REPORTS.map((r) => ({ value: r.id, label: r.label }))} /></Field>
            <Field label={rep === 'bs' ? 'Desde (no aplica)' : 'Desde'}><Input type="date" value={from} onChange={(e: any) => setFrom(e.target.value)} disabled={rep === 'bs'} /></Field>
            <Field label={rep === 'bs' ? 'Fecha de corte' : 'Hasta'}><Input type="date" value={to} onChange={(e: any) => setTo(e.target.value)} /></Field>
            {meta.needAccount && <Field label="Cuenta"><Select value={account} onFocus={async () => !accounts.length && setAccounts(((await db.from('accounts').select('id,code,name').eq('client_id', clientId).eq('accepts_movements', true).order('code')).data as any[]) || [])}
              onChange={(e: any) => setAccount(e.target.value)} placeholder="Seleccione…" options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>}
            <div style={{ alignSelf: 'end' }}><Button loading={busy} onClick={run} icon="chart">Generar</Button></div>
          </div>
        </Card>
        {err && <Alert kind="bad">{err}</Alert>}
        {busy && <Loading label="Calculando…" />}
        {out && (out.missing ? <Card><Empty title="Sin información suficiente" icon="info">{out.missing}</Empty></Card> : (
          <Card title={meta.label} subtitle={meta.org ? s.org!.name : `${client?.name} · ${from} a ${to}`} actions={<>
            {out.status && <Badge t={out.status === 'aprobado' ? 'ok' : 'warn'}>{out.status === 'aprobado' ? 'Periodos cerrados' : 'Preliminar'}</Badge>}
            {canExport && <><Button size="s" variant="outline" onClick={() => exportPDF(spec())}>PDF</Button><Button size="s" variant="outline" onClick={() => exportXLSX(spec())}>XLSX</Button><Button size="s" variant="ghost" onClick={() => exportCSV(spec())}>CSV</Button></>}
          </>} pad={false}>
            {out.note && <div style={{ padding: '0 20px 12px' }}><p className="small muted">{out.note}</p></div>}
            <div className="table-wrap" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
              <table className="table dense">
                <thead><tr>{out.headers.map((h, i) => <th key={i} className={out.numeric?.includes(i) ? 'num' : ''}>{h}</th>)}</tr></thead>
                <tbody>{out.rows.map((r, i) => { const head = r.slice(1).every((c) => c === '' || c === undefined) && typeof r[0] === 'string' && r[0] === r[0].toUpperCase() && r[0].length > 2;
                  return <tr key={i} style={head ? { background: 'rgba(16,185,129,.06)' } : undefined}>{r.map((c, j) => <td key={j} data-label={out.headers[j]} className={out.numeric?.includes(j) ? 'num' : ''} style={head ? { fontWeight: 750 } : /^Total|^RESULTADO/.test(String(r[1] ?? '')) ? { fontWeight: 700 } : undefined}>{typeof c === 'number' ? amount(c) : c}</td>)}</tr>; })}</tbody>
                {out.totalRow && <tfoot><tr>{out.totalRow.map((c, j) => <td key={j} className={out.numeric?.includes(j) ? 'num' : ''}>{typeof c === 'number' ? amount(c) : c}</td>)}</tr></tfoot>}
              </table>
            </div>
          </Card>))}
      </NeedClient>
    </>
  );
}
