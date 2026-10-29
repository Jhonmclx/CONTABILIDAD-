import { useState } from 'react';
import { Alert, Button, Field, Input, Modal, useToast } from './ui';
import { auth, db } from '../lib/sb';
import { useSession } from '../lib/session';

const valid = (p: string) => p.length >= 8 && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(p) && /\d/.test(p);

/** Cambio de contraseña: verifica la contraseña actual antes de guardar la nueva. */
export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession(); const toast = useToast();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const email = s.session?.user.email || '';
  const username = email.endsWith('@usuarios.contabilidad.local') ? email.split('@')[0] : null;
  const close = () => { setCur(''); setPw(''); setPw2(''); setErr(null); onClose(); };
  const save = async () => {
    setErr(null);
    if (!cur) return setErr('Escriba su contraseña actual.');
    if (!valid(pw)) return setErr('La nueva contraseña debe tener mínimo 8 caracteres, con letras y números.');
    if (pw !== pw2) return setErr('Las contraseñas nuevas no coinciden.');
    if (pw === cur) return setErr('La nueva contraseña debe ser diferente a la actual.');
    setBusy(true);
    try {
      await auth.signIn(email, cur);
    } catch { setBusy(false); return setErr('La contraseña actual no es correcta.'); }
    try {
      await auth.updatePassword(pw);
      await db.rpc('log_event', { p_org: null, p_action: 'recuperacion_contrasena', p_entity: 'auth', p_reason: 'Cambio de contraseña desde Mi cuenta' });
      toast('Contraseña actualizada'); close();
    } catch (e: any) { setErr(e?.message || 'No se pudo cambiar la contraseña.'); }
    finally { setBusy(false); }
  };
  const t = show ? 'text' : 'password';
  return (
    <Modal open={open} onClose={close} title="Mi cuenta" footer={<><Button variant="ghost" onClick={close}>Cancelar</Button><Button loading={busy} onClick={save}>Cambiar contraseña</Button></>}>
      <dl className="kv"><dt>Nombre</dt><dd>{s.profile?.full_name || '—'}</dd><dt>{username ? 'Usuario' : 'Correo'}</dt><dd className="mono">{username || email}</dd></dl>
      {err && <Alert kind="bad">{err}</Alert>}
      <Field label="Contraseña actual"><Input type={t} value={cur} onChange={(e: any) => setCur(e.target.value)} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" /></Field>
      <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números."><Input type={t} value={pw} onChange={(e: any) => setPw(e.target.value)} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" /></Field>
      <Field label="Confirmar nueva contraseña"><Input type={t} value={pw2} onChange={(e: any) => setPw2(e.target.value)} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" /></Field>
      <label className="check"><input type="checkbox" checked={show} onChange={(e: any) => setShow(e.target.checked)} /><span>Mostrar contraseñas</span></label>
    </Modal>
  );
}
