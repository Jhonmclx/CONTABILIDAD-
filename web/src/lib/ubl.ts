// Lector de factura electrónica UBL 2.1 (DIAN) sin dependencias.
// Se usa en el servidor (función process-document) y en las pruebas.
// El contenido del XML se trata como dato NO confiable: solo se extraen valores, nunca se ejecuta nada.

export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);
const local = (n: string) => n.includes(':') ? n.split(':').pop()! : n;

export function parseXml(xml: string): XNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML con DOCTYPE/ENTITY no permitido');
  if (xml.length > 15_000_000) throw new Error('XML demasiado grande');
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decode(xml.slice(i, lt));
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt); if (end < 0) throw new Error('CDATA sin cerrar');
      stack[stack.length - 1].text += xml.slice(lt + 9, end); i = end + 3; continue;
    }
    if (xml.startsWith('<!--', lt)) { const end = xml.indexOf('-->', lt); i = end < 0 ? xml.length : end + 3; continue; }
    if (xml.startsWith('<?', lt)) { const end = xml.indexOf('?>', lt); i = end < 0 ? xml.length : end + 2; continue; }
    const gt = findTagEnd(xml, lt);
    const raw = xml.slice(lt + 1, gt);
    if (raw.startsWith('/')) {
      const nm = local(raw.slice(1).trim());
      while (stack.length > 1) { const n = stack.pop()!; if (n.name === nm) break; }
    } else {
      const selfClose = raw.endsWith('/');
      const body = selfClose ? raw.slice(0, -1) : raw;
      const m = /^([^\s/>]+)/.exec(body)!;
      const node: XNode = { name: local(m[1]), attrs: {}, children: [], text: '' };
      for (const a of body.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[local(a[1])] = decode(a[3] ?? a[4] ?? '');
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
      if (stack.length > 200) throw new Error('XML demasiado profundo');
    }
    i = gt + 1;
  }
  return root;
}

function findTagEnd(s: string, from: number) {
  let q: string | null = null;
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return i;
  }
  throw new Error('Etiqueta sin cerrar');
}

const kids = (n: XNode | undefined, name: string) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n: XNode | undefined, name: string) => kids(n, name)[0];
function path(n: XNode | undefined, ...names: string[]) { let cur = n; for (const nm of names) cur = kid(cur, nm); return cur; }
const txt = (n: XNode | undefined) => (n ? n.text.trim() : '');
const num = (n: XNode | undefined) => { const t = txt(n); if (!t) return null; const v = Number(t); return isFinite(v) ? v : null; };

export interface InvoiceFields {
  tipo_documento?: string; numero_factura?: string; cufe?: string; fecha_emision?: string; fecha_vencimiento?: string; moneda?: string;
  emisor?: string; nit_emisor?: string; dv_emisor?: string; receptor?: string; nit_receptor?: string; dv_receptor?: string;
  subtotal?: number; base_gravable?: number; iva?: number; inc?: number; ica?: number; otros_impuestos?: number; impuestos_total?: number;
  rete_fuente?: number; rete_iva?: number; rete_ica?: number; retenciones?: number; total?: number;
  impuestos_detalle?: { codigo: string; nombre: string; base: number | null; tarifa: number | null; valor: number | null }[];
  lineas?: { descripcion: string; cantidad: number | null; valor: number | null }[];
}
export interface Extraction { fields: InvoiceFields; confidence: Record<string, number>; issues: string[] }

const TAX: Record<string, string> = { '01': 'IVA', '02': 'IC', '03': 'ICA', '04': 'INC', '05': 'ReteIVA', '06': 'ReteRenta', '07': 'ReteICA', 'ZZ': 'Otro' };

function party(p: XNode | undefined) {
  const party = kid(p, 'Party');
  const tax = kid(party, 'PartyTaxScheme');
  const legal = kid(party, 'PartyLegalEntity');
  const idNode = kid(tax, 'CompanyID') || kid(legal, 'CompanyID') || path(party, 'PartyIdentification', 'ID');
  return {
    name: txt(kid(tax, 'RegistrationName')) || txt(kid(legal, 'RegistrationName')) || txt(path(party, 'PartyName', 'Name')),
    nit: txt(idNode).replace(/[^\dA-Za-z]/g, ''),
    dv: idNode?.attrs.schemeID && /^\d$/.test(idNode.attrs.schemeID) ? idNode.attrs.schemeID : '',
  };
}

