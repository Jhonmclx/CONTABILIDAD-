import { useState } from 'react';
import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, Select, Stat, Table, useToast } from '../../components/ui';
import { date, dateTime } from '../../lib/format';
import { useSession } from '../../lib/session';

export function SuperAdmin() {
  const s = useSession(); const toast = useToast();
  const { data, loading, reload } = useAsync(async () => {
    const [o, p, j] = await Promise.all([db.rpc('admin_list_orgs'), db.from('plans').select('*').order('created_at'), db.from('job_runs').select('*').order('at', { ascending: false }).limit(20)]);
    return { orgs: (o.data as any[]) || [], plans: (p.data as any[]) || [], jobs: (j.data as any[]) || [] };
  }, []);
  const [plan, setPlan] = useState<any>(null);
  if (loading || !data) return <Loading />;
  const setOrg = async (o: any, status: string, planCode: string) => { const r = await db.rpc('admin_set_org', { p_org: o.id, p_status: status, p_plan_code: planCode }); if (r.error) return toast(r.error.message, 'bad'); toast('Organización actualizada'); reload(); };
  const savePlan = async () => {
    const row = { code: plan.code, name: plan.name, price_cop: plan.price_cop === '' ? null : Number(plan.price_cop), max_users: Number(plan.max_users) || null, max_clients: Number(plan.max_clients) || null, max_storage_mb: Number(plan.max_storage_mb) || null, max_documents_month: Number(plan.max_documents_month) || null, is_active: plan.is_active };
    const r = plan.id ? await db.from('plans').update(row).eq('id', plan.id) : await db.from('plans').insert(row);
    if (r.error) return toast(r.error.message, 'bad'); setPlan(null); reload();
  };
  const sum = (k: string) => data.orgs.reduce((a, o) => a + Number(o[k] || 0), 0);
  return (
    <>
      <div className="page-h"><div><h2>Administración de la plataforma</h2><p className="muted small">Organizaciones, planes y estado operativo. Este panel no da acceso a documentos contables de las firmas.</p></div></div>
      <div className="grid g4"><Stat label="Organizaciones" value={data.orgs.length} /><Stat label="Usuarios" value={sum('users')} /><Stat label="Clientes gestionados" value={sum('clients')} /><Stat label="Almacenamiento" value={`${sum('storage_mb').toFixed(1)} MB`} /></div>
      <Card title="Organizaciones" pad={false}>
        <Table rows={data.orgs} columns={[
          { key: 'n', label: 'Firma', render: (r) => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div className="dim xs mono">{r.slug}</div></div> },
          { key: 'u', label: 'Usuarios', num: true, render: (r) => r.users }, { key: 'c', label: 'Clientes', num: true, render: (r) => r.clients }, { key: 'd', label: 'Documentos', num: true, render: (r) => r.documents },
          { key: 'p', label: 'Plan', render: (r) => <Select value={r.plan_code || ''} onChange={(e: any) => setOrg(r, r.status, e.target.value)} options={data.plans.map((p) => ({ value: p.code, label: p.name }))} style={{ minHeight: 34 }} /> },
          { key: 's', label: 'Estado', render: (r) => <Button size="s" variant="ghost" onClick={() => setOrg(r, r.status === 'activa' ? 'suspendida' : 'activa', r.plan_code)}><Badge status={r.status} /></Button> },
          { key: 'at', label: 'Creada', render: (r) => date(r.created_at) }]} />
      </Card>
      <Card title="Planes y límites" actions={<Button size="s" onClick={() => setPlan({ code: '', name: '', price_cop: '', max_users: '', max_clients: '', max_storage_mb: '', max_documents_month: '', is_active: true })}>Nuevo plan</Button>} pad={false}>
        <Table rows={data.plans} onRow={(r) => setPlan({ ...r, price_cop: r.price_cop ?? '' })} columns={[{ key: 'name', label: 'Plan' }, { key: 'price', label: 'Precio mensual', render: (r) => r.price_cop ? `$ ${Number(r.price_cop).toLocaleString('es-CO')}` : 'Por definir' },
          { key: 'u', label: 'Usuarios', render: (r) => r.max_users ?? '∞' }, { key: 'c', label: 'Clientes', render: (r) => r.max_clients ?? '∞' }, { key: 'st', label: 'Almacenamiento', render: (r) => r.max_storage_mb ? `${r.max_storage_mb} MB` : '∞' }, { key: 'a', label: 'Activo', render: (r) => <Badge status={r.is_active ? 'activo' : 'inactivo'} /> }]} />
      </Card>
      <Alert kind="info">Los cobros reales permanecen desactivados hasta integrar y probar un proveedor de pagos con webhooks verificados.</Alert>
      <Card title="Trabajos programados" pad={false}><Table dense rows={data.jobs} columns={[{ key: 'at', label: 'Fecha', render: (r) => dateTime(r.at) }, { key: 'job', label: 'Trabajo' }, { key: 's', label: 'Resultado', render: (r) => <Badge t={r.status === 'ok' ? 'ok' : 'bad'}>{r.status}</Badge> }, { key: 'd', label: 'Detalle', render: (r) => r.detail }]} /></Card>
      <p className="dim xs">Su identificador de soporte (para que una firma le autorice acceso temporal): <span className="mono">{s.session?.user.id}</span></p>
      {plan && <Modal open title={plan.id ? `Plan ${plan.name}` : 'Nuevo plan'} onClose={() => setPlan(null)} footer={<Button onClick={savePlan}>Guardar</Button>}>
        <div className="form-grid">
          <Field label="Código"><Input value={plan.code} disabled={!!plan.id} onChange={(e: any) => setPlan({ ...plan, code: e.target.value })} /></Field>
          <Field label="Nombre"><Input value={plan.name} onChange={(e: any) => setPlan({ ...plan, name: e.target.value })} /></Field>
          <Field label="Precio mensual (COP)" hint="Vacío = por definir"><Input inputMode="numeric" value={plan.price_cop} onChange={(e: any) => setPlan({ ...plan, price_cop: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Máx. usuarios internos"><Input inputMode="numeric" value={plan.max_users ?? ''} onChange={(e: any) => setPlan({ ...plan, max_users: e.target.value })} /></Field>
          <Field label="Máx. clientes"><Input inputMode="numeric" value={plan.max_clients ?? ''} onChange={(e: any) => setPlan({ ...plan, max_clients: e.target.value })} /></Field>
          <Field label="Almacenamiento (MB)"><Input inputMode="numeric" value={plan.max_storage_mb ?? ''} onChange={(e: any) => setPlan({ ...plan, max_storage_mb: e.target.value })} /></Field>
          <Field label="Documentos por mes"><Input inputMode="numeric" value={plan.max_documents_month ?? ''} onChange={(e: any) => setPlan({ ...plan, max_documents_month: e.target.value })} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={plan.is_active} onChange={(e: any) => setPlan({ ...plan, is_active: e.target.checked })} />Plan disponible</label>
      </Modal>}
    </>
  );
}
