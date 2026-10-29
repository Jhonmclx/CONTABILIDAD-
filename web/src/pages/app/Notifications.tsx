import { useAsync } from '../../lib/hooks';
import { db } from '../../lib/sb';
import { Button, Card, Empty, Loading, Table } from '../../components/ui';
import { dateTime, L } from '../../lib/format';
import { navigate } from '../../lib/router';

export function Notifications() {
  const { data, loading, reload } = useAsync(async () => ((await db.from('notifications').select('*').order('created_at', { ascending: false }).limit(300)).data as any[]) || [], []);
  const markAll = async () => { await db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); reload(); };
  return (
    <>
      <div className="page-h"><div><h2>Notificaciones</h2><p className="muted small">Tareas asignadas, documentos recibidos, procesamientos fallidos, vencimientos, devoluciones e informes.</p></div>
        <Button variant="outline" onClick={markAll}>Marcar todas como leídas</Button></div>
      <Card pad={false}>
        {loading ? <Loading /> : <Table rows={data || []} onRow={async (n) => { if (!n.read_at) await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); if (n.link?.startsWith('/')) navigate(n.link); else reload(); }}
          empty={<Empty title="Sin notificaciones" icon="bell" />} columns={[
            { key: 'title', label: 'Aviso', render: (r) => <div style={{ fontWeight: r.read_at ? 400 : 700 }}>{!r.read_at && <span className="ndot" style={{ display: 'inline-block', marginRight: 8, width: 8, height: 8, borderRadius: 9, background: 'var(--brand)' }} />}{r.title}<div className="dim xs">{r.body}</div></div> },
            { key: 'kind', label: 'Tipo', render: (r) => L(r.kind) }, { key: 'at', label: 'Fecha', render: (r) => dateTime(r.created_at) }]} />}
      </Card>
    </>
  );
}
