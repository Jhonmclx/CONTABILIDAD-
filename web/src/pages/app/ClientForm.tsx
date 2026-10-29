import { useEffect, useState } from 'react';
import { z } from '../../lib/validate';
import { Alert, Button, Field, Input, Modal, Select } from '../../components/ui';
import { db } from '../../lib/sb';
import { nitDV } from '../../lib/format';
import { useSession } from '../../lib/session';

export const clientSchema = z.object({
  person_type: z.enum(['natural', 'juridica']),
  name: z.string().min(2, 'Nombre o razón social obligatorio').max(200),
  id_type: z.enum(['NIT', 'CC', 'CE', 'PAS', 'PPT', 'OTRO']),
  id_number: z.string().regex(/^[0-9A-Za-z-]{3,20}$/, 'Identificación inválida (3 a 20 caracteres, sin espacios)'),
  dv: z.string().regex(/^[0-9]?$/, 'Dígito inválido').optional(),
  email: z.string().regex(/^$|^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Correo inválido').optional(),
  phone: z.string().max(30).optional(), address: z.string().max(200).optional(), city: z.string().max(80).optional(),
  economic_activity: z.string().max(10).optional(), tax_regime: z.string().max(80).optional(),
  fiscal_responsibilities: z.string().max(200).optional(),
  accounting_period: z.enum(['mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'semestral', 'anual']),
  status: z.enum(['prospecto', 'activo', 'inactivo']),
  tags: z.string().max(200).optional(),
});

const empty = { person_type: 'juridica', name: '', id_type: 'NIT', id_number: '', dv: '', email: '', phone: '', address: '', city: '', economic_activity: '', tax_regime: '', fiscal_responsibilities: '', accounting_period: 'mensual', status: 'activo', tags: '' };

export function toClientRow(v: any) {
  const list = (s: string) => (s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  return {
    person_type: v.person_type, name: v.name.trim(), id_type: v.id_type, id_number: v.id_number.trim(), dv: v.dv || null,
    email: v.email?.trim() || null, phone: v.phone?.trim() || null, address: v.address?.trim() || null, city: v.city?.trim() || null,
    economic_activity: v.economic_activity?.trim() || null, tax_regime: v.tax_regime?.trim() || null,
    fiscal_responsibilities: list(v.fiscal_responsibilities), accounting_period: v.accounting_period, status: v.status, tags: list(v.tags),
  };
}

export function ClientForm({ open, onClose, onSaved, client }: { open: boolean; onClose: () => void; onSaved: (id: string) => void; client?: any }) {
  const s = useSession();
  const [v, setV] = useState<any>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({}); setErr(null);
    setV(client ? { ...empty, ...client, fiscal_responsibilities: (client.fiscal_responsibilities || []).join(', '), tags: (client.tags || []).join(', '), dv: client.dv || '', email: client.email || '' } : empty);
  }, [open, client?.id]);
  const set = (k: string) => (e: any) => {
    const val = e.target.value; const nv = { ...v, [k]: val };
    if ((k === 'id_number' || k === 'id_type') && nv.id_type === 'NIT') nv.dv = nitDV(nv.id_number);
    setV(nv);
  };
  const save = async () => {
    const r = clientSchema.safeParse(v);
    if (!r.success) { setErrors(r.errors); return; }
    setErrors({}); setBusy(true); setErr(null);
    const row = toClientRow(v);
    let res; let id = client?.id;
    if (client) res = await db.from('clients').update(row).eq('id', client.id);
    else { id = crypto.randomUUID(); res = await db.from('clients').insert({ id, org_id: s.org!.id, ...row }); }
    setBusy(false);
    if (res.error) return setErr(res.error.message);
    onSaved(id);
  };
  return (
    <Modal open={open} onClose={onClose} wide title={client ? 'Editar cliente' : 'Nuevo cliente'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={save}>Guardar</Button></>}>
      {err && <Alert kind="bad">{err}</Alert>}
      <div className="form-grid">
        <Field label="Tipo de persona"><Select value={v.person_type} onChange={set('person_type')} options={['juridica', 'natural']} /></Field>
        <Field label="Estado"><Select value={v.status} onChange={set('status')} options={['activo', 'prospecto', 'inactivo']} /></Field>
        <Field label={v.person_type === 'juridica' ? 'Razón social' : 'Nombre completo'} error={errors.name} className="full"><Input value={v.name} onChange={set('name')} /></Field>
        <Field label="Tipo de identificación"><Select value={v.id_type} onChange={set('id_type')} options={[{ value: 'NIT', label: 'NIT' }, { value: 'CC', label: 'Cédula de ciudadanía' }, { value: 'CE', label: 'Cédula de extranjería' }, { value: 'PAS', label: 'Pasaporte' }, { value: 'PPT', label: 'PPT' }, { value: 'OTRO', label: 'Otro' }]} /></Field>
        <div className="row gap-s" style={{ alignItems: 'flex-start' }}>
          <Field label="Número" error={errors.id_number} className="grow"><Input value={v.id_number} onChange={set('id_number')} inputMode="numeric" /></Field>
          <Field label="DV" error={errors.dv}><Input value={v.dv} onChange={set('dv')} maxLength={1} style={{ width: 64 }} /></Field>
        </div>
        <Field label="Correo" error={errors.email}><Input type="email" value={v.email} onChange={set('email')} /></Field>
        <Field label="Teléfono"><Input type="tel" value={v.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Dirección"><Input value={v.address || ''} onChange={set('address')} /></Field>
        <Field label="Ciudad / municipio"><Input value={v.city || ''} onChange={set('city')} /></Field>
        <Field label="Actividad económica (CIIU)"><Input value={v.economic_activity || ''} onChange={set('economic_activity')} /></Field>
        <Field label="Régimen tributario"><Input value={v.tax_regime || ''} onChange={set('tax_regime')} placeholder="Según RUT" /></Field>
        <Field label="Responsabilidades fiscales (códigos RUT)" hint="Separadas por coma, tal como aparecen en el RUT. Ej.: 05, 07, 48"><Input value={v.fiscal_responsibilities} onChange={set('fiscal_responsibilities')} /></Field>
        <Field label="Periodicidad contable"><Select value={v.accounting_period} onChange={set('accounting_period')} options={['mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'semestral', 'anual']} /></Field>
        <Field label="Etiquetas" hint="Para segmentar. Separadas por coma." className="full"><Input value={v.tags} onChange={set('tags')} /></Field>
      </div>
    </Modal>
  );
}
