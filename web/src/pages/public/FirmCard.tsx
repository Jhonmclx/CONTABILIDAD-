import { useEffect, useState } from 'react';
import { LiveBackground } from '../../components/LiveBackground';
import { Alert, Button, Field, Icon, Input, Loading, Modal, Textarea, useToast } from '../../components/ui';
import { db } from '../../lib/sb';
import { useQueryParam, Link } from '../../lib/router';
import { vcard, waLink } from '../../lib/export';
import { downloadBlob } from '../../lib/files';

export interface PublicFirm {
  org_id: string; slug: string; commercial_name: string; accountant_name?: string; headline?: string; description?: string;
  services: string[]; phone?: string; whatsapp?: string; email?: string; address?: string; map_url?: string; hours?: string;
  socials: Record<string, string>; logo_url?: string; photo_url?: string; color_primary: string; color_secondary: string; color_accent: string;
}

const SOCIAL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X', tiktok: 'TikTok', youtube: 'YouTube', web: 'Sitio web' };
const safeUrl = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);

export function CardView({ f, preview }: { f: PublicFirm; preview?: boolean }) {
  const [appt, setAppt] = useState(false);
  const initials = (f.accountant_name || f.commercial_name).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const url = `${location.origin}/f/${f.slug}`;
  const saveContact = () => {
    const vc = vcard({ name: f.accountant_name || f.commercial_name, org: f.commercial_name, title: f.headline, phone: f.phone, whatsapp: f.whatsapp, email: f.email, url, address: f.address });
    downloadBlob(new Blob([vc], { type: 'text/vcard;charset=utf-8' }), `${f.slug}.vcf`);
  };
  const style = { '--brand': f.color_primary, '--gold': f.color_accent } as any;
  return (
    <div className="vcard card glass" style={style}>
      <div className="vcard-cover" style={{ background: `radial-gradient(120% 140% at 0% 0%, ${f.color_primary} 0%, transparent 55%), radial-gradient(100% 140% at 100% 0%, ${f.color_accent}88, transparent 60%), linear-gradient(135deg, ${f.color_secondary}, #0f2a4a)` }}>
        {f.logo_url && <img src={f.logo_url} alt="" style={{ position: 'absolute', left: 16, top: 14, height: 34, borderRadius: 8 }} />}
      </div>
      <div className="vcard-avatar">{f.photo_url ? <img src={f.photo_url} alt={f.accountant_name || ''} /> : <span>{initials}</span>}</div>
      <div className="card-b center">
        <h2 style={{ fontSize: 24 }}>{f.accountant_name || f.commercial_name}</h2>
        {f.accountant_name && <div className="gold small mt-s" style={{ letterSpacing: '.12em', fontWeight: 700 }}>{f.commercial_name.toUpperCase()}</div>}
        {f.headline && <p className="muted mt-s">{f.headline}</p>}

        <div className="vcard-actions mt">
          {f.whatsapp && <a className="vcard-action" href={waLink(f.whatsapp, 'Hola, quisiera información sobre sus servicios contables.')} target="_blank" rel="noopener noreferrer"><Icon name="wa" size={22} />WhatsApp</a>}
          {f.phone && <a className="vcard-action" href={`tel:${f.phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" size={22} />Llamar</a>}
          {f.email && <a className="vcard-action" href={`mailto:${f.email}`}><Icon name="mail" size={22} />Correo</a>}
          <button className="vcard-action" onClick={saveContact}><Icon name="user" size={22} />Guardar contacto</button>
          <button className="vcard-action" onClick={() => !preview && setAppt(true)}><Icon name="calendar" size={22} />Solicitar cita</button>
          <a className="vcard-action" href="/ingresar?cliente=1"><Icon name="lock" size={22} />Portal clientes</a>
        </div>

        {f.description && <p className="muted mt-l" style={{ textAlign: 'left', whiteSpace: 'pre-line' }}>{f.description}</p>}
        {f.services?.length > 0 && <div className="mt-l" style={{ textAlign: 'left' }}>
          <h4>Servicios</h4>
          <div className="row gap-s wrap mt-s">{f.services.map((s) => <span key={s} className="chip">{s}</span>)}</div>
        </div>}
        <div className="col gap-s mt-l" style={{ textAlign: 'left' }}>
          {f.hours && <div className="row gap-s muted small"><Icon name="clock" size={16} /><span style={{ whiteSpace: 'pre-line' }}>{f.hours}</span></div>}
          {f.address && <div className="row gap-s muted small"><Icon name="pin" size={16} /><span>{f.address}{safeUrl(f.map_url) && <> · <a href={safeUrl(f.map_url)} target="_blank" rel="noopener noreferrer">Ver mapa</a></>}</span></div>}
        </div>
        {Object.keys(f.socials || {}).length > 0 && <div className="row gap-s wrap mt" style={{ justifyContent: 'center' }}>
          {Object.entries(f.socials).filter(([, v]) => safeUrl(v)).map(([k, v]) => <a key={k} className="chip" href={safeUrl(v)} target="_blank" rel="noopener noreferrer">{SOCIAL[k] || k}</a>)}
        </div>}
        <p className="dim xs mt-l"><Link to={`/f/${f.slug}/privacidad`}>Política de tratamiento de datos</Link></p>
      </div>
      {!preview && <AppointmentModal open={appt} onClose={() => setAppt(false)} slug={f.slug} />}
    </div>
  );
}

function AppointmentModal({ open, onClose, slug }: any) {
  const ref = useQueryParam('ref');
  const toast = useToast();
  const [v, setV] = useState({ name: '', phone: '', email: '', message: '', date: '', consent: false });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setErr(null);
    if (v.name.trim().length < 2) return setErr('Escriba su nombre.');
    if (!v.phone.trim() && !v.email.trim()) return setErr('Indique un teléfono o un correo para contactarlo.');
    if (!v.consent) return setErr('Debe autorizar el tratamiento de sus datos para que la firma lo contacte.');
    setBusy(true);
    const r = await db.rpc('request_appointment', { p_slug: slug, p_name: v.name, p_phone: v.phone, p_email: v.email, p_message: v.message, p_date: v.date || null, p_ref: ref, p_consent: v.consent });
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    toast('Solicitud enviada. La firma se comunicará con usted.'); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Solicitar una cita" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={send}>Enviar solicitud</Button></>}>
      {err && <Alert kind="bad">{err}</Alert>}
      <Field label="Nombre"><Input value={v.name} onChange={(e: any) => setV({ ...v, name: e.target.value })} maxLength={120} /></Field>
      <div className="form-grid">
        <Field label="Teléfono"><Input type="tel" inputMode="tel" value={v.phone} onChange={(e: any) => setV({ ...v, phone: e.target.value })} maxLength={30} /></Field>
        <Field label="Correo"><Input type="email" value={v.email} onChange={(e: any) => setV({ ...v, email: e.target.value })} /></Field>
      </div>
      <Field label="Fecha preferida (opcional)"><Input type="date" value={v.date} onChange={(e: any) => setV({ ...v, date: e.target.value })} /></Field>
      <Field label="¿En qué podemos ayudarle?"><Textarea value={v.message} onChange={(e: any) => setV({ ...v, message: e.target.value })} maxLength={1000} /></Field>
      <label className="check"><input type="checkbox" checked={v.consent} onChange={(e: any) => setV({ ...v, consent: e.target.checked })} />
        <span>Autorizo a la firma a tratar estos datos únicamente para responder mi solicitud (Ley 1581 de 2012).</span></label>
    </Modal>
  );
}

export function FirmCard({ slug }: { slug: string }) {
  const ref = useQueryParam('ref');
  const [f, setF] = useState<PublicFirm | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');
  useEffect(() => {
    db.rpc<PublicFirm>('get_public_firm', { p_slug: slug }).then((r) => {
      if (r.data) { setF(r.data); setState('ok'); document.title = r.data.commercial_name; db.rpc('track_card_visit', { p_slug: slug, p_ref: ref }); }
      else setState('missing');
    });
  }, [slug]);
  return (
    <>
      <LiveBackground variant="vivid" />
      <main className="vcard-wrap">
        {state === 'loading' && <Loading />}
        {state === 'missing' && <div className="card glass auth-card center"><h2>Tarjeta no disponible</h2><p className="muted mt-s">Esta tarjeta no existe o aún no ha sido publicada.</p></div>}
        {f && <CardView f={f} />}
      </main>
    </>
  );
}
