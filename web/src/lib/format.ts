const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : cop.format(Number(v)));
export const amount = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '' : num.format(Number(v)));

export function date(v: string | null | undefined) {
  if (!v) return '—';
  const d = v.length === 10 ? new Date(v + 'T12:00:00') : new Date(v);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function dateTime(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const currentPeriod = () => today().slice(0, 7);
export function monthBounds(period: string) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}
export function daysUntil(d: string | null | undefined) {
  if (!d) return null;
  return Math.round((new Date(d + 'T12:00:00').getTime() - new Date(today() + 'T12:00:00').getTime()) / 86400000);
}

/** Dígito de verificación del NIT (algoritmo DIAN módulo 11). */
export function nitDV(nit: string): string {
  const d = nit.replace(/\D/g, '');
  if (!d) return '';
  const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let s = 0;
  for (let i = 0; i < d.length; i++) s += Number(d[d.length - 1 - i]) * w[i];
  const r = s % 11;
  return String(r > 1 ? 11 - r : r);
}

export const labels: Record<string, string> = {
  admin: 'Contador administrador', auxiliar: 'Auxiliar contable', cliente: 'Cliente',
  borrador: 'Borrador', en_revision: 'En revisión', devuelto: 'Devuelto', contabilizado: 'Contabilizado', anulado: 'Anulado',
  pendiente: 'Pendiente', en_proceso: 'En proceso', devuelta: 'Devuelta para corrección', aprobada: 'Aprobada', completada: 'Completada', bloqueada: 'Bloqueada',
  recibido: 'Recibido', procesado: 'Procesado', requiere_revision: 'Requiere revisión', error: 'Error', archivado: 'Archivado',
  procesando: 'Procesando', extraido: 'Extraído', revisado: 'Revisado', aprobado: 'Aprobado', pendiente_proveedor: 'Proveedor OCR pendiente',
  sin_conciliar: 'Sin conciliar', propuesta: 'Propuesta', conciliada: 'Conciliada', sin_correspondencia: 'Sin correspondencia',
  parcial: 'Pago parcial', pagada: 'Pagada', anulada: 'Anulada', documentado: 'Documentado', por_verificar: 'Por verificar',
  en_preparacion: 'En preparación', presentada: 'Presentada', vencida: 'Vencida', no_aplica: 'No aplica',
  sin_verificar: 'Sin verificar', verificada: 'Verificada', obsoleta: 'Obsoleta',
  abierto: 'Abierto', cerrado: 'Cerrado', activo: 'Activo', inactivo: 'Inactivo', prospecto: 'Prospecto',
  al_dia: 'Al día', pendiente_documentos: 'Pendiente de documentos', con_alertas: 'Con alertas',
  baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente',
  factura_compra: 'Factura de compra', factura_venta: 'Factura de venta', extracto_bancario: 'Extracto bancario', nomina: 'Nómina',
  soporte: 'Soporte', declaracion: 'Declaración', certificado: 'Certificado', entregable: 'Entregable', otro: 'Otro',
  natural: 'Persona natural', juridica: 'Persona jurídica', cobrar: 'Por cobrar', pagar: 'Por pagar',
  activa: 'Activa', suspendida: 'Suspendida', en_cola: 'En cola', bloqueado: 'Bloqueado', enviado: 'Enviado', limitado: 'Limitado',
  nueva: 'Nueva', contactada: 'Contactada', agendada: 'Agendada', descartada: 'Descartada',
  recibida: 'Recibida', en_tramite: 'En trámite', respondida: 'Respondida', rechazada: 'Rechazada', aceptada: 'Aceptada',
  exacta: 'Exacta', aproximada: 'Aproximada', manual: 'Manual',
};
export const L = (k: string | null | undefined) => (k ? labels[k] || k.replace(/_/g, ' ') : '—');

export function tone(status: string | null | undefined): 'ok' | 'warn' | 'bad' | 'info' | 'muted' {
  switch (status) {
    case 'contabilizado': case 'aprobada': case 'aprobado': case 'completada': case 'conciliada': case 'pagada': case 'presentada':
    case 'procesado': case 'verificada': case 'al_dia': case 'activo': case 'activa': case 'revisado': case 'extraido': case 'documentado': case 'enviado': case 'aceptada':
      return 'ok';
    case 'en_revision': case 'propuesta': case 'parcial': case 'en_proceso': case 'en_preparacion': case 'requiere_revision': case 'por_verificar':
    case 'sin_verificar': case 'pendiente_proveedor': case 'pendiente_documentos': case 'alta': case 'procesando':
      return 'warn';
    case 'devuelto': case 'devuelta': case 'error': case 'vencida': case 'bloqueada': case 'urgente': case 'con_alertas': case 'suspendida': case 'rechazada': case 'bloqueado':
      return 'bad';
    case 'borrador': case 'archivado': case 'anulado': case 'anulada': case 'no_aplica': case 'inactivo': case 'baja': case 'obsoleta':
      return 'muted';
    default: return 'info';
  }
}
