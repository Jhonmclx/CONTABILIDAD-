import { createContext, useContext, useEffect, useState } from 'react';
import { L, tone } from '../lib/format';

export function cx(...c: any[]) { return c.filter(Boolean).join(' '); }

export function Button({ children, variant = 'primary', size, loading, icon, className, ...p }: any) {
  return (
    <button className={cx('btn', `btn-${variant}`, size && `btn-${size}`, loading && 'is-loading', className)} disabled={loading || p.disabled} {...p}>
      {loading ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Card({ title, actions, children, className, glass, subtitle, pad = true }: any) {
  return (
    <section className={cx('card', glass && 'glass', className)}>
      {(title || actions) && (
        <header className="card-h">
          <div>{title && <h3>{title}</h3>}{subtitle && <p className="muted small">{subtitle}</p>}</div>
          {actions && <div className="row gap-s wrap">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-b' : ''}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className }: any) {
  return (
    <label className={cx('field', error && 'has-error', className)}>
      <span className="field-l">{label}</span>
      {children}
      {error ? <span className="field-e">{error}</span> : hint ? <span className="field-h">{hint}</span> : null}
    </label>
  );
}

export const Input = (p: any) => <input className="input" {...p} />;
export const Textarea = (p: any) => <textarea className="input" rows={3} {...p} />;
export function Select({ options, placeholder, ...p }: any) {
  return (
    <select className="input" {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o: any) => (typeof o === 'string' ? <option key={o} value={o}>{L(o)}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

export function Badge({ children, status, t }: { children?: any; status?: string | null; t?: string }) {
  return <span className={cx('badge', `b-${t || tone(status)}`)}>{children ?? L(status)}</span>;
}

export function Empty({ title, children, icon = 'inbox', action }: any) {
  return (
    <div className="empty">
      <div className="empty-i"><Icon name={icon} size={28} /></div>
      <h4>{title}</h4>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Cargando…' }) {
  return <div className="loading" role="status"><span className="spinner" /> {label}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return <div className="alert alert-bad" role="alert"><Icon name="alert" /> <span>{error}</span>{onRetry && <Button variant="ghost" size="s" onClick={onRetry}>Reintentar</Button>}</div>;
}

export function Alert({ kind = 'info', children }: any) {
  return <div className={`alert alert-${kind}`}><Icon name={kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info'} /> <div>{children}</div></div>;
}

export function Modal({ open, title, onClose, children, footer, wide }: any) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', fn); document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', fn); document.body.classList.remove('modal-open'); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-bg" onMouseDown={(e: any) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-h"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button></header>
        <div className="modal-b">{children}</div>
        {footer && <footer className="modal-f">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; count?: number }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={cx('tab', value === t.id && 'on')} onClick={() => onChange(t.id)}>
          {t.label}{t.count !== undefined && <span className="tab-c">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, icon, t }: any) {
  return (
    <div className={cx('stat', t && `stat-${t}`)}>
      <div className="stat-top"><span className="muted small">{label}</span>{icon && <Icon name={icon} />}</div>
      <div className="stat-v">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

/** Tabla responsiva: en móvil cada fila se muestra como tarjeta usando data-label. */
export function Table({ columns, rows, empty, onRow, rowKey = 'id', dense }: {
  columns: { key: string; label: string; render?: (r: any) => any; num?: boolean; className?: string }[];
  rows: any[]; empty?: any; onRow?: (r: any) => void; rowKey?: string; dense?: boolean;
}) {
  if (!rows.length) return empty || <Empty title="Sin registros" />;
  return (
    <div className="table-wrap">
      <table className={cx('table', dense && 'dense', onRow && 'clickable')}>
        <thead><tr>{columns.map((c) => <th key={c.key} className={cx(c.num && 'num', c.className)}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined}
              onKeyDown={onRow ? (e: any) => e.key === 'Enter' && onRow(r) : undefined}>
              {columns.map((c) => <td key={c.key} data-label={c.label} className={cx(c.num && 'num', c.className)}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Notificaciones emergentes ----------
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'bad' | 'info') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: any) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = (msg: string, kind: any = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'bad' ? 7000 : 4000);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}><Icon name={t.kind === 'bad' ? 'alert' : 'check'} />{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Confirm({ open, title, children, onConfirm, onClose, confirmLabel = 'Confirmar', danger, needReason, reasonLabel = 'Motivo' }: any) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal open={open} title={title} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={needReason && reason.trim().length < 5}
        onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } }}>{confirmLabel}</Button>
    </>}>
      {children}
      {needReason && <Field label={reasonLabel} hint="Mínimo 5 caracteres. Queda registrado en la auditoría."><Textarea value={reason} onChange={(e: any) => setReason(e.target.value)} /></Field>}
    </Modal>
  );
}

// ---------- Iconos (SVG en línea, sin dependencias) ----------
const P: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  bank: 'M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18',
  wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01',
  calendar: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  check: 'M20 6 9 17l-5-5', checks: 'M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16',
  chart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  plus: 'M12 5v14M5 12h14', x: 'M18 6 6 18M6 6l12 12', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01', inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v3M14 20h3M20 20h1',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  pin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  wa: 'M3 21l1.65-4.95A8.5 8.5 0 1 1 8 19.5zM8.5 9.5c.5 2 2 3.5 4 4.5l1.2-1.2c.3-.3.7-.3 1 0l1.3 1c.3.3.3.7 0 1-.8.9-2 1.4-3.2.9-2.6-1-4.6-3-5.6-5.6-.5-1.2 0-2.4.9-3.2.3-.3.7-.3 1 0l1 1.3c.3.3.3.7 0 1z',
  menu: 'M3 6h18M3 12h18M3 18h18', chevron: 'M9 18l6-6-6-6', back: 'M15 18l-6-6 6-6', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  spark: 'M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z', link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6', edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13', send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z', building: 'M3 21h18M5 21V5l7-3v19M19 21V9l-7-3M9 9h.01M9 13h.01M9 17h.01',
};
export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={cx('ic', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] || P.info} />
    </svg>
  );
}
