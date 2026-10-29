import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Field, Input, Modal, Select, Table, useToast } from '../../components/ui';
import { L, money } from '../../lib/format';
import { navigate } from '../../lib/router';

const FIELDS: [string, string, 'text' | 'date' | 'num'][] = [
  ['numero_factura', 'Número de factura', 'text'], ['cufe', 'CUFE', 'text'], ['fecha_emision', 'Fecha de emisión', 'date'], ['fecha_vencimiento', 'Fecha de vencimiento', 'date'],
  ['emisor', 'Emisor', 'text'], ['nit_emisor', 'NIT emisor', 'text'], ['receptor', 'Receptor', 'text'], ['nit_receptor', 'NIT receptor', 'text'],
  ['subtotal', 'Subtotal', 'num'], ['iva', 'IVA', 'num'], ['inc', 'Impuesto al consumo', 'num'], ['otros_impuestos', 'Otros impuestos', 'num'],
  ['rete_fuente', 'Retención en la fuente', 'num'], ['rete_iva', 'ReteIVA', 'num'], ['rete_ica', 'ReteICA', 'num'], ['total', 'Total', 'num'], ['moneda', 'Moneda', 'text'],
];
const ISSUE: Record<string, string> = {
  posible_duplicado: 'Posible factura duplicada (mismo emisor y número, o misma fecha y total)', impuestos_no_cuadran: 'Los impuestos no cuadran con el total',
  lineas_no_suman_subtotal: 'Las líneas no suman el subtotal', revision_obligatoria_ocr: 'Datos leídos por OCR/IA: verifique cada valor', fecha_invalida: 'Fecha con formato inválido',
};

