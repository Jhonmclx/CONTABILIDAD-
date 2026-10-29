import { qrcodegen } from './qrcodegen';

export function makeQr(text: string) {
  return qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.QUARTILE);
}

/** SVG vectorial apto para impresión. */
export function qrSvg(text: string, opts: { border?: number; dark?: string; light?: string } = {}) {
  const qr = makeQr(text); const b = opts.border ?? 4; const size = qr.size + b * 2;
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) parts.push(`M${x + b},${y + b}h1v1h-1z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${opts.light || '#ffffff'}"/><path d="${parts.join(' ')}" fill="${opts.dark || '#000000'}"/></svg>`;
}

/** PNG de alta resolución (por defecto 1200 px) para impresión. */
export async function qrPng(text: string, px = 1200, opts: { dark?: string; light?: string } = {}): Promise<Blob> {
  const qr = makeQr(text); const b = 4; const size = qr.size + b * 2; const scale = Math.max(1, Math.floor(px / size));
  const c = document.createElement('canvas'); c.width = c.height = size * scale;
  const g = c.getContext('2d')!;
  g.fillStyle = opts.light || '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = opts.dark || '#000000';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) g.fillRect((x + b) * scale, (y + b) * scale, scale, scale);
  return new Promise((res) => c.toBlob((bl) => res(bl!), 'image/png'));
}

export function qrDataUrl(text: string, opts: { dark?: string; light?: string } = {}) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSvg(text, opts));
}
