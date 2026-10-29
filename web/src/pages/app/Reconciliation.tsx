import { useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Card, Confirm, Empty, Field, Input, Loading, Modal, Select, Stat, Table, Textarea, useToast } from '../../components/ui';
import { ClientPicker, NeedClient, useClients } from '../../components/AppShell';
import { currentPeriod, date, L, money } from '../../lib/format';
import { normHeader, parseAmount, parseDate, readTable } from '../../lib/tabular';
import { sha256 } from '../../lib/files';
import { exportXLSX } from '../../lib/export';

export function Reconciliation() {
  const [stmt, setStmt] = useState<string | null>(null);
  return (
    <>
      <div className="page-h">
        <div><h2>Conciliación bancaria</h2><p className="muted small">Importe el extracto, revise las coincidencias propuestas y justifique cada decisión. Nada ambiguo se concilia automáticamente.</p></div>
        <ClientPicker />
      </div>
      <NeedClient>{stmt ? <StatementDetail id={stmt} onBack={() => setStmt(null)} /> : <Overview onOpen={setStmt} />}</NeedClient>
    </>
  );
}

function Overview({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const [acc, setAcc] = useState<any>(null); const [imp, setImp] = useState(false);
  const { data, loading, reload } = useAsync(async () => {
    const [b, st, ac] = await Promise.all([
      db.from('bank_accounts').select('*,ledger:accounts(code,name)').eq('client_id', clientId).order('name'),
      db.from('bank_statements').select('*,bank:bank_accounts(name,bank_name)').eq('client_id', clientId).order('period', { ascending: false }),
      db.from('accounts').select('id,code,name').eq('client_id', clientId).eq('accepts_movements', true).like('code', '11*'),
    ]);
    return { banks: (b.data as any[]) || [], statements: (st.data as any[]) || [], accounts: (ac.data as any[]) || [] };
  }, [clientId]);
  const saveAcc = async () => {
    if (acc.name.trim().length < 2) return toast('Nombre obligatorio', 'bad');
    const row = { name: acc.name.trim(), bank_name: acc.bank_name || null, number_last4: acc.number_last4 || null, ledger_account_id: acc.ledger_account_id || null };
    const r = acc.id ? await db.from('bank_accounts').update(row).eq('id', acc.id) : await db.from('bank_accounts').insert({ ...row, client_id: clientId, org_id: s.org!.id });
    if (r.error) return toast(r.error.message, 'bad'); setAcc(null); reload();
  };
  if (loading || !data) return <Loading />;
  return (
    <>
      <Card title="Cuentas bancarias" pad={false} actions={s.can('conciliacion', 'crear') && <Button size="s" icon="plus" onClick={() => setAcc({ name: '', bank_name: '', number_last4: '', ledger_account_id: '' })}>Cuenta bancaria</Button>}>
        <Table dense rows={data.banks} onRow={(r) => setAcc(r)} empty={<Empty title="Sin cuentas bancarias" icon="bank">Registre la cuenta y asóciela a su cuenta contable (por ejemplo 111005).</Empty>} columns={[
          { key: 'name', label: 'Cuenta' }, { key: 'bank_name', label: 'Banco' }, { key: 'n', label: 'Número', render: (r) => r.number_last4 ? `•••• ${r.number_last4}` : '—' },
          { key: 'l', label: 'Cuenta contable', render: (r) => r.ledger ? `${r.ledger.code} ${r.ledger.name}` : <Badge t="warn">Sin asociar</Badge> }]} />
      </Card>
      <Card title="Extractos y conciliaciones" pad={false} actions={s.can('conciliacion', 'crear') && data.banks.length > 0 && <Button size="s" icon="upload" onClick={() => setImp(true)}>Importar extracto</Button>}>
        <Table rows={data.statements} onRow={(r) => onOpen(r.id)} empty={<Empty title="Sin conciliaciones" icon="bank">Importe un extracto en CSV o XLSX para comenzar.</Empty>} columns={[
          { key: 'period', label: 'Periodo' }, { key: 'bank', label: 'Cuenta', render: (r) => r.bank?.name }, { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status === 'aprobada' ? 'aprobada' : r.status} /> },
          { key: 'ap', label: 'Aprobada', render: (r) => date(r.approved_at) }]} />
      </Card>
      {acc && <Modal open title={acc.id ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria'} onClose={() => setAcc(null)} footer={<Button onClick={saveAcc}>Guardar</Button>}>
        <Field label="Nombre interno"><Input value={acc.name} onChange={(e: any) => setAcc({ ...acc, name: e.target.value })} placeholder="Cuenta corriente principal" /></Field>
        <div className="form-grid"><Field label="Banco"><Input value={acc.bank_name || ''} onChange={(e: any) => setAcc({ ...acc, bank_name: e.target.value })} /></Field>
          <Field label="Últimos 4 dígitos" hint="No se guarda el número completo"><Input value={acc.number_last4 || ''} maxLength={4} inputMode="numeric" onChange={(e: any) => setAcc({ ...acc, number_last4: e.target.value.replace(/\D/g, '') })} /></Field></div>
        <Field label="Cuenta contable del banco"><Select value={acc.ledger_account_id || ''} onChange={(e: any) => setAcc({ ...acc, ledger_account_id: e.target.value })} placeholder="Seleccione…" options={data.accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>
      </Modal>}
      <ImportStatement open={imp} banks={data.banks} onClose={() => setImp(false)} onDone={(id: string) => { setImp(false); reload(); onOpen(id); }} />
    </>
  );
}

function ImportStatement({ open, banks, onClose, onDone }: any) {
  const s = useSession(); const toast = useToast(); const { clientId } = useClients();
  const [bank, setBank] = useState(''); const [period, setPeriod] = useState(currentPeriod());
  const [raw, setRaw] = useState<string[][] | null>(null); const [map, setMap] = useState<Record<string, number>>({}); const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f) return;
    try {
      let rows = await readTable(f);
      const hi = rows.findIndex((r) => r.some((c) => /fecha/i.test(c)) && r.some((c) => /valor|monto|debito|d[eé]bito|cr[eé]dito|retiro|deposito|importe/i.test(c)));
      if (hi > 0) rows = rows.slice(hi);
      const h = rows[0].map(normHeader); const find = (re: RegExp) => h.findIndex((x) => re.test(x));
      setMap({ date: find(/^fecha/), desc: find(/descrip|concepto|detalle|transacc/), ref: find(/refer|documento|comprobante/), amount: find(/^(valor|monto|importe)/), debit: find(/debito|retiro|cargo|egreso/), credit: find(/credito|deposito|abono|ingreso/) });
      setRaw(rows);
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const parsed = useMemo(() => {
    if (!raw) return [];
    return raw.slice(1).map((r, i) => {
      const d = parseDate(r[map.date] || '');
      let amt = map.amount >= 0 ? parseAmount(r[map.amount] || '') : null;
      if (amt === null && (map.debit >= 0 || map.credit >= 0)) { const de = parseAmount(r[map.debit] || '') || 0; const cr = parseAmount(r[map.credit] || '') || 0; amt = cr - Math.abs(de); }
      const desc = (r[map.desc] || '').trim();
      const issues = [!d && 'Fecha inválida', (amt === null || amt === 0) && 'Valor inválido o cero', !desc && 'Sin descripción'].filter(Boolean);
      if (d && period && d.slice(0, 7) !== period) issues.push('Fuera del periodo');
      return { line: i + 2, date: d, description: desc, reference: (r[map.ref] || '').trim() || null, amount: amt, issues };
    });
  }, [raw, map, period]);
  const valid = parsed.filter((p) => !p.issues.length);
  const go = async () => {
    if (!bank) return toast('Seleccione la cuenta bancaria', 'bad');
    setBusy(true);
    const sid = crypto.randomUUID();
    const r = await db.from('bank_statements').insert({ id: sid, client_id: clientId, org_id: s.org!.id, bank_account_id: bank, period });
    if (r.error) { setBusy(false); return toast(r.error.message, 'bad'); }
    const seen: Record<string, number> = {};
    const lines = [];
    for (const p of valid) {
      const base = `${p.date}|${p.description}|${p.reference || ''}|${p.amount}`; seen[base] = (seen[base] || 0) + 1;
      lines.push({ statement_id: sid, client_id: clientId, org_id: s.org!.id, date: p.date, description: p.description.slice(0, 300), reference: p.reference, amount: p.amount,
        line_hash: await sha256(new TextEncoder().encode(base + '|' + seen[base])) });
    }
    const li = await db.from('bank_lines').insert(lines);
    setBusy(false);
    if (li.error) return toast(li.error.message, 'bad');
    toast(`${lines.length} movimientos importados`); setRaw(null); onDone(sid);
  };
  const cols = raw ? raw[0].map((h, i) => ({ value: String(i), label: h || `Columna ${i + 1}` })) : [];
  return (
    <Modal open={open} onClose={() => { setRaw(null); onClose(); }} wide title="Importar extracto bancario" footer={<Button disabled={!valid.length} loading={busy} onClick={go}>Importar {valid.length} movimientos</Button>}>
      <div className="form-grid">
        <Field label="Cuenta bancaria"><Select value={bank} onChange={(e: any) => setBank(e.target.value)} placeholder="Seleccione…" options={banks.map((b: any) => ({ value: b.id, label: b.name }))} /></Field>
        <Field label="Periodo"><Input type="month" value={period} onChange={(e: any) => setPeriod(e.target.value)} /></Field>
      </div>
      <input type="file" className="input" accept=".csv,.xlsx" onChange={(e: any) => pick(e.target.files?.[0])} />
      {raw && <>
        <p className="small muted">Verifique qué columna corresponde a cada dato. Los valores positivos son entradas y los negativos salidas.</p>
        <div className="form-grid">
          {([['date', 'Fecha'], ['desc', 'Descripción'], ['ref', 'Referencia'], ['amount', 'Valor (con signo)'], ['debit', 'Débito / retiro'], ['credit', 'Crédito / depósito']] as const).map(([k, l]) =>
            <Field key={k} label={l}><Select value={map[k] >= 0 ? String(map[k]) : ''} onChange={(e: any) => setMap({ ...map, [k]: e.target.value === '' ? -1 : Number(e.target.value) })} placeholder="(no aplica)" options={cols} /></Field>)}
        </div>
        <p className="small"><strong>{valid.length}</strong> válidos · <span className="diff-bad">{parsed.length - valid.length} con observaciones</span></p>
        <Table dense rowKey="line" rows={parsed.slice(0, 200)} columns={[{ key: 'line', label: 'Fila' }, { key: 'date', label: 'Fecha' }, { key: 'description', label: 'Descripción' },
          { key: 'amount', label: 'Valor', num: true, render: (r) => r.amount === null ? '—' : money(r.amount) }, { key: 'i', label: 'Validación', render: (r) => r.issues.length ? <span className="diff-bad small">{r.issues.join(', ')}</span> : <Badge t="ok">OK</Badge> }]} />
      </>}
    </Modal>
  );
}

function StatementDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const s = useSession(); const toast = useToast();
  const [filter, setFilter] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const [decide, setDecide] = useState<any>(null); const [manual, setManual] = useState<any>(null); const [noMatch, setNoMatch] = useState<any>(null);
  const { data, loading, reload } = useAsync(async () => {
    const st = (await db.from('bank_statements').select('*,bank:bank_accounts(name,ledger_account_id)').eq('id', id).maybeSingle()).data as any;
    const lines = ((await db.from('bank_lines').select('*').eq('statement_id', id).order('date')).data as any[]) || [];
    const matches = lines.length ? ((await db.from('reconciliation_matches').select('*').in('bank_line_id', lines.map((l) => l.id))).data as any[]) || [] : [];
    const vlIds = Array.from(new Set(matches.map((m) => m.voucher_line_id).filter(Boolean)));
    const entries = vlIds.length ? ((await db.from('ledger_entries').select('line_id,date,voucher_type,number,voucher_description,debit,credit,third_party_name').in('line_id', vlIds)).data as any[]) || [] : [];
    const em = Object.fromEntries(entries.map((e) => [e.line_id, e]));
    return { st, lines: lines.map((l) => ({ ...l, matches: matches.filter((m) => m.bank_line_id === l.id).map((m) => ({ ...m, entry: em[m.voucher_line_id] })) })) };
  }, [id]);
  if (loading || !data) return <Loading />;
  const { st, lines } = data;
  const locked = st.status === 'aprobada';
  const sum = (f: (l: any) => boolean) => lines.filter(f).reduce((a, l) => a + Number(l.amount), 0);
  const counts = { total: lines.length, ok: lines.filter((l) => l.status === 'conciliada').length, prop: lines.filter((l) => l.status === 'propuesta').length, none: lines.filter((l) => ['sin_conciliar', 'sin_correspondencia'].includes(l.status)).length };
  const shown = filter ? lines.filter((l) => l.status === filter) : lines;
  const run = async (fn: string, args: any, msg: string) => { setBusy(fn); const r = await db.rpc(fn, args); setBusy(null); if (r.error) { toast(r.error.message, 'bad'); return false; } toast(typeof msg === 'function' ? (msg as any)(r.data) : msg); reload(); return true; };
  return (
    <>
      <div className="row between wrap gap">
        <div><Button variant="ghost" size="s" onClick={onBack}>← Conciliaciones</Button><h3 className="mt-s">{st.bank?.name} · {st.period}</h3><Badge status={locked ? 'aprobada' : st.status} /></div>
        <div className="row gap-s wrap">
          <Button variant="outline" icon="download" onClick={() => exportXLSX({ orgId: s.org!.id, title: `Conciliación ${st.period}`, filename: `conciliacion-${st.period}`, status: locked ? 'aprobado' : 'preliminar',
            headers: ['Fecha', 'Descripción', 'Referencia', 'Valor', 'Categoría', 'Estado', 'Comprobante', 'Justificación'],
            rows: lines.map((l) => { const m = l.matches.find((x: any) => x.decision === 'aceptada'); return [l.date, l.description, l.reference, Number(l.amount), L(l.category), L(l.status), m?.entry ? `${m.entry.voucher_type}-${m.entry.number}` : '', m?.justification || '']; }) })}>Exportar</Button>
          {!locked && s.can('conciliacion', 'editar') && <Button variant="outline" loading={busy === 'propose_matches'} onClick={() => run('propose_matches', { p_statement: id }, 'Coincidencias propuestas: revíselas una a una')}>Proponer coincidencias</Button>}
          {!locked && st.status === 'en_proceso' && s.can('conciliacion', 'editar') && <Button variant="outline" onClick={async () => { const r = await db.from('bank_statements').update({ status: 'en_revision' }).eq('id', id); if (r.error) toast(r.error.message, 'bad'); else { toast('Enviada a revisión'); reload(); } }}>Enviar a revisión</Button>}
          {!locked && s.can('conciliacion', 'aprobar') && <Button loading={busy === 'approve_statement'} onClick={() => run('approve_statement', { p_statement: id }, ((n: number) => n ? `Aprobada con ${n} diferencias: se creó una tarea de investigación` : 'Conciliación aprobada') as any)}>Aprobar conciliación</Button>}
        </div>
      </div>
      {!st.bank?.ledger_account_id && <Alert kind="warn">La cuenta bancaria no está asociada a una cuenta contable: no se pueden proponer coincidencias.</Alert>}
      <div className="grid g4">
        <Stat label="Movimientos" value={counts.total} /><Stat label="Conciliados" value={counts.ok} t="ok" /><Stat label="Por decidir" value={counts.prop} t={counts.prop ? 'warn' : undefined} />
        <Stat label="Sin correspondencia" value={counts.none} t={counts.none ? 'bad' : undefined} hint={`Neto pendiente ${money(sum((l) => l.status !== 'conciliada'))}`} />
      </div>
      <div className="toolbar"><Select value={filter} onChange={(e: any) => setFilter(e.target.value)} placeholder="Todos" options={['sin_conciliar', 'propuesta', 'conciliada', 'sin_correspondencia']} />
        <span className="small muted">Entradas {money(sum((l) => l.amount > 0))} · Salidas {money(sum((l) => l.amount < 0))}</span></div>
      <Card pad={false}>
        <Table dense rows={shown} columns={[
          { key: 'date', label: 'Fecha', render: (r) => date(r.date) },
          { key: 'description', label: 'Movimiento', render: (r) => <div><div>{r.description}</div><div className="dim xs">{r.reference}{r.category ? ` · ${L(r.category)}` : ''}</div></div> },
          { key: 'amount', label: 'Valor', num: true, render: (r) => <span className={r.amount < 0 ? 'diff-bad' : 'diff-ok'}>{money(r.amount)}</span> },
          { key: 'm', label: 'Coincidencia', render: (r) => {
            const acc = r.matches.find((m: any) => m.decision === 'aceptada');
            if (acc) return <div className="small">{acc.entry ? `${acc.entry.voucher_type}-${acc.entry.number} · ${acc.entry.voucher_description}` : 'Movimiento contable'}<div className="dim xs">{L(acc.match_type)}{acc.justification ? ` · ${acc.justification}` : ''}</div></div>;
            const props = r.matches.filter((m: any) => m.decision === 'propuesta');
            return props.length ? <div className="col gap-s" style={{ alignItems: 'flex-start' }}>{props.map((m: any) => <button key={m.id} className="btn btn-s btn-outline" disabled={locked} onClick={() => setDecide({ ...m, line: r })}>
              {m.entry ? `${m.entry.voucher_type}-${m.entry.number}` : '?'} · {date(m.entry?.date)} · {Math.round(m.score)}%</button>)}</div> : <span className="dim xs">—</span>;
          } },
          { key: 'st', label: 'Estado', render: (r) => <Badge status={r.status} /> },
          { key: 'a', label: '', render: (r) => !locked && r.status !== 'conciliada' && s.can('conciliacion', 'editar') && <div className="row gap-s"><Button size="s" variant="ghost" onClick={() => setManual(r)}>Manual</Button>
            {r.status !== 'sin_correspondencia' && <Button size="s" variant="ghost" onClick={() => setNoMatch(r)}>Sin corresp.</Button>}</div> },
        ]} />
      </Card>
      {decide && <DecideModal m={decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); reload(); }} />}
      {manual && <ManualMatch line={manual} ledgerAccount={st.bank?.ledger_account_id} onClose={() => setManual(null)} onDone={() => { setManual(null); reload(); }} />}
      <Confirm open={!!noMatch} title="Marcar sin correspondencia" needReason reasonLabel="Justificación" onClose={() => setNoMatch(null)}
        onConfirm={async (j: string) => { if (await run('mark_no_match', { p_line: noMatch.id, p_justification: j }, 'Registrado como diferencia')) setNoMatch(null); }}>
        <p className="muted">Úselo para comisiones, impuestos bancarios o movimientos aún no registrados en contabilidad. Quedará como diferencia pendiente.</p></Confirm>
    </>
  );
}