/** Extrae los campos de una factura UBL (Invoice, CreditNote o AttachedDocument que la contiene). */
export function extractInvoice(xml: string): Extraction {
  let root = parseXml(xml);
  let doc = root.children.find((c) => ['Invoice', 'CreditNote', 'DebitNote', 'AttachedDocument'].includes(c.name));
  if (!doc) throw new Error('El XML no es una factura electrónica UBL reconocida');
  if (doc.name === 'AttachedDocument') {
    const inner = txt(path(doc, 'Attachment', 'ExternalReference', 'Description'));
    if (!inner) throw new Error('El AttachedDocument no contiene la factura');
    root = parseXml(inner);
    doc = root.children.find((c) => ['Invoice', 'CreditNote', 'DebitNote'].includes(c.name));
    if (!doc) throw new Error('El documento adjunto no es una factura UBL');
  }
  const f: InvoiceFields = {}; const conf: Record<string, number> = {}; const issues: string[] = [];
  const put = (k: keyof InvoiceFields, v: any, c = 0.99) => { if (v !== '' && v !== null && v !== undefined) { (f as any)[k] = v; conf[k] = c; } };

  put('tipo_documento', doc.name === 'Invoice' ? 'factura' : doc.name === 'CreditNote' ? 'nota_credito' : 'nota_debito');
  put('numero_factura', txt(kid(doc, 'ID')));
  put('cufe', txt(kid(doc, 'UUID')));
  put('fecha_emision', txt(kid(doc, 'IssueDate')));
  put('fecha_vencimiento', txt(kid(doc, 'DueDate')) || txt(path(doc, 'PaymentMeans', 'PaymentDueDate')), 0.95);
  put('moneda', txt(kid(doc, 'DocumentCurrencyCode')) || 'COP', txt(kid(doc, 'DocumentCurrencyCode')) ? 0.99 : 0.6);
  const sup = party(kid(doc, 'AccountingSupplierParty')); const cus = party(kid(doc, 'AccountingCustomerParty'));
  put('emisor', sup.name); put('nit_emisor', sup.nit); put('dv_emisor', sup.dv);
  put('receptor', cus.name); put('nit_receptor', cus.nit); put('dv_receptor', cus.dv);

  const tot = kid(doc, 'LegalMonetaryTotal') || kid(doc, 'RequestedMonetaryTotal');
  put('subtotal', num(kid(tot, 'LineExtensionAmount')));
  put('base_gravable', num(kid(tot, 'TaxExclusiveAmount')));
  put('total', num(kid(tot, 'PayableAmount')) ?? num(kid(tot, 'TaxInclusiveAmount')));

  const detail: NonNullable<InvoiceFields['impuestos_detalle']> = [];
  const sums: Record<string, number> = {};
  for (const tt of [...kids(doc, 'TaxTotal'), ...kids(doc, 'WithholdingTaxTotal')]) {
    const subs = kids(tt, 'TaxSubtotal');
    for (const st of subs.length ? subs : [tt]) {
      const code = txt(path(st, 'TaxCategory', 'TaxScheme', 'ID')) || 'ZZ';
      const val = num(kid(st, 'TaxAmount'));
      detail.push({ codigo: code, nombre: TAX[code] || txt(path(st, 'TaxCategory', 'TaxScheme', 'Name')) || code, base: num(kid(st, 'TaxableAmount')), tarifa: num(path(st, 'TaxCategory', 'Percent')), valor: val });
      sums[code] = (sums[code] || 0) + (val || 0);
    }
  }
  if (detail.length) put('impuestos_detalle', detail);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  if (sums['01'] !== undefined) put('iva', r2(sums['01']));
  if (sums['04'] !== undefined) put('inc', r2(sums['04']));
  if (sums['03'] !== undefined) put('ica', r2(sums['03']));
  const otros = Object.entries(sums).filter(([k]) => !['01', '03', '04', '05', '06', '07'].includes(k)).reduce((s, [, v]) => s + v, 0);
  if (otros) put('otros_impuestos', r2(otros));
  if (sums['06'] !== undefined) put('rete_fuente', r2(sums['06']));
  if (sums['05'] !== undefined) put('rete_iva', r2(sums['05']));
  if (sums['07'] !== undefined) put('rete_ica', r2(sums['07']));
  const ret = (sums['05'] || 0) + (sums['06'] || 0) + (sums['07'] || 0);
  if (ret) put('retenciones', r2(ret));
  const imp = Object.entries(sums).filter(([k]) => !['05', '06', '07'].includes(k)).reduce((s, [, v]) => s + v, 0);
  put('impuestos_total', r2(imp));

  const lines = [...kids(doc, 'InvoiceLine'), ...kids(doc, 'CreditNoteLine'), ...kids(doc, 'DebitNoteLine')].map((l) => ({
    descripcion: txt(path(l, 'Item', 'Description')) || txt(path(l, 'Item', 'Name')),
    cantidad: num(kid(l, 'InvoicedQuantity')) ?? num(kid(l, 'CreditedQuantity')) ?? num(kid(l, 'DebitedQuantity')),
    valor: num(kid(l, 'LineExtensionAmount')),
  }));
  if (lines.length) put('lineas', lines.slice(0, 500));

  // Validaciones de coherencia: no se inventan datos, solo se marcan para revisión
  for (const k of ['numero_factura', 'fecha_emision', 'nit_emisor', 'total'] as const) if (f[k] === undefined) issues.push(`falta_${k}`);
  if (f.subtotal !== undefined && f.total !== undefined && f.base_gravable !== undefined) {
    const inclusive = num(kid(tot, 'TaxInclusiveAmount'));
    if (inclusive !== null && Math.abs(inclusive - (f.base_gravable + imp)) > 1) { issues.push('impuestos_no_cuadran'); conf.impuestos_total = 0.5; }
  }
  if (lines.length && f.subtotal !== undefined) {
    const s = lines.reduce((a, l) => a + (l.valor || 0), 0);
    if (Math.abs(s - f.subtotal) > 1) { issues.push('lineas_no_suman_subtotal'); conf.subtotal = 0.6; }
  }
  if (f.fecha_emision && !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha_emision)) { issues.push('fecha_invalida'); conf.fecha_emision = 0.3; }
  return { fields: f, confidence: conf, issues };
}
