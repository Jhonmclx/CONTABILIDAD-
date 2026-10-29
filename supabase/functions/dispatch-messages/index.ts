// Despachador de la cola de mensajes (correo / WhatsApp).
// No envía nada si el canal no está habilitado y con credenciales configuradas.
// Control de frecuencia por organización, deduplicación (clave única en la cola), registro y reintentos.
// Se invoca con la clave de servicio (por ejemplo desde un trabajo programado); nunca desde el navegador.
const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY');          // proveedor de correo opcional
const MAIL_FROM = Deno.env.get('MAIL_FROM');                // remitente verificado
const MAX_ATTEMPTS = 3;

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await res.text(); if (!res.ok) throw new Error(t); return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if ((req.headers.get('Authorization') || '') !== `Bearer ${SERVICE}`) return new Response('No autorizado', { status: 401 });
  const settings = await rest('channel_settings?select=*');
  const ready = new Map<string, any>();
  for (const s of settings) {
    const configured = s.channel === 'email' ? !!(RESEND_KEY && MAIL_FROM) : false;   // WhatsApp: pendiente de proveedor autorizado
    if (configured !== s.provider_configured) await rest(`channel_settings?org_id=eq.${s.org_id}&channel=eq.${s.channel}`, { method: 'PATCH', body: JSON.stringify({ provider_configured: configured }) });
    if (s.enabled && configured) ready.set(`${s.org_id}:${s.channel}`, s);
  }
  const queue = await rest(`outbound_messages?status=eq.en_cola&attempts=lt.${MAX_ATTEMPTS}&order=created_at&limit=100&select=*`);
  const sent: Record<string, number> = {};
  let ok = 0, blocked = 0, failed = 0;
  for (const m of queue) {
    const key = `${m.org_id}:${m.channel}`; const s = ready.get(key);
    if (!s) { await rest(`outbound_messages?id=eq.${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'bloqueado', last_error: 'Canal deshabilitado o sin credenciales' }) }); blocked++; continue; }
    if (sent[key] === undefined) {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const c = await rest(`outbound_messages?org_id=eq.${m.org_id}&channel=eq.${m.channel}&status=eq.enviado&sent_at=gte.${since}&select=id`);
      sent[key] = c.length;
    }
    if (sent[key] >= s.max_per_hour) { await rest(`outbound_messages?id=eq.${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'limitado', last_error: 'Límite por hora alcanzado; se reintentará' }) }); continue; }
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: MAIL_FROM, to: [m.to_address], subject: m.subject || 'Aviso de la plataforma', text: m.body }) });
      if (!r.ok) throw new Error(`Proveedor ${r.status}`);
      await rest(`outbound_messages?id=eq.${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'enviado', sent_at: new Date().toISOString(), attempts: m.attempts + 1 }) });
      sent[key]++; ok++;
    } catch (e) {
      await rest(`outbound_messages?id=eq.${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: m.attempts + 1 >= MAX_ATTEMPTS ? 'error' : 'en_cola', attempts: m.attempts + 1, last_error: String((e as Error).message).slice(0, 300) }) });
      failed++;
    }
  }
  // Los mensajes limitados vuelven a la cola para el siguiente ciclo
  await rest(`outbound_messages?status=eq.limitado`, { method: 'PATCH', body: JSON.stringify({ status: 'en_cola' }) });
  return new Response(JSON.stringify({ ok, blocked, failed }), { headers: { 'Content-Type': 'application/json' } });
});
