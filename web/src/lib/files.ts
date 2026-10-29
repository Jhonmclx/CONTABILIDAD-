// Validación de archivos antes de cargarlos (el servidor vuelve a validar tipo y tamaño).
export const MAX_BYTES = 25 * 1024 * 1024;

const TYPES: Record<string, { mime: string; magic?: (b: Uint8Array) => boolean }> = {
  pdf: { mime: 'application/pdf', magic: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  jpg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: 'image/png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  xml: { mime: 'application/xml', magic: (b) => isText(b) && /^\s*(﻿)?</.test(new TextDecoder().decode(b.slice(0, 64))) },
  csv: { mime: 'text/csv', magic: isText },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  zip: { mime: 'application/zip', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
};

function isText(b: Uint8Array) {
  const n = Math.min(b.length, 512);
  for (let i = 0; i < n; i++) if (b[i] === 0) return false;
  return true;
}

export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.xml,.csv,.xlsx,.zip';

export interface CheckedFile { file: File; ext: string; mime: string; sha256: string; error?: string }

export async function checkFile(file: File): Promise<CheckedFile> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const t = TYPES[ext];
  const base: CheckedFile = { file, ext, mime: t?.mime || file.type, sha256: '' };
  if (!t) return { ...base, error: 'Tipo de archivo no permitido' };
  if (file.size === 0) return { ...base, error: 'El archivo está vacío' };
  if (file.size > MAX_BYTES) return { ...base, error: 'Supera el tamaño máximo de 25 MB' };
  const buf = new Uint8Array(await file.arrayBuffer());
  if (t.magic && !t.magic(buf.slice(0, 512))) return { ...base, error: 'El contenido no corresponde a la extensión del archivo' };
  if (ext === 'xml' && /<!ENTITY/i.test(new TextDecoder().decode(buf.slice(0, 4096)))) return { ...base, error: 'XML con entidades externas no permitido' };
  return { ...base, sha256: await sha256(buf) };
}

export async function sha256(buf: Uint8Array | ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf as ArrayBuffer);
  return Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function safeName(name: string) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const base = name.slice(0, name.length - ext.length - 1).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'archivo';
  return `${base}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