export function ReviewModal({ doc, onClose, onChanged }: { doc: any; onClose: () => void; onChanged: () => void }) {
  const s = useSession(); const toast = useToast();
  const [ext, setExt] = useState<any>(null); const [v, setV] = useState<Record<string, any>>({}); const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'review' | 'propose'>('review');
  useEffect(() => {
    if (!doc) return;
    setStep('review');
    db.from('extractions').select('*').eq('document_id', doc.id).maybeSingle().then((r) => { setExt(r.data); setV({ ...(r.data?.fields || {}) }); });
  }, [doc?.id]);
  if (!doc) return null;
  const conf = ext?.confidence || {};
  const approved = ext?.status === 'aprobado';
  const num = (x: any) => (x === '' || x === undefined || x === null ? undefined : Number(x));
  const clean = () => {
    const out: Record<string, any> = { ...v };
    for (const [k, , t] of FIELDS) { if (out[k] === '') delete out[k]; else if (t === 'num' && out[k] !== undefined) out[k] = num(out[k]); }
    out.retenciones = (out.rete_fuente || 0) + (out.rete_iva || 0) + (out.rete_ica || 0) || undefined;
    return out;
  };
  const saveReview = async () => {
    setBusy(true);
    const fields = clean(); const payload = { fields, status: 'revisado', reviewed_by: s.session!.user.id, reviewed_at: new Date().toISOString() };
    const r = ext ? await db.from('extractions').update(payload).eq('id', ext.id)
      : await db.from('extractions').insert({ ...payload, document_id: doc.id, client_id: doc.client_id, org_id: doc.org_id, provider: 'manual' });
    if (!r.error) await db.from('documents').update({ status: 'procesado' }).eq('id', doc.id);
    setBusy(false);
    if (r.error) return toast(r.error.message, 'bad');
    const fresh = await db.from('extractions').select('*').eq('document_id', doc.id).maybeSingle();
    setExt(fresh.data); toast('Revisión guardada'); onChanged(); setStep('propose');
  };
  return (
    <Modal open={!!doc} onClose={onClose} wide title={`Revisión: ${doc.title}`}>
      <div className="pill-steps">{['Extracción', 'Revisión del auxiliar', 'Propuesta contable', 'Aprobación del contador'].map((t, i) => <span key={t} className={(ext ? (ext.status === 'aprobado' ? 4 : ['revisado'].includes(ext.status) ? 2 : 1) : 0) > i ? 'on' : ''}>{i + 1}. {t}</span>)}</div>
      {ext?.error && <Alert kind="warn">{ext.error}</Alert>}
      {!ext && <Alert kind="info">Este documento aún no tiene extracción. Use <strong>Procesar</strong> (XML se lee automáticamente) o registre los datos manualmente aquí.</Alert>}
      {(ext?.issues || []).length > 0 && <Alert kind="warn"><strong>Revisar:</strong><ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{ext.issues.map((i: string) => <li key={i}>{ISSUE[i] || L(i)}</li>)}</ul></Alert>}
      {approved && <Alert kind="ok">Extracción aprobada y contabilizada. Los datos ya no se pueden modificar desde aquí.</Alert>}
      {step === 'review' ? <>
        <div className="form-grid">
          {FIELDS.map(([k, label, t]) => {
            const c = conf[k]; const missing = v[k] === undefined || v[k] === '';
            return (
              <Field key={k} label={<span className="row gap-s">{label}{c !== undefined && !missing && <span className={`conf ${c < 0.9 ? 'low' : ''}`} title={`Confianza ${Math.round(c * 100)}%`}><i style={{ width: `${c * 100}%` }} /></span>}
                {missing && ['numero_factura', 'fecha_emision', 'nit_emisor', 'total'].includes(k) && <Badge t="warn">Falta</Badge>}</span>}>
                <Input type={t === 'date' ? 'date' : 'text'} inputMode={t === 'num' ? 'decimal' : undefined} disabled={approved} value={v[k] ?? ''} onChange={(e: any) => setV({ ...v, [k]: e.target.value })} />
              </Field>
            );
          })}
        </div>
        {v.lineas?.length > 0 && <Table dense rows={v.lineas.map((l: any, i: number) => ({ ...l, id: i }))} columns={[
          { key: 'descripcion', label: 'Concepto' }, { key: 'cantidad', label: 'Cant.', num: true }, { key: 'valor', label: 'Valor', num: true, render: (r) => money(r.valor) }]} />}
        <div className="row gap-s wrap" style={{ justifyContent: 'flex-end' }}>
          {ext?.status === 'revisado' && !approved && <Button variant="outline" onClick={() => setStep('propose')}>Ir a propuesta contable</Button>}
          {!approved && <Button loading={busy} onClick={saveReview}>Confirmar datos revisados</Button>}
        </div>
      </> : <Propose doc={doc} ext={ext} onDone={() => { onChanged(); onClose(); }} onBack={() => setStep('review')} />}
    </Modal>
  );
}