function DecideModal({ m, onClose, onDone }: any) {
  const toast = useToast(); const [j, setJ] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (decision: string) => {
    setBusy(true); const r = await db.rpc('decide_match', { p_match: m.id, p_decision: decision, p_justification: j || null }); setBusy(false);
    if (r.error) return toast(r.error.message, 'bad'); toast(decision === 'aceptada' ? 'Coincidencia aceptada' : 'Coincidencia rechazada'); onDone();
  };
  return (
    <Modal open title="Revisar coincidencia" onClose={onClose} footer={<><Button variant="outline" loading={busy} onClick={() => go('rechazada')}>Rechazar</Button><Button loading={busy} onClick={() => go('aceptada')}>Aceptar</Button></>}>
      <dl className="kv">
        <dt>Banco</dt><dd>{date(m.line.date)} · {m.line.description} · <strong>{money(m.line.amount)}</strong></dd>
        <dt>Contabilidad</dt><dd>{m.entry ? <>{date(m.entry.date)} · {m.entry.voucher_type}-{m.entry.number} · {m.entry.voucher_description} · <strong>{money(Number(m.entry.debit) - Number(m.entry.credit))}</strong>{m.entry.third_party_name ? ` · ${m.entry.third_party_name}` : ''}</> : '—'}</dd>
        <dt>Tipo</dt><dd><Badge t={m.match_type === 'exacta' ? 'ok' : 'warn'}>{L(m.match_type)}</Badge> · puntaje {Math.round(m.score)}%</dd>
      </dl>
      <Field label={m.match_type === 'exacta' ? 'Justificación (opcional)' : 'Justificación (obligatoria)'}><Textarea value={j} onChange={(e: any) => setJ(e.target.value)} /></Field>
    </Modal>
  );
}

