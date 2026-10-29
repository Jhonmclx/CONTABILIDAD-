import { downloadBlob } from './files';
import { toCSV, toXLSX } from './tabular';
import { db } from './sb';

export interface ExportSpec {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: any[][];
  filename: string;
  status?: 'preliminar' | 'aprobado';
  orgId?: string;
  footer?: string;
}

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

async function audit(spec: ExportSpec, format: string) {
  if (spec.orgId) await db.rpc('log_event', { p_org: spec.orgId, p_action: 'exportacion', p_entity: 'informe', p_entity_id: spec.filename, p_reason: `${format}: ${spec.title}` });
}

export async function exportXLSX(spec: ExportSpec) {
  await audit(spec, 'xlsx');
  const rows = spec.status ? [[`Estado: ${spec.status.toUpperCase()}`], [], ...spec.rows] : spec.rows;
  downloadBlob(toXLSX(spec.title, spec.headers, rows), `${spec.filename}.xlsx`);
}

export async function exportCSV(spec: ExportSpec) {
  await audit(spec, 'csv');
  downloadBlob(new Blob([toCSV(spec.headers, spec.rows)], { type: 'text/csv;charset=utf-8' }), `${spec.filename}.csv`);
}

/** Genera un PDF mediante la impresión del navegador ("Guardar como PDF"), con diseño de informe. */
export async function exportPDF(spec: ExportSpec) {
  await audit(spec, 'pdf');
  const numeric = spec.headers.map((_, i) => spec.rows.length > 0 && spec.rows.every((r) => r[i] === '' || r[i] === null || typeof r[i] === 'number' || /^[-$\s\d.,]+$/.test(String(r[i]))));
  const fmt = (v: any) => (typeof v === 'number' ? v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : esc(v));
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(spec.title)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  body { font: 10.5px/1.45 "Inter", system-ui, sans-serif; color: #0f172a; }
  header { border-bottom: 2px solid #059669; padding-bottom: 8px; margin-bottom: 12px; display:flex; justify-content:space-between; align-items:flex-end; }
  h1 { font-size: 16px; margin: 0; } .sub { color:#475569; margin-top:2px }
  .badge { font-weight:700; letter-spacing:.08em; font-size:10px; padding:4px 8px; border-radius:4px; border:1px solid; }
  .pre { color:#b45309; border-color:#f59e0b; } .apr { color:#047857; border-color:#10b981; }
  table { width:100%; border-collapse: collapse; } th { text-align:left; background:#f1f5f9; font-weight:600; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; } td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr { page-break-inside: avoid; } footer { margin-top: 14px; color: #64748b; font-size: 9px; }
</style></head><body>
<header><div><h1>${esc(spec.title)}</h1>${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}</div>
${spec.status ? `<span class="badge ${spec.status === 'aprobado' ? 'apr' : 'pre'}">${spec.status === 'aprobado' ? 'APROBADO' : 'PRELIMINAR'}</span>` : ''}</header>
<table><thead><tr>${spec.headers.map((h, i) => `<th class="${numeric[i] ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${spec.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${numeric[i] ? 'n' : ''}">${fmt(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<footer>Generado el ${new Date().toLocaleString('es-CO')}${spec.footer ? ' · ' + esc(spec.footer) : ''}</footer>
<script>window.onload=()=>{window.print();}</script></body></html>`;
  const w = window.open('', '_blank', 'width=1000,height=800');
  if (!w) { downloadBlob(new Blob([html], { type: 'text/html' }), `${spec.filename}.html`); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

export function vcard(p: { name: string; org?: string; title?: string; phone?: string; whatsapp?: string; email?: string; url?: string; address?: string; note?: string }) {
  const e = (s?: string) => (s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${e(p.name)}`, `N:${e(p.name)};;;;`];
  if (p.org) lines.push(`ORG:${e(p.org)}`);
  if (p.title) lines.push(`TITLE:${e(p.title)}`);
  if (p.phone) lines.push(`TEL;TYPE=WORK,VOICE:${p.phone.replace(/[^\d+]/g, '')}`);
  if (p.whatsapp && p.whatsapp !== p.phone) lines.push(`TEL;TYPE=CELL:${p.whatsapp.replace(/[^\d+]/g, '')}`);
  if (p.email) lines.push(`EMAIL;TYPE=WORK:${p.email}`);
  if (p.url) lines.push(`URL:${p.url}`);
  if (p.address) lines.push(`ADR;TYPE=WORK:;;${e(p.address)};;;;`);
  if (p.note) lines.push(`NOTE:${e(p.note)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export const waLink = (num: string, text = '') => {
  let d = num.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) d = '57' + d;   // celular colombiano
  return `https://wa.me/${d}${text ? '?text=' + encodeURIComponent(text) : ''}`;
};
