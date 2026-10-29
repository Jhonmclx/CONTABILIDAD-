// Lectura y escritura de CSV y XLSX sin dependencias externas.
// XLSX = ZIP con XML (Office Open XML). La lectura usa DecompressionStream del navegador.

export type Row = Record<string, string>;

// ---------- CSV ----------
export function parseCSV(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = [];
    } else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const csvCell = (v: any) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;              // evita inyección de fórmulas
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCSV(headers: string[], rows: any[][]) {
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

// ---------- ZIP ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder(); const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

async function inflateRaw(d: Uint8Array): Promise<Uint8Array> {
  const ds = new (window as any).DecompressionStream('deflate-raw');
  const stream = new Blob([d as any]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); const out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Archivo XLSX inválido');
  const count = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(p + 10, true); const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true); const xlen = v.getUint16(p + 30, true); const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true); const name = dec.decode(buf.slice(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet1\.xml|workbook\.xml)$/.test(name)) continue;
    const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const data = buf.slice(start, start + csize);
    if (csize > 50 * 1024 * 1024) throw new Error('Hoja demasiado grande');
    out.set(name, method === 0 ? data : await inflateRaw(data));
  }
  return out;
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function colName(i: number) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function colIndex(ref: string) { const l = ref.replace(/\d+/g, ''); let n = 0; for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

/** Genera un .xlsx (una hoja). Números se guardan como número; el resto como texto. */
export function toXLSX(sheetName: string, headers: string[], rows: any[][]): Blob {
  const enc = new TextEncoder();
  const cell = (v: any, r: number, c: number, bold = false) => {
    const ref = colName(c) + (r + 1);
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${bold ? ' s="1"' : ' s="2"'}><v>${v}</v></c>`;
    if (v === null || v === undefined || v === '') return '';
    return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
  };
  const data = [headers, ...rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci, ri === 0)).join('')}</row>`).join('');
  const widths = headers.map((h, i) => Math.min(60, Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData></worksheet>`;
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
  ];
  return new Blob([zipStore(files) as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Lee la primera hoja de un .xlsx como matriz de texto. */
export async function parseXLSX(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(new Uint8Array(buf));
  const dec = new TextDecoder();
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const m of dec.decode(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unesc(Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((x) => x[1]).join('')));
  const sh = files.get('xl/worksheets/sheet1.xml');
  if (!sh) throw new Error('No se encontró la primera hoja');
  const rows: string[][] = [];
  for (const rm of dec.decode(sh).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const inner = cm[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]; const t = /t="(\w+)"/.exec(attrs)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1])] ?? '';
      else if (t === 'inlineStr') val = unesc(Array.from(inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((x) => x[1]).join(''));
      else val = unesc(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      row[ref ? colIndex(ref) : row.length] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    if (row.some((x) => x.trim() !== '')) rows.push(row);
  }
  return rows;
}

export async function readTable(file: File): Promise<string[][]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv' || ext === 'txt') return parseCSV(await file.text());
  if (ext === 'xlsx') return parseXLSX(await file.arrayBuffer());
  throw new Error('Formato no soportado. Use CSV o XLSX.');
}

/** Convierte matriz en objetos usando la primera fila como encabezados normalizados. */
export function toObjects(rows: string[][]): Row[] {
  if (!rows.length) return [];
  const h = rows[0].map(normHeader);
  return rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? '').trim()])));
}
export const normHeader = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Convierte "1.234.567,89", "1,234,567.89", "-$ 1.000" en número. */
export function parseAmount(s: string): number | null {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[^\d,.\-()]/g, '');
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.includes('-');
  t = t.replace(/[()\-]/g, '');
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > ld) t = t.replace(/\./g, '').replace(',', '.');
  else if (ld > lc && lc >= 0) t = t.replace(/,/g, '');
  else if (lc < 0 && (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  else if (ld >= 0 && t.length - ld - 1 === 3 && lc < 0) t = t.replace(/\./g, '');
  const n = Number(t);
  return isFinite(n) ? (neg ? -n : n) : null;
}

/** Normaliza fechas dd/mm/aaaa, aaaa-mm-dd, dd-mm-aaaa o número de serie de Excel. */
export function parseDate(s: string): string | null {
  if (!s) return null;
  s = s.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); }
  return null;
}