function ManualMatch({ line, ledgerAccount, onClose, onDone }: any) {
  const toast = useToast(); const [sel, setSel] = useState(''); const [j, setJ] = useState('');
  const from = new Date(new Date(line.date).getTime() - 20 * 86400000).toISOString().slice(0, 10);
  const to = new Date(new Date(line.date).getTime() + 20 * 86400000).toISOString().slice(0, 10);
  const { data } = useAsync(async () => ledgerAccount ? ((await db.from('ledger_entries').select('*').eq('account_id', ledgerAccount).gte('date', from).lte('date', to).order('date')).data as any[]) || [] : [], [line.id]);
  const go = async () => {
    const r = await db.rpc('manual_match', { p_line: line.id, p_voucher_line: sel, p_justification: j });
    if (r.error) return toast(r.error.message, 'bad'); toast('Conciliado manualmente'); onDone();
  };
  return (
    <Modal open wide title="Conciliación manual" onClose={onClose} footer={<Button disabled={!sel || j.trim().length < 5} onClick={go}>Conciliar</Button>}>
      <p className="small">Movimiento bancario: <strong>{date(line.date)} · {line.description} · {money(line.amount)}</strong></p>
      <Table dense rowKey="line_id" rows={data || []} empty={<p className="muted small">No hay movimientos contables de la cuenta bancaria en ±20 días.</p>} columns={[
        { key: 's', label: '', render: (r) => <input type="radio" name="vl" checked={sel === r.line_id} onChange={() => setSel(r.line_id)} aria-label="Seleccionar" /> },
        { key: 'date', label: 'Fecha', render: (r) => date(r.date) }, { key: 'v', label: 'Comprobante', render: (r) => `${r.voucher_type}-${r.number}` },
        { key: 'd', label: 'Descripción', render: (r) => r.voucher_description }, { key: 'val', label: 'Valor', num: true, render: (r) => money(Number(r.debit) - Number(r.credit)) }]} />
      <Field label="Justificación (obligatoria)"><Textarea value={j} onChange={(e: any) => setJ(e.target.value)} /></Field>
    </Modal>
  );
}
