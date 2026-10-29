import { useState } from 'react';
import { LiveBackground } from '../../components/LiveBackground';
import { Alert, Button, Field, Input } from '../../components/ui';
import { Link, navigate, useQueryParam } from '../../lib/router';
import { auth, db } from '../../lib/sb';
import { CONFIG } from '../../lib/config';

type Mode = 'ingresar' | 'registro' | 'recuperar' | 'nueva-clave';

const strong = (p: string) => p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);

export function AuthPage({ mode }: { mode: Mode }) {
  const next = useQueryParam('next');
  const urlError = useQueryParam('error');
  const isClient = useQueryParam('cliente');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(urlError);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: any) => {
    e.preventDefault(); setErr(null); setMsg(null); setBusy(true);
    try {
      if (mode === 'ingresar') {
        const login = email.trim().includes('@') ? email.trim() : `${email.trim().toLowerCase()}@usuarios.contabilidad.local`;
        await auth.signIn(login, pw);
        db.rpc('log_event', { p_org: null, p_action: 'inicio_sesion', p_entity: 'auth' });
        const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
        navigate(safe, { replace: true });
      } else if (mode === 'registro') {
        if (!strong(pw)) throw new Error('La contraseña debe tener mínimo 10 caracteres, con mayúsculas, minúsculas y números.');
        if (pw !== pw2) throw new Error('Las contraseñas no coinciden.');
        if (!accept) throw new Error('Debe aceptar el tratamiento de datos personales.');
        const r = await auth.signUp(email.trim(), pw, name.trim(), `${CONFIG.siteUrl}/app`);
        if (r.needsConfirmation) setMsg('Le enviamos un correo para confirmar su cuenta. Ábralo desde este dispositivo para continuar.');
        else navigate('/app', { replace: true });
      } else if (mode === 'recuperar') {
        await auth.recover(email.trim(), `${CONFIG.siteUrl}/nueva-clave`);
        setMsg('Si el correo está registrado, recibirá un enlace para crear una nueva contraseña.');
      } else {
        if (!auth.session) throw new Error('El enlace de recuperación expiró. Solicite uno nuevo.');
        if (!strong(pw)) throw new Error('La contraseña debe tener mínimo 10 caracteres, con mayúsculas, minúsculas y números.');
        if (pw !== pw2) throw new Error('Las contraseñas no coinciden.');
        await auth.updatePassword(pw);
        db.rpc('log_event', { p_org: null, p_action: 'recuperacion_contrasena', p_entity: 'auth' });
        setMsg('Contraseña actualizada.'); setTimeout(() => navigate('/app', { replace: true }), 900);
      }
    } catch (e: any) { setErr(e?.message || 'No fue posible completar la operación.'); }
    finally { setBusy(false); }
  };

  const titles: Record<Mode, [string, string]> = {
    ingresar: [isClient ? 'Portal de clientes' : 'Bienvenido de nuevo', 'Ingrese con su correo (o usuario) y contraseña.'],
    registro: ['Cree su cuenta', 'Para contadores que administran una firma. Si es auxiliar o cliente, use el correo al que lo invitaron.'],
    recuperar: ['Recuperar contraseña', 'Le enviaremos un enlace seguro a su correo.'],
    'nueva-clave': ['Nueva contraseña', 'Defina una contraseña segura para su cuenta.'],
  };

  return (
    <>
      <LiveBackground variant="vivid" />
      <main className="auth-wrap">
        <form className="card glass auth-card" onSubmit={submit} noValidate>
          <a className="logo" href="/"><span className="logo-mark">CD</span>{CONFIG.defaultBrand}</a>
          <h2>{titles[mode][0]}</h2>
          <p className="muted small">{titles[mode][1]}</p>
          <div className="col gap mt">
            {err && <Alert kind="bad">{err}</Alert>}
            {msg && <Alert kind="ok">{msg}</Alert>}
            {mode === 'registro' && <Field label="Nombre completo"><Input value={name} onChange={(e: any) => setName(e.target.value)} autoComplete="name" required /></Field>}
            {mode !== 'nueva-clave' && <Field label={mode === 'ingresar' ? 'Correo o usuario' : 'Correo electrónico'}><Input type={mode === 'ingresar' ? 'text' : 'email'} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e: any) => setEmail(e.target.value)} autoComplete="email" required /></Field>}
            {mode !== 'recuperar' && <Field label="Contraseña" hint={mode !== 'ingresar' ? 'Mínimo 10 caracteres con mayúsculas, minúsculas y números.' : undefined}>
              <Input type={show ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={pw} onChange={(e: any) => setPw(e.target.value)} autoComplete={mode === 'ingresar' ? 'current-password' : 'new-password'} required />
            </Field>}
            {mode !== 'recuperar' && <label className="check"><input type="checkbox" checked={show} onChange={(e: any) => setShow(e.target.checked)} /><span>Mostrar contraseña</span></label>}
            {(mode === 'registro' || mode === 'nueva-clave') && <Field label="Confirmar contraseña"><Input type="password" value={pw2} onChange={(e: any) => setPw2(e.target.value)} autoComplete="new-password" /></Field>}
            {mode === 'registro' && <label className="check"><input type="checkbox" checked={accept} onChange={(e: any) => setAccept(e.target.checked)} />
              <span>Autorizo el tratamiento de mis datos personales para crear y administrar mi cuenta, conforme a la Ley 1581 de 2012.</span></label>}
            <Button type="submit" loading={busy} className="mt-s">{mode === 'ingresar' ? 'Ingresar' : mode === 'registro' ? 'Crear cuenta' : mode === 'recuperar' ? 'Enviar enlace' : 'Guardar contraseña'}</Button>
          </div>
          <div className="row between wrap gap-s mt small">
            {mode === 'ingresar' && <><Link to="/recuperar">¿Olvidó su contraseña?</Link><Link to="/registro">Crear cuenta</Link></>}
            {mode === 'registro' && <Link to="/ingresar">Ya tengo cuenta</Link>}
            {mode === 'recuperar' && <Link to="/ingresar">Volver a ingresar</Link>}
          </div>
        </form>
      </main>
    </>
  );
}
