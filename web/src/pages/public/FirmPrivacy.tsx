import { useEffect, useState } from 'react';
import { LiveBackground } from '../../components/LiveBackground';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '../../components/ui';
import { db } from '../../lib/sb';
import { Link } from '../../lib/router';
import { date } from '../../lib/format';

const TYPES = [
  { value: 'consulta', label: 'Consultar mis datos' }, { value: 'actualizacion', label: 'Actualizar mis datos' },
  { value: 'rectificacion', label: 'Rectificar datos inexactos' }, { value: 'supresion', label: 'Suprimir mis datos' },
  { value: 'revocatoria', label: 'Revocar la autorización' }, { value: 'prueba_autorizacion', label: 'Solicitar prueba de la autorización' },
];

export function FirmPrivacy({ slug }: { slug: string }) {
  const [policy, setPolicy] = useState<any>(undefined);
  const [v, setV] = useState({ name: '', email: '', id: '', type: 'consulta', desc: '' });
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { db.rpc('get_privacy_policy', { p_slug: slug }).then((r) => setPolicy(r.data)); }, [slug]);
  const send = async () => {
    setErr(null); setMsg(null);
    if (v.name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(v.email) || v.desc.trim().length < 10) return setErr('Complete nombre, correo válido y una descripción (mínimo 10 caracteres).');
    setBusy(true);
    const r = await db.rpc('submit_data_request', { p_slug: slug, p_name: v.name, p_email: v.email, p_id_number: v.id, p_type: v.type, p_description: v.desc });
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    setMsg('Solicitud radicada. La firma responsable le responderá al correo indicado dentro de los plazos legales.');
    setV({ name: '', email: '', id: '', type: 'consulta', desc: '' });
  };
  return (
    <>
      <LiveBackground variant="subtle" />
      <main className="vcard-wrap">
        <div className="col gap" style={{ width: 'min(760px,100%)' }}>
          <Link to={`/f/${slug}`} className="btn btn-ghost btn-s" >← Volver a la tarjeta</Link>
          <Card title="Política de tratamiento de datos personales" glass>
            {policy === undefined ? <p className="muted">Cargando…</p> : policy ? <>
              <p className="dim small">Versión {policy.version} · publicada {date(policy.published_at)}</p>
              <div className="mt" style={{ whiteSpace: 'pre-wrap' }}>{policy.content}</div>
            </> : <Alert kind="info">La firma aún no ha publicado su política. Puede radicar su solicitud con el formulario.</Alert>}
          </Card>
          <Card title="Ejercer mis derechos como titular" subtitle="Consultas, actualizaciones, rectificaciones, supresión o revocatoria de la autorización." glass>
            <div className="col gap">
              {err && <Alert kind="bad">{err}</Alert>}{msg && <Alert kind="ok">{msg}</Alert>}
              <div className="form-grid">
                <Field label="Nombre completo"><Input value={v.name} onChange={(e: any) => setV({ ...v, name: e.target.value })} /></Field>
                <Field label="Correo"><Input type="email" value={v.email} onChange={(e: any) => setV({ ...v, email: e.target.value })} /></Field>
                <Field label="Documento de identidad (opcional)"><Input value={v.id} onChange={(e: any) => setV({ ...v, id: e.target.value })} /></Field>
                <Field label="Tipo de solicitud"><Select options={TYPES} value={v.type} onChange={(e: any) => setV({ ...v, type: e.target.value })} /></Field>
                <Field label="Descripción" className="full"><Textarea value={v.desc} maxLength={2000} onChange={(e: any) => setV({ ...v, desc: e.target.value })} /></Field>
              </div>
              <div><Button loading={busy} onClick={send}>Radicar solicitud</Button></div>
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
