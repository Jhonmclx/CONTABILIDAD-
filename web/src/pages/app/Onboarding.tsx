import { useState } from 'react';
import { LiveBackground } from '../../components/LiveBackground';
import { Alert, Button, Field, Input } from '../../components/ui';
import { db } from '../../lib/sb';
import { useSession } from '../../lib/session';
import { navigate } from '../../lib/router';

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function Onboarding() {
  const s = useSession();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async (e: any) => {
    e.preventDefault(); setErr(null);
    const sl = slug || slugify(name);
    if (name.trim().length < 2) return setErr('Escriba el nombre de la firma.');
    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(sl)) return setErr('El identificador debe tener entre 3 y 60 caracteres: letras minúsculas, números y guiones.');
    setBusy(true);
    const r = await db.rpc<string>('create_organization', { p_name: name.trim(), p_slug: sl });
    setBusy(false);
    if (r.error) return setErr(/duplicate|duplicado/i.test(r.error.message) ? 'Ese identificador ya está en uso. Elija otro.' : r.error.message);
    s.setOrg(r.data!); await s.reload(); navigate('/app/configuracion?tab=marca');
  };

  return (
    <>
      <LiveBackground variant="vivid" />
      <main className="auth-wrap">
        <form className="card glass auth-card" style={{ width: 'min(560px,100%)' }} onSubmit={create}>
          <span className="eyebrow">Bienvenido</span>
          <h2>Configure su firma</h2>
          <p className="muted small">Será el contador administrador. Luego podrá invitar auxiliares y clientes, y personalizar su identidad.</p>
          <Alert kind="info">Si lo invitaron como auxiliar o cliente, no cree una firma: pida a su contador que le envíe la invitación al correo <strong>{s.session?.user.email}</strong> y vuelva a ingresar.</Alert>
          <div className="col gap mt">
            {err && <Alert kind="bad">{err}</Alert>}
            <Field label="Nombre de la firma" hint="Puede cambiarlo después. Use el nombre provisional si aún no está definido.">
              <Input value={name} placeholder="CONTABILIDAD DIGITAL" onChange={(e: any) => { setName(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} />
            </Field>
            <Field label="Identificador público" hint={`Dirección de su tarjeta: ${location.origin}/f/${slug || 'identificador'}`}>
              <Input value={slug} onChange={(e: any) => { setTouched(true); setSlug(slugify(e.target.value)); }} />
            </Field>
            <Button type="submit" loading={busy}>Crear firma</Button>
          </div>
        </form>
      </main>
    </>
  );
}
