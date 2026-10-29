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

const SERVICE_ICON = (s: string) => /renta|declar/i.test(s) ? 'file' : /iva|retenci|impuest|tribut|exógena|exogena/i.test(s) ? 'shield' : /nómina|nomina|seguridad social/i.test(s) ? 'users' : /asesor/i.test(s) ? 'spark' : /audit|revis/i.test(s) ? 'checks' : 'book';

export function CardView({ f, preview }: { f: PublicFirm; preview?: boolean }) {
  const [appt, setAppt] = useState(false);
  const [copied, setCopied] = useState(false);
  const person = f.accountant_name || f.commercial_name;
  const initials = person.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const url = `${location.origin}/f/${f.slug}`;
  const saveContact = () => {
    const vc = vcard({ name: person, org: f.commercial_name, title: f.headline, phone: f.phone, whatsapp: f.whatsapp, email: f.email, url, address: f.address });
    downloadBlob(new Blob([vc], { type: 'text/vcard;charset=utf-8' }), `${f.slug}.vcf`);
  };
  const share = async () => {
    const data = { title: person, text: `${person} · ${f.commercial_name}`, url };
    try { if ((navigator as any).share) await (navigator as any).share(data); else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } } catch { /* cancelado */ }
  };
  const style = { '--brand': f.color_primary, '--gold': f.color_accent, '--bg2': f.color_secondary } as any;
  const socials = Object.entries(f.socials || {}).filter(([, v]) => safeUrl(v));
  return (
    <article className="xcard" style={style}>
      <div className="xcard-border" aria-hidden />
      <div className="xcard-in">
        <header className="xcard-hero">
          <div className="xcard-hero-bg"><div className="xcard-orb o1" /><div className="xcard-orb o2" /><div className="xcard-lines" /></div>
          <div className="xcard-top">
            <span className="xcard-brand">{f.logo_url ? <img src={f.logo_url} alt="" /> : <span className="xcard-mark">{f.commercial_name.slice(0, 2)}</span>}{f.commercial_name}</span>
            <button className="xcard-share" onClick={share} aria-label="Compartir tarjeta"><Icon name="send" size={16} />{copied ? 'Copiado' : 'Compartir'}</button>
          </div>
          <div className="xcard-avatar-wrap">
            <div className="xcard-ring" aria-hidden />
            <div className="xcard-avatar">{f.photo_url ? <img src={f.photo_url} alt={person} /> : <span>{initials}</span>}</div>
            <span className="xcard-verified" title="Contador público"><Icon name="check" size={14} /></span>
          </div>
        </header>

        <div className="xcard-body">
          <h1 className="xcard-name">{person}</h1>
          {f.headline && <p className="xcard-role">{f.headline}</p>}
          {f.accountant_name && <p className="xcard-firm">{f.commercial_name}</p>}

          {f.whatsapp ? (
            <a className="xcard-cta" href={waLink(f.whatsapp, 'Hola, quisiera información sobre sus servicios contables.')} target="_blank" rel="noopener noreferrer">
              <Icon name="wa" size={22} /><span><strong>Escríbeme por WhatsApp</strong><small>Respuesta rápida</small></span><Icon name="chevron" size={18} />
            </a>
          ) : preview ? <p className="xcard-hint">Agregue el número de WhatsApp en "Marca e identidad" para mostrar el botón principal.</p> : null}

          <div className="xcard-actions">
            {f.phone && <a className="xcard-act" href={`tel:${f.phone.replace(/[^\d+]/g, '')}`}><span><Icon name="phone" size={20} /></span>Llamar</a>}
            {f.email && <a className="xcard-act" href={`mailto:${f.email}`}><span><Icon name="mail" size={20} /></span>Correo</a>}
            <button className="xcard-act" onClick={saveContact}><span><Icon name="user" size={20} /></span>Guardar contacto</button>
            <button className="xcard-act" onClick={() => !preview && setAppt(true)}><span><Icon name="calendar" size={20} /></span>Agendar cita</button>
          </div>

          {f.description && <section className="xcard-sec"><h2>Sobre mí</h2><p>{f.description}</p></section>}

          {f.services?.length > 0 && <section className="xcard-sec">
            <h2>Servicios</h2>
            <div className="xcard-services">{f.services.map((s, i) => <div key={s} className="xcard-svc" style={{ animationDelay: `${0.08 * i + 0.3}s` }}><span><Icon name={SERVICE_ICON(s)} size={18} /></span>{s}</div>)}</div>
          </section>}

          {(f.hours || f.address) && <section className="xcard-sec xcard-info">
            {f.hours && <div><Icon name="clock" size={18} /><span>{f.hours}</span></div>}
            {f.address && <div><Icon name="pin" size={18} /><span>{f.address}{safeUrl(f.map_url) && <> · <a href={safeUrl(f.map_url)} target="_blank" rel="noopener noreferrer">Cómo llegar</a></>}</span></div>}
          </section>}

          {socials.length > 0 && <div className="xcard-socials">{socials.map(([k, v]) => <a key={k} href={safeUrl(v)} target="_blank" rel="noopener noreferrer">{SOCIAL[k] || k}</a>)}</div>}

          <a className="xcard-portal" href="/ingresar?cliente=1"><Icon name="lock" size={18} /><span><strong>Portal de clientes</strong><small>Envíe documentos y consulte sus entregables</small></span><Icon name="chevron" size={18} /></a>

          <footer className="xcard-foot"><Link to={`/f/${f.slug}/privacidad`}>Política de tratamiento de datos</Link></footer>
        </div>
      </div>
      {!preview && <AppointmentModal open={appt} onClose={() => setAppt(false)} slug={f.slug} />}
    </article>
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
        {f && <p className="dim xs mt">Tarjeta digital · {f.commercial_name}</p>}
      </main>
    </>
  );
}
