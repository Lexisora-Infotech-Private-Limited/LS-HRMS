import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CameraRow, CctvSessionRow, CctvView } from '@lexisora/shared';
import { onRealtime } from '@/lib/socket';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { ConfirmDialog, Empty, ErrorBlock, Loading, PageHeader, Pills, Seg, Tabs, Tag } from '@/components/ui';
import { DataTable, type Column } from '@/components/table';
import { FormModal, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { hubApi, hubKeys, type CameraInput } from '../api-b';
import '../workplace.css';
import '../hub.css';

type Tab = 'live' | 'cameras' | 'log';
type Layout = '2' | '3' | '4';
const HEARTBEAT_MS = 60_000;

/** CCTV — GEN.cctv tiles (spec §11). Gateway HLS when CCTV_GATEWAY_URL is set, otherwise status-only tiles. */
export default function CctvPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('live');
  const [location, setLocation] = useState('');
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return (localStorage.getItem('wp.cctv.layout') as Layout) || '3';
    } catch {
      return '3';
    }
  });
  const [edit, setEdit] = useState<CameraRow | 'new' | null>(null);
  const list = useQuery({ queryKey: hubKeys.cameras(location), queryFn: () => hubApi.cameras(location || undefined), refetchInterval: 60_000 });
  const manage = !!list.data?.canManage;

  useEffect(() => onRealtime('cctv:status', () => void qc.invalidateQueries({ queryKey: hubKeys.cctv })), [qc]);
  const pickLayout = (v: Layout) => {
    setLayout(v);
    try {
      localStorage.setItem('wp.cctv.layout', v);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const data = list.data;
  const items = data?.items ?? [];
  const visibleItems = tab === 'live' ? items.filter((c) => c.enabled) : items;

  return (
    <div data-screen-label="CCTV" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="CCTV"
        sub="Live camera feeds streamed from the office NVR. Visible to Admin and Facility Manager only."
        actions={manage ? <button className="btn btn-primary" onClick={() => setEdit('new')}>Add camera</button> : undefined}
      />
      {manage && <Tabs tabs={[{ value: 'live' as const, label: 'Live view' }, { value: 'cameras' as const, label: `Cameras${data ? ` · ${items.length}` : ''}` }, { value: 'log' as const, label: 'Viewing log' }]} value={tab} onChange={setTab} />}
      {tab !== 'log' && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pills options={[{ value: '', label: 'All' }, ...(data?.locations ?? []).map((l) => ({ value: l, label: l }))]} value={location} onChange={setLocation} />
          {tab === 'live' && <Seg options={[{ value: '2' as const, label: '2×2' }, { value: '3' as const, label: '3×3' }, { value: '4' as const, label: '4×4' }]} value={layout} onChange={pickLayout} />}
        </div>
      )}
      {data?.mode === 'stub' && tab === 'live' && (
        <div className="note" style={{ border: '1px dashed var(--color-accent)', borderRadius: 4, padding: '10px 12px' }}>
          No streaming gateway is configured, so tiles show each camera's status without video. Set <code>CCTV_GATEWAY_URL</code> to stream the NVR feeds as HLS.
        </div>
      )}
      {data?.gatewayDown && <div className="field-error" role="alert">The streaming gateway is not responding. Feeds resume automatically when it is back.</div>}
      {tab === 'log' ? (
        <SessionsLog />
      ) : list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : tab === 'cameras' ? (
        <CamerasTable rows={items} onEdit={setEdit} />
      ) : !visibleItems.length ? (
        <Empty>{manage ? 'No cameras yet. Add one with its RTSP URL from the NVR.' : 'No cameras are available to you.'}</Empty>
      ) : (
        <div className={`wp-cams cols-${layout}`}>
          {visibleItems.map((c) => <CameraTile key={c.id} cam={c} mode={data!.mode} lazy={visibleItems.length > 9} />)}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12.5 }}>Viewing sessions are logged.</div>
      {edit && <CameraForm cam={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function canPlayHlsNatively(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
}

function CameraTile({ cam, mode, lazy }: { cam: CameraRow; mode: 'gateway' | 'stub'; lazy: boolean }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [view, setView] = useState<CctvView | null>(null);
  const [busy, setBusy] = useState(false);

  // With many cameras only the tiles on screen stream (saves NVR bandwidth).
  useEffect(() => {
    if (!lazy || !box.current || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver((e) => setVisible(!!e[0]?.isIntersecting), { rootMargin: '120px' });
    io.observe(box.current);
    return () => io.disconnect();
  }, [lazy]);

  // A viewing session per live, visible tile; heartbeats keep it open, unmount ends it.
  useEffect(() => {
    if (!cam.live || !visible) return;
    let alive = true;
    let sid: string | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    hubApi
      .viewCamera(cam.id)
      .then((v) => {
        if (!alive) return void hubApi.endView(v.sessionId).catch(() => undefined);
        sid = v.sessionId;
        setView(v);
        timer = setInterval(() => void hubApi.heartbeatView(v.sessionId).catch(() => undefined), HEARTBEAT_MS);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      if (sid) void hubApi.endView(sid).catch(() => undefined);
      setView(null);
    };
  }, [cam.id, cam.live, visible]);

  async function reconnect() {
    setBusy(true);
    try {
      const r = await hubApi.reconnectCamera(cam.id);
      toast(r.message);
      await qc.invalidateQueries({ queryKey: hubKeys.cctv });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  const fullscreen = () => void box.current?.requestFullscreen?.().catch(() => undefined);
  const hls = mode === 'gateway' && cam.live ? view?.hlsUrl ?? null : null;

  return (
    <div className="card">
      <div ref={box} className="wp-cam-media placeholder-media" style={{ display: 'grid', placeItems: 'center' }}>
        {hls ? (
          canPlayHlsNatively() ? (
            <video src={hls} muted autoPlay playsInline aria-label={`${cam.name} live feed`} />
          ) : (
            // Browsers without native HLS use the gateway's built-in player page (same signed token).
            <iframe src={hls.replace(/\/index\.m3u8/, '/')} title={`${cam.name} live feed`} allow="autoplay; fullscreen" />
          )
        ) : (
          <span>{cam.live ? 'Camera feed' : cam.status === 'DISABLED' ? 'Disabled' : 'Camera feed · offline'}</span>
        )}
        {cam.live && <span className="wp-cam-live">Live</span>}
        {cam.live && <button className="btn btn-secondary btn-sm wp-cam-full" onClick={fullscreen} aria-label={`Fullscreen ${cam.name}`}>Fullscreen</button>}
      </div>
      <div className={`card-kicker${cam.live ? '' : ' wp-kicker-off'}`}>{cam.kicker}</div>
      <div className="card-title">{cam.name}</div>
      <div className="card-body">{cam.meta}</div>
      {!cam.live && cam.enabled && (
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void reconnect()}>{busy ? 'Reconnecting…' : 'Reconnect'}</button>
      )}
    </div>
  );
}

function CamerasTable({ rows, onEdit }: { rows: CameraRow[]; onEdit: (c: CameraRow) => void }) {
  const inv = [hubKeys.cctv];
  const [del, setDel] = useState<CameraRow | null>(null);
  const test = useAction((c: CameraRow) => hubApi.testCamera(c.id), { success: (r) => r.message, invalidate: inv });
  const toggle = useAction((c: CameraRow) => hubApi.updateCamera(c.id, { enabled: !c.enabled }), { success: (r) => `${r.name} ${r.enabled ? 'enabled' : 'disabled'}`, invalidate: inv });
  const remove = useAction((c: CameraRow) => hubApi.deleteCamera(c.id), { success: (_, c) => `${c.name} removed`, invalidate: inv });
  const columns: Column<CameraRow>[] = [
    { key: 'name', header: 'Name', render: (c) => <strong>{c.name}</strong> },
    { key: 'loc', header: 'Location', render: (c) => c.location },
    { key: 'rtsp', header: 'RTSP URL', render: (c) => <code style={{ fontSize: 12 }}>{c.rtspMasked ?? '—'}</code> },
    { key: 'status', header: 'Status', render: (c) => <Tag tone={c.live ? 'accent' : c.status === 'OFFLINE' ? 'outline' : 'neutral'}>{c.kicker}</Tag> },
    { key: 'seen', header: 'Last seen', render: (c) => c.lastSeen ?? '—' },
    { key: 'en', header: 'Enabled', render: (c) => (c.enabled ? 'Yes' : 'No') },
    { key: 'sort', header: 'Sort', num: true, render: (c) => c.sortOrder },
    {
      key: 'act',
      header: '',
      render: (c) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(c)}>Edit</button>
          <button className="btn btn-ghost btn-sm" disabled={test.isPending || !c.enabled} onClick={() => test.mutate(c)}>Test connection</button>
          <button className="btn btn-ghost btn-sm" disabled={toggle.isPending} onClick={() => toggle.mutate(c)}>{c.enabled ? 'Disable' : 'Enable'}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setDel(c)}>Delete</button>
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} empty="No cameras yet." />
      </div>
      <div className="muted" style={{ fontSize: 12 }}>RTSP URLs are stored encrypted and are never shown again after saving.</div>
      {del && (
        <ConfirmDialog
          title={`Delete ${del.name}?`}
          body="The camera leaves the grid and its gateway path is removed. Viewing history is kept."
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(del, { onSuccess: () => setDel(null) })}
          onClose={() => setDel(null)}
        />
      )}
    </>
  );
}

function CameraForm({ cam, onClose }: { cam: CameraRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const lk = useLookups(['branches']);
  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Main entrance' },
    { name: 'location', label: 'Location', type: 'text', required: true, placeholder: 'Ahmedabad HQ' },
    { name: 'rtspUrl', label: 'RTSP URL', type: 'password', span: 2, required: !cam, placeholder: 'rtsp://user:pass@10.0.0.21/stream1', hint: cam ? `Current: ${cam.rtspMasked ?? 'not set'}. Leave blank to keep it.` : 'Stored encrypted; only a masked form is shown afterwards.' },
    { name: 'branchId', label: 'Branch', type: 'select', options: [{ value: '', label: cam ? 'Keep current' : 'None' }, ...opts(lk.data, 'branches')] },
    { name: 'sortOrder', label: 'Sort order', type: 'number' },
    { name: 'enabled', label: 'Enabled', type: 'checkbox', span: 2 },
  ];
  return (
    <FormModal
      title={cam ? `Edit ${cam.name}` : 'Add camera'}
      fields={fields}
      submitLabel={cam ? 'Save' : 'Add camera'}
      initial={cam ? { name: cam.name, location: cam.location, sortOrder: cam.sortOrder, enabled: cam.enabled } : { sortOrder: 0, enabled: true }}
      onSubmit={async (v) => {
        const body: Partial<CameraInput> = { name: String(v.name).trim(), location: String(v.location).trim(), sortOrder: Number(v.sortOrder) || 0, enabled: !!v.enabled };
        if (v.rtspUrl) body.rtspUrl = String(v.rtspUrl).trim();
        if (v.branchId || !cam) body.branchId = v.branchId || null;
        if (cam) await hubApi.updateCamera(cam.id, body);
        else await hubApi.createCamera(body as CameraInput);
        toast(cam ? `${body.name} updated` : `${body.name} added`);
        await qc.invalidateQueries({ queryKey: hubKeys.cctv });
      }}
      onClose={onClose}
    />
  );
}

function SessionsLog() {
  const q = useQuery({ queryKey: hubKeys.cctvSessions, queryFn: hubApi.cctvSessions });
  const columns: Column<CctvSessionRow>[] = [
    { key: 'cam', header: 'Camera', render: (s) => <strong>{s.camera}</strong> },
    { key: 'user', header: 'Viewer', render: (s) => s.user },
    { key: 'start', header: 'Started', render: (s) => s.startedAt },
    { key: 'end', header: 'Ended', render: (s) => s.endedAt ?? <Tag tone="accent">Watching</Tag> },
    { key: 'min', header: 'Minutes', num: true, render: (s) => s.minutes },
  ];
  if (q.error) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  return (
    <div className="card" style={{ padding: 0 }}>
      <DataTable columns={columns} rows={q.data} rowKey={(s) => s.id} loading={q.isLoading} empty="Nobody has viewed a camera yet." />
    </div>
  );
}