function Propose({ doc, ext, onDone, onBack }: any) {
  const toast = useToast();
  const f = ext.fields || {};
  const [client, setClient] = useState<any>(null); const [accounts, setAccounts] = useState<any[]>([]);
  const [dir, setDir] = useState<'compra' | 'venta'>(doc.doc_type === 'factura_venta' ? 'venta' : 'compra');
  const [acc, setAcc] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [registerInv, setRegisterInv] = useState(true);
  useEffect(() => {
    Promise.all([db.from('clients').select('id,id_number,name').eq('id', doc.client_id).maybeSingle(),
      db.from('accounts').select('id,code,name,accepts_movements,is_active,account_type').eq('client_id', doc.client_id).eq('accepts_movements', true).eq('is_active', true).order('code')])
      .then(([c, a]) => {
        setClient(c.data); setAccounts((a.data as any[]) || []);
        if (c.data && f.nit_emisor && String(f.nit_emisor) === String((c.data as any).id_number)) setDir('venta');
      });
  }, [doc.id]);
  const pick = (prefixes: string[]) => { for (const p of prefixes) { const a = accounts.find((x) => x.code.startsWith(p)); if (a) return a.id; } return ''; };
  useEffect(() => {
    if (!accounts.length) return;
    setAcc(dir === 'compra'
      ? { gasto: pick(['5195', '5135', '51', '6135', '14']), iva: pick(['2408']), rete: pick(['2365']), reteiva: pick(['2367']), reteica: pick(['2368']), cxp: pick(['2205', '2335']) }
      : { cxc: pick(['130505', '1305']), ingreso: pick(['4135', '4155', '41']), iva: pick(['2408']), rete: pick(['1355']), reteiva: pick(['1355']), reteica: pick(['1355']) });
  }, [accounts, dir]);
  const n = (x: any) => Number(x || 0);
  const taxes = n(f.iva) + n(f.inc) + n(f.otros_impuestos);
  const ret = { rete: n(f.rete_fuente), reteiva: n(f.rete_iva), reteica: n(f.rete_ica) };
  const totalRet = ret.rete + ret.reteiva + ret.reteica;
  const base = n(f.subtotal) || n(f.total) - taxes;
  const lines = useMemo(() => {
    const L: { key: string; label: string; debit: number; credit: number }[] = [];
    if (dir === 'compra') {
      L.push({ key: 'gasto', label: 'Gasto / costo / inventario', debit: base, credit: 0 });
      if (taxes) L.push({ key: 'iva', label: 'IVA descontable / impuestos', debit: taxes, credit: 0 });
      if (ret.rete) L.push({ key: 'rete', label: 'Retención en la fuente por pagar', debit: 0, credit: ret.rete });
      if (ret.reteiva) L.push({ key: 'reteiva', label: 'ReteIVA por pagar', debit: 0, credit: ret.reteiva });
      if (ret.reteica) L.push({ key: 'reteica', label: 'ReteICA por pagar', debit: 0, credit: ret.reteica });
      L.push({ key: 'cxp', label: 'Proveedor (cuenta por pagar)', debit: 0, credit: base + taxes - totalRet });
    } else {
      L.push({ key: 'cxc', label: 'Cliente (cuenta por cobrar)', debit: base + taxes - totalRet, credit: 0 });
      if (ret.rete) L.push({ key: 'rete', label: 'Anticipo: retención que le practicaron', debit: ret.rete, credit: 0 });
      if (ret.reteiva) L.push({ key: 'reteiva', label: 'Anticipo: ReteIVA', debit: ret.reteiva, credit: 0 });
      if (ret.reteica) L.push({ key: 'reteica', label: 'Anticipo: ReteICA', debit: ret.reteica, credit: 0 });
      L.push({ key: 'ingreso', label: 'Ingreso', debit: 0, credit: base });
      if (taxes) L.push({ key: 'iva', label: 'IVA generado / impuestos', debit: 0, credit: taxes });
    }
    return L.map((l) => ({ ...l, debit: Math.round(l.debit * 100) / 100, credit: Math.round(l.credit * 100) / 100 }));
  }, [dir, base, taxes, ret.rete, ret.reteiva, ret.reteica]);
  const td = lines.reduce((a, l) => a + l.debit, 0), tc = lines.reduce((a, l) => a + l.credit, 0);
  const counterpart = dir === 'compra' ? { name: f.emisor, nit: f.nit_emisor, dv: f.dv_emisor } : { name: f.receptor, nit: f.nit_receptor, dv: f.dv_receptor };

  const create = async () => {
    if (!f.fecha_emision || !base) return toast('Faltan fecha o valores revisados', 'bad');
    if (lines.some((l) => !acc[l.key])) return toast('Seleccione la cuenta de cada línea', 'bad');
    if (Math.abs(td - tc) > 0.009) return toast('La propuesta no cuadra; revise los valores', 'bad');
    setBusy(true);
    try {
      let tpId: string | null = null;
      if (counterpart.nit) {
        const ex = await db.from('third_parties').select('id').eq('client_id', doc.client_id).eq('id_number', counterpart.nit).maybeSingle();
        if (ex.data) tpId = (ex.data as any).id;
        else { tpId = crypto.randomUUID(); const r = await db.from('third_parties').insert({ id: tpId, client_id: doc.client_id, org_id: doc.org_id, id_number: counterpart.nit, dv: counterpart.dv || null, name: counterpart.name || counterpart.nit }); if (r.error) throw r.error; }
      }
      const vid = crypto.randomUUID();
      const vt = dir === 'compra' ? 'FC' : 'FV';
      const vr = await db.from('vouchers').insert({ id: vid, client_id: doc.client_id, org_id: doc.org_id, voucher_type: vt, date: f.fecha_emision,
        description: `${dir === 'compra' ? 'Compra' : 'Venta'} factura ${f.numero_factura || ''} ${counterpart.name || ''}`.trim().slice(0, 300),
        source: ext.provider === 'xml_ubl' ? 'xml' : 'ia', extraction_id: ext.id, document_id: doc.id });
      if (vr.error) throw vr.error;
      const lr = await db.from('voucher_lines').insert(lines.map((l, i) => ({ voucher_id: vid, client_id: doc.client_id, org_id: doc.org_id, line_no: i + 1, account_id: acc[l.key],
        third_party_id: tpId, description: l.label, debit: l.debit, credit: l.credit })));
      if (lr.error) throw lr.error;
      await db.from('extractions').update({ voucher_id: vid }).eq('id', ext.id);
      if (registerInv && f.numero_factura) {
        await db.from('invoices').insert({ client_id: doc.client_id, org_id: doc.org_id, kind: dir === 'compra' ? 'pagar' : 'cobrar', third_party_id: tpId, third_party_name: counterpart.name || counterpart.nit || 'Sin nombre',
          number: f.numero_factura, issue_date: f.fecha_emision, due_date: f.fecha_vencimiento || null, subtotal: base, tax: taxes, withholding: totalRet, total: base + taxes - totalRet,
          verification: 'documentado', document_id: doc.id, extraction_id: ext.id });
      }
      toast('Comprobante borrador creado. Envíelo a revisión para que el contador lo apruebe.');
      onDone(); navigate(`/app/contabilidad?comprobante=${vid}`);
    } catch (e: any) { toast(e.message || 'No se pudo crear la propuesta', 'bad'); }
    finally { setBusy(false); }
  };
  if (!client) return <p className="muted">Cargando cuentas…</p>;
  if (!accounts.length) return <Alert kind="warn">El cliente no tiene plan de cuentas. Cárguelo en Contabilidad → Plan de cuentas.</Alert>;
  return (
    <div className="col gap">
      <Alert kind="info">Propuesta de contabilización <strong>sugerida por reglas</strong> a partir de los datos revisados. Es un borrador: verifique cuentas, valores y tratamiento tributario antes de enviarlo a aprobación.</Alert>
      <div className="form-grid">
        <Field label="Naturaleza de la factura"><Select value={dir} onChange={(e: any) => setDir(e.target.value)} options={[{ value: 'compra', label: `Compra (emisor: ${f.emisor || '—'})` }, { value: 'venta', label: `Venta (receptor: ${f.receptor || '—'})` }]} /></Field>
        <Field label="Tercero"><Input value={`${counterpart.name || '—'} · ${counterpart.nit || 'sin NIT'}`} disabled /></Field>
      </div>
      <div className="table-wrap"><table className="table dense"><thead><tr><th>Concepto</th><th>Cuenta</th><th className="num">Débito</th><th className="num">Crédito</th></tr></thead>
        <tbody>{lines.map((l) => <tr key={l.key}><td data-label="Concepto">{l.label}</td>
          <td data-label="Cuenta"><Select value={acc[l.key] || ''} onChange={(e: any) => setAcc({ ...acc, [l.key]: e.target.value })} placeholder="Seleccione…" options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></td>
          <td className="num" data-label="Débito">{l.debit ? money(l.debit) : ''}</td><td className="num" data-label="Crédito">{l.credit ? money(l.credit) : ''}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}>Totales</td><td className="num">{money(td)}</td><td className="num">{money(tc)}</td></tr></tfoot></table></div>
      <label className="check"><input type="checkbox" checked={registerInv} onChange={(e: any) => setRegisterInv(e.target.checked)} /><span>Registrar también en {dir === 'compra' ? 'cuentas por pagar' : 'cuentas por cobrar'} como importe documentado</span></label>
      <div className="row gap-s" style={{ justifyContent: 'flex-end' }}><Button variant="ghost" onClick={onBack}>Volver a los datos</Button><Button loading={busy} onClick={create}>Crear comprobante borrador</Button></div>
    </div>
  );
}
