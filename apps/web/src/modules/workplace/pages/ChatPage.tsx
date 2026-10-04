import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CHAT_EDIT_WINDOW_MIN, type CallJoin, type ChatChannelRow, type ChatChannelsResponse, type ChatMessageRow, type ChatPerson } from '@lexisora/shared';
import { fileUrl, uploadFile } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { emitRealtime, getSocket, onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { ConfirmDialog, Empty, ErrorBlock, Loading, Modal, Tabs } from '@/components/ui';
import { MultiSelect } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { dayHeading, hubApi, hubKeys, newClientId, type ChatSendBody } from '../api-b';
import { CallPanel } from '../components/CallPanel';
import '../workplace.css';
import '../hub.css';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const istKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const draftKey = (id: string) => `wp.chat.draft.${id}`;
const readDraft = (id: string) => {
  try {
    return localStorage.getItem(draftKey(id)) ?? '';
  } catch {
    return '';
  }
};
const writeDraft = (id: string, v: string) => {
  try {
    if (v) localStorage.setItem(draftKey(id), v);
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* storage unavailable */
  }
};

/** Comms hub — wireframe "Comms hub" (spec §5): channels + DMs, realtime, history, attachments, mentions, calls. */
export default function ChatPage() {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: hubKeys.channels, queryFn: hubApi.channels });
  const [browse, setBrowse] = useState(false);
  const [newDm, setNewDm] = useState(false);
  const [call, setCall] = useState<CallJoin | null>(null);
  const [ring, setRing] = useState<{ callId: string; channelId: string; channelLabel: string; kind: string; from: string } | null>(null);
  const myUserId = list.data?.userId ?? '';
  const all = useMemo(() => [...(list.data?.channels ?? []), ...(list.data?.dms ?? [])], [list.data]);
  const activeId = params.get('c') ?? list.data?.channels[0]?.id ?? null;
  const active = all.find((c) => c.id === activeId) ?? null;
  const activeRef = useRef<string | null>(activeId);
  activeRef.current = activeId;

  const open = useCallback((id: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set('c', id);
    return n;
  }), [setParams]);

  const patchChannel = useCallback((id: string, fn: (c: ChatChannelRow) => ChatChannelRow) => {
    qc.setQueryData<ChatChannelsResponse>(hubKeys.channels, (d) => (d ? { ...d, channels: d.channels.map((c) => (c.id === id ? fn(c) : c)), dms: d.dms.map((c) => (c.id === id ? fn(c) : c)) } : d));
  }, [qc]);

  // Unread badges and channel list updates for the channels not on screen.
  useEffect(() => {
    const offs = [
      onRealtime<ChatMessageRow>('chat:message', (m) => {
        const known = qc.getQueryData<ChatChannelsResponse>(hubKeys.channels);
        const exists = known && [...known.channels, ...known.dms].some((c) => c.id === m.channelId);
        if (!exists) return void qc.invalidateQueries({ queryKey: hubKeys.channels });
        patchChannel(m.channelId, (c) => ({ ...c, lastSeq: Math.max(c.lastSeq, m.seq), lastMessageAt: m.createdAt, unread: m.channelId === activeRef.current || m.senderUserId === myUserId || m.kind !== 'USER' ? c.unread : c.unread + 1 }));
      }),
      onRealtime<{ channelId: string; seq: number }>('chat:read', (p) => patchChannel(p.channelId, (c) => ({ ...c, lastReadSeq: Math.max(c.lastReadSeq, p.seq), unread: 0 }))),
      onRealtime('chat:channels', () => void qc.invalidateQueries({ queryKey: hubKeys.channels })),
      onRealtime<{ callId: string; channelId: string; channelLabel: string; kind: string; from: string; fromUserId: string }>('call:ring', (p) => {
        patchChannel(p.channelId, (c) => ({ ...c, liveCall: { callId: p.callId, kind: p.kind } }));
        if (p.fromUserId !== myUserId) {
          setRing(p);
          beep();
        }
      }),
      onRealtime<{ callId: string; channelId: string }>('call:ended', (p) => {
        patchChannel(p.channelId, (c) => ({ ...c, liveCall: null }));
        setRing((r) => (r?.callId === p.callId ? null : r));
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [qc, patchChannel, myUserId]);

  async function startCall(kind: 'AUDIO' | 'VIDEO' | 'SCREEN') {
    if (!active) return;
    try {
      const c = active.liveCall ? await hubApi.joinCall(active.liveCall.callId) : await hubApi.startCall(active.id, kind);
      setCall(c);
      toast(c.provider === 'livekit' ? (active.liveCall ? 'Joined the call' : 'Starting call') : 'Starting call · Calls need LiveKit configured');
    } catch (e) {
      toastError(e);
    }
  }

  async function joinRing() {
    if (!ring) return;
    try {
      setCall(await hubApi.joinCall(ring.callId));
      open(ring.channelId);
    } catch (e) {
      toastError(e);
    }
    setRing(null);
  }

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorBlock error={list.error} retry={() => void list.refetch()} />;
  const data = list.data!;

  return (
    <div data-screen-label="Comms hub" className="wp-chat">
      <aside className="wp-chat-rail" aria-label="Channels and direct messages">
        <div className="wp-rail-head">
          <span>Channels</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setBrowse(true)} aria-label="Browse or create channels" title="Browse or create channels">+</button>
        </div>
        {data.channels.map((c) => <RailItem key={c.id} c={c} active={c.id === activeId} onPick={() => open(c.id)} />)}
        <div className="wp-rail-head" style={{ marginTop: 10 }}>
          <span>Direct messages</span>
        </div>
        {data.dms.map((c) => <RailItem key={c.id} c={c} active={c.id === activeId} onPick={() => open(c.id)} />)}
        <button className="wp-rail-item wp-rail-new" onClick={() => setNewDm(true)}>+ New message</button>
      </aside>
      {active ? (
        <ChannelPane key={active.id} channel={active} myUserId={myUserId} onStartCall={startCall} onLeft={() => setParams({})} onOpenChannel={open} channels={data.channels} />
      ) : (
        <div className="wp-chat-empty"><Empty>Pick a channel or start a conversation.</Empty></div>
      )}
      {ring && !call && (
        <div className="wp-ring" role="alert">
          <div><strong>{ring.from}</strong> started a {ring.kind === 'AUDIO' ? 'audio call' : ring.kind === 'SCREEN' ? 'screen share' : 'video call'} in {ring.channelLabel}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void joinRing()}>Join</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setRing(null)}>Dismiss</button>
          </div>
        </div>
      )}
      {call && <CallPanel call={call} onClose={() => { setCall(null); void qc.invalidateQueries({ queryKey: hubKeys.channels }); }} />}
      {browse && <BrowseModal canCreate={data.canCreate} onClose={() => setBrowse(false)} onOpen={(id) => { setBrowse(false); open(id); }} />}
      {newDm && <NewMessageModal myUserId={myUserId} onClose={() => setNewDm(false)} onOpen={(id) => { setNewDm(false); open(id); }} />}
    </div>
  );
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660;
    g.gain.value = 0.05;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* audio unavailable */
  }
}

function RailItem({ c, active, onPick }: { c: ChatChannelRow; active: boolean; onPick: () => void }) {
  const dm = c.kind === 'DM' || c.kind === 'GROUP_DM';
  const badge = c.unread > 99 ? '99+' : c.unread ? String(c.unread) : '';
  return (
    <button className={`wp-rail-item${active ? ' is-active' : ''}${c.muted ? ' is-muted' : ''}`} onClick={onPick} aria-current={active ? 'page' : undefined}>
      <span className="wp-rail-label">
        {dm && <span className={`wp-presence${c.online ? ' is-on' : ''}`} aria-label={c.online ? 'Online' : 'Offline'} />}
        {c.label}
        {c.liveCall && <span className="wp-live-dot" title="Call in progress" />}
      </span>
      <span className="wp-unread" aria-label={badge ? `${badge} unread` : undefined}>{badge}</span>
    </button>
  );
}

// ── Markdown-lite: **bold**, _italic_, `code`, links, @mentions, #channels ─────
const TOKEN = /(\*\*[^*\n]+\*\*|_[^_\n]+_|`[^`\n]+`|https?:\/\/[^\s<]+|@[A-Za-z][\w.'-]*(?: [A-Z][\w'-]*)?|#[a-z0-9][a-z0-9-]*)/g;
function renderBody(text: string, onChannel: (name: string) => void): ReactNode[] {
  return text.split('\n').flatMap((line, li) => {
    const out: ReactNode[] = li ? [<br key={`br${li}`} />] : [];
    let last = 0;
    for (const m of line.matchAll(TOKEN)) {
      const tok = m[0];
      const i = m.index ?? 0;
      if (i > last) out.push(line.slice(last, i));
      const k = `${li}-${i}`;
      if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
      else if (tok.startsWith('_')) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
      else if (tok.startsWith('`')) out.push(<code key={k} className="wp-code">{tok.slice(1, -1)}</code>);
      else if (tok.startsWith('http')) out.push(<a key={k} href={tok} target="_blank" rel="noreferrer noopener" className="wp-link">{tok}</a>);
      else if (tok.startsWith('@')) out.push(<span key={k} className="wp-mention">{tok}</span>);
      else out.push(<button key={k} className="wp-link-plain wp-chan-ref" onClick={() => onChannel(tok.slice(1))}>{tok}</button>);
      last = i + tok.length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  });
}

type PageState = { items: ChatMessageRow[]; hasMore: boolean };

function ChannelPane({ channel, myUserId, onStartCall, onLeft, onOpenChannel, channels }: { channel: ChatChannelRow; myUserId: string; onStartCall: (k: 'AUDIO' | 'VIDEO' | 'SCREEN') => void; onLeft: () => void; onOpenChannel: (id: string) => void; channels: ChatChannelRow[] }) {
  const qc = useQueryClient();
  const me = useMe();
  const { toast, toastError } = useToast();
  const [page, setPage] = useState<PageState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [divider] = useState(channel.lastReadSeq);
  const [draft, setDraft] = useState(() => readDraft(channel.id));
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessageRow | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<'members' | 'search' | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'leave' | 'archive' | 'delete'; id?: string } | null>(null);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const lastTyping = useRef(0);
  const typingOff = useRef<ReturnType<typeof setTimeout>>();
  const restore = useRef<number | null>(null);
  const members = useQuery({ queryKey: hubKeys.members(channel.id), queryFn: () => hubApi.members(channel.id), staleTime: 60_000 });
  const dm = channel.kind === 'DM' || channel.kind === 'GROUP_DM';

  const markRead = useCallback((seq: number) => {
    if (!seq) return;
    const s = getSocket();
    if (s?.connected) emitRealtime('chat:read', { channelId: channel.id, seq });
    else void hubApi.read(channel.id, seq).catch(() => undefined);
    qc.setQueryData<ChatChannelsResponse>(hubKeys.channels, (d) => (d ? { ...d, channels: d.channels.map((c) => (c.id === channel.id ? { ...c, unread: 0, lastReadSeq: seq } : c)), dms: d.dms.map((c) => (c.id === channel.id ? { ...c, unread: 0, lastReadSeq: seq } : c)) } : d));
  }, [channel.id, qc]);

  // Initial page + join the socket room.
  useEffect(() => {
    let alive = true;
    emitRealtime('chat:join', { channelId: channel.id });
    hubApi
      .messages(channel.id, { limit: 50 })
      .then((p) => {
        if (!alive) return;
        setPage({ items: p.items, hasMore: p.hasMore });
        markRead(p.lastSeq);
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [channel.id, markRead]);

  // Live updates for this channel.
  useEffect(() => {
    const offs = [
      onRealtime<ChatMessageRow>('chat:message', (m) => {
        if (m.channelId !== channel.id) return;
        setPage((p) => (p && !p.items.some((x) => x.id === m.id) ? { ...p, items: [...p.items, m] } : p));
        setTyping((t) => {
          if (!m.senderUserId || !t[m.senderUserId]) return t;
          const n = { ...t };
          delete n[m.senderUserId];
          return n;
        });
        if (document.visibilityState === 'visible') markRead(m.seq);
      }),
      onRealtime<ChatMessageRow>('chat:message:updated', (m) => m.channelId === channel.id && setPage((p) => (p ? { ...p, items: p.items.map((x) => (x.id === m.id ? { ...x, body: m.body, editedAt: m.editedAt, mentions: m.mentions } : x)) } : p))),
      onRealtime<{ id: string; channelId: string }>('chat:message:deleted', (d) => d.channelId === channel.id && setPage((p) => (p ? { ...p, items: p.items.map((x) => (x.id === d.id ? { ...x, deleted: true, body: null, attachments: [] } : x)) } : p))),
      onRealtime<{ channelId: string; userId: string; name: string; on: boolean }>('chat:typing', (t) => {
        if (t.channelId !== channel.id || t.userId === myUserId) return;
        setTyping((s) => {
          const n = { ...s };
          if (t.on) n[t.userId] = { name: t.name, at: Date.now() };
          else delete n[t.userId];
          return n;
        });
      }),
    ];
    const sweep = setInterval(() => setTyping((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => Date.now() - v.at < 6000))), 2000);
    return () => {
      offs.forEach((o) => o());
      clearInterval(sweep);
    };
  }, [channel.id, myUserId, markRead]);

  // Scroll: stick to the bottom for new messages; keep position when older pages load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !page) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [page]);

  async function loadOlder() {
    if (!page?.hasMore || loadingOlder || !page.items.length) return;
    setLoadingOlder(true);
    try {
      const el = scroller.current;
      const older = await hubApi.messages(channel.id, { beforeSeq: page.items[0]!.seq, limit: 50 });
      restore.current = el ? el.scrollHeight - el.scrollTop : null;
      setPage((p) => (p ? { items: [...older.items.filter((o) => !p.items.some((x) => x.id === o.id)), ...p.items], hasMore: older.hasMore } : p));
    } catch (e) {
      toastError(e);
    } finally {
      setLoadingOlder(false);
    }
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 40) void loadOlder();
  }

  function setDraftValue(v: string) {
    setDraft(v);
    writeDraft(channel.id, v);
    const at = /(^|\s)@([\w.]{0,20})$/.exec(v);
    setMentionQ(at ? at[2]! : null);
    const now = Date.now();
    if (v && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      emitRealtime('chat:typing', { channelId: channel.id, on: true });
    }
    clearTimeout(typingOff.current);
    typingOff.current = setTimeout(() => {
      lastTyping.current = 0;
      emitRealtime('chat:typing', { channelId: channel.id, on: false });
    }, 4000);
  }

  function pickMention(name: string) {
    setDraftValue(draft.replace(/@([\w.]{0,20})$/, `@${name} `));
    setMentionQ(null);
    composer.current?.focus();
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = [...list];
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) toastError(new Error(`${tooBig.name} is larger than 25 MB`));
    setFiles((f) => [...f, ...picked.filter((x) => x.size <= MAX_FILE_BYTES)].slice(0, MAX_FILES));
  }

  async function send() {
    const body = draft.trim();
    if ((!body && !files.length) || sending || !channel.canPost) return;
    setSending(true);
    try {
      const attachments = [];
      for (const f of files) {
        const up = await uploadFile(f, 'chat');
        attachments.push({ fileId: up.id, name: up.filename, mime: up.mime, size: up.size });
      }
      const payload: ChatSendBody = { body, clientMsgId: newClientId(), attachments, replyToId: replyTo?.id ?? null };
      const msg = await sendMessage(channel.id, payload);
      stick.current = true;
      setPage((p) => (p && !p.items.some((x) => x.id === msg.id) ? { ...p, items: [...p.items, msg] } : p));
      setDraftValue('');
      setFiles([]);
      setReplyTo(null);
      clearTimeout(typingOff.current);
      emitRealtime('chat:typing', { channelId: channel.id, on: false });
    } catch (e) {
      toastError(e);
    } finally {
      setSending(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      const m = await hubApi.editMessage(editing.id, editing.body);
      setPage((p) => (p ? { ...p, items: p.items.map((x) => (x.id === m.id ? { ...x, body: m.body, editedAt: m.editedAt } : x)) } : p));
      setEditing(null);
    } catch (e) {
      toastError(e);
    }
  }

  const mute = useAction(() => hubApi.mute(channel.id, !channel.muted), { success: channel.muted ? 'Notifications on' : 'Channel muted', invalidate: [hubKeys.channels] });
  async function confirmAction() {
    if (!confirm) return;
    try {
      if (confirm.kind === 'leave') {
        await hubApi.leaveChannel(channel.id);
        toast(`You left ${channel.label}`);
        await qc.invalidateQueries({ queryKey: hubKeys.channels });
        onLeft();
      } else if (confirm.kind === 'archive') {
        await hubApi.archiveChannel(channel.id, true);
        toast(`${channel.label} archived`);
        await qc.invalidateQueries({ queryKey: hubKeys.channels });
        onLeft();
      } else if (confirm.id) {
        await hubApi.deleteMessage(confirm.id);
        setPage((p) => (p ? { ...p, items: p.items.map((x) => (x.id === confirm.id ? { ...x, deleted: true, body: null, attachments: [] } : x)) } : p));
      }
    } catch (e) {
      toastError(e);
    }
    setConfirm(null);
  }

  const now = Date.now();
  const flags = (m: ChatMessageRow) => {
    const mine = !!m.senderUserId && m.senderUserId === myUserId;
    return {
      mine,
      canEdit: mine && m.kind === 'USER' && !m.deleted && now - new Date(m.createdAt).getTime() <= CHAT_EDIT_WINDOW_MIN * 60_000,
      canDelete: !m.deleted && m.kind === 'USER' && (mine || channel.canManage),
    };
  };
  const typers = Object.values(typing).map((t) => t.name);
  const suggestions = mentionQ !== null ? (members.data ?? []).filter((p) => p.userId !== myUserId && p.name.toLowerCase().includes(mentionQ.toLowerCase())).slice(0, 6) : [];
  const channelByName = (name: string) => channels.find((c) => c.name === name);
  const meta = dm ? channel.topic : [channel.topic, `${channel.memberCount} member${channel.memberCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

  return (
    <section className="wp-chat-main" aria-label={channel.label}>
      <header className="wp-chat-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="wp-chat-title">{channel.label}</div>
          {meta && <div className="wp-chat-meta">{meta}</div>}
        </div>
        <button className="btn btn-secondary" disabled={!channel.canPost} title={channel.canPost ? undefined : (channel.postingNote ?? undefined)} onClick={() => onStartCall('AUDIO')}>Audio</button>
        <button className="btn btn-secondary" disabled={!channel.canPost} title={channel.canPost ? undefined : (channel.postingNote ?? undefined)} onClick={() => onStartCall('VIDEO')}>Video</button>
        <button className="btn btn-secondary" disabled={!channel.canPost} title={channel.canPost ? undefined : (channel.postingNote ?? undefined)} onClick={() => onStartCall('SCREEN')}>Share screen</button>
        <div className="wp-menu-anchor">
          <button className="btn btn-ghost" aria-haspopup="menu" aria-expanded={menu} aria-label="More" onClick={() => setMenu((v) => !v)}>⋯</button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {!dm && <button role="menuitem" onClick={() => { setPanel('members'); setMenu(false); }}>Members</button>}
              <button role="menuitem" onClick={() => { setPanel('search'); setMenu(false); }}>Search</button>
              <button role="menuitem" onClick={() => { mute.mutate(undefined); setMenu(false); }}>{channel.muted ? 'Unmute' : 'Mute'}</button>
              {!dm && !channel.managed && <button role="menuitem" onClick={() => { setConfirm({ kind: 'leave' }); setMenu(false); }}>Leave</button>}
              {!dm && channel.canManage && <button role="menuitem" onClick={() => { setConfirm({ kind: 'archive' }); setMenu(false); }}>Archive</button>}
            </div>
          )}
        </div>
      </header>
      {channel.liveCall && (
        <div className="wp-live-banner">
          <span>A {channel.liveCall.kind === 'AUDIO' ? 'call' : channel.liveCall.kind === 'SCREEN' ? 'screen share' : 'video call'} is in progress</span>
          <button className="btn btn-primary btn-sm" onClick={() => onStartCall(channel.liveCall!.kind as 'AUDIO' | 'VIDEO' | 'SCREEN')}>Join</button>
        </div>
      )}
      <div className="wp-chat-scroll" ref={scroller} onScroll={onScroll} aria-live="polite">
        {error ? <ErrorBlock error={error} /> : !page ? <Loading /> : (
          <>
            {page.hasMore && <div className="wp-chat-older">{loadingOlder ? 'Loading earlier messages…' : <button className="btn btn-ghost btn-sm" onClick={() => void loadOlder()}>Load earlier messages</button>}</div>}
            {!page.items.length && <Empty>No messages yet. Say hello!</Empty>}
            {page.items.map((m, i) => {
              const prev = page.items[i - 1];
              const newDay = !prev || istKey(prev.createdAt) !== istKey(m.createdAt);
              const showDivider = divider > 0 && m.seq > divider && (!prev || prev.seq <= divider) && m.senderUserId !== myUserId;
              const f = flags(m);
              return (
                <Fragment key={m.id}>
                  {newDay && <div className="wp-day-sep"><span>{dayHeading(m.createdAt)}</span></div>}
                  {showDivider && <div className="wp-new-sep"><span>New messages</span></div>}
                  {m.kind !== 'USER' ? (
                    <div className="wp-sys-msg">{m.kind === 'CALL_SUMMARY' ? '☎ ' : ''}{m.body} · {m.t}</div>
                  ) : (
                    <div className={`wp-msg${m.mentions.includes(myUserId) ? ' is-mention' : ''}`}>
                      <span className="wp-msg-avatar" aria-hidden>{m.init}</span>
                      <div className="wp-msg-body">
                        <div className="wp-msg-head"><strong>{m.who}</strong> <span className="muted">{m.t}</span>{m.editedAt && !m.deleted && <span className="muted"> · edited</span>}</div>
                        {m.replyTo && <div className="wp-reply-quote">↪ {m.replyTo.who}: {m.replyTo.body ?? 'Message deleted'}</div>}
                        {editing?.id === m.id ? (
                          <div className="wp-edit">
                            <textarea className="input" value={editing.body} onChange={(e) => setEditing({ id: m.id, body: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit(); } if (e.key === 'Escape') setEditing(null); }} rows={2} autoFocus />
                            <div className="row" style={{ gap: 6 }}><button className="btn btn-primary btn-sm" onClick={() => void saveEdit()}>Save</button><button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
                          </div>
                        ) : m.deleted ? (
                          <div className="muted wp-deleted">Message deleted</div>
                        ) : (
                          <div className="wp-msg-text">{renderBody(m.body ?? '', (name) => { const c = channelByName(name); if (c) onOpenChannel(c.id); })}</div>
                        )}
                        {!m.deleted && m.attachments.length > 0 && (
                          <div className="wp-attachments">
                            {m.attachments.map((a) =>
                              a.mime.startsWith('image/') ? (
                                <a key={a.fileId} href={fileUrl(a.fileId)} target="_blank" rel="noreferrer"><img src={fileUrl(a.fileId)} alt={a.name} className="wp-thumb" /></a>
                              ) : (
                                <a key={a.fileId} className="wp-chip" href={fileUrl(a.fileId)} target="_blank" rel="noreferrer">📎 {a.name} · {Math.max(1, Math.round(a.size / 1024))} KB</a>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                      {!m.deleted && editing?.id !== m.id && (
                        <div className="wp-msg-actions">
                          {channel.canPost && <button className="btn btn-ghost btn-sm" onClick={() => { setReplyTo(m); composer.current?.focus(); }}>Reply</button>}
                          {f.canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: m.id, body: m.body ?? '' })}>Edit</button>}
                          {f.canDelete && <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ kind: 'delete', id: m.id })}>Delete</button>}
                          <button className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/chat?c=${channel.id}#m${m.seq}`); toast('Link copied'); }}>Copy link</button>
                        </div>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </>
        )}
      </div>
      <div className="wp-typing" aria-live="polite">{typers.length ? `${typers.slice(0, 2).join(' and ')}${typers.length > 2 ? ' and others' : ''} ${typers.length === 1 ? 'is' : 'are'} typing…` : ''}</div>
      {channel.canPost ? (
        <div className="wp-composer-box">
          {replyTo && <div className="wp-reply-bar">Replying to <strong>{replyTo.who}</strong>: {(replyTo.body ?? '').slice(0, 80)} <button className="btn btn-ghost btn-sm" onClick={() => setReplyTo(null)} aria-label="Cancel reply">×</button></div>}
          {files.length > 0 && (
            <div className="wp-attachments">
              {files.map((f, i) => <span key={`${f.name}-${i}`} className="wp-chip">📎 {f.name} <button className="wp-link-plain" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>×</button></span>)}
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="wp-mentions" role="listbox" aria-label="Mention someone">
              {suggestions.map((p) => <button key={p.userId} role="option" aria-selected={false} onClick={() => pickMention(p.name)}><span className="wp-msg-avatar">{p.initials}</span>{p.name}<span className="muted">{p.title ?? ''}</span></button>)}
            </div>
          )}
          <div className="wp-composer-row">
            <button className="btn btn-ghost" onClick={() => fileInput.current?.click()} aria-label="Attach files" title="Attach files (up to 10, 25 MB each)">📎</button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <textarea
              ref={composer}
              className="input"
              rows={1}
              placeholder="Message"
              aria-label={`Message ${channel.label}`}
              value={draft}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (suggestions.length && mentionQ !== null) pickMention(suggestions[0]!.name);
                  else void send();
                }
                if (e.key === 'Escape') setMentionQ(null);
              }}
              onPaste={(e) => e.clipboardData.files.length && addFiles(e.clipboardData.files)}
            />
            <button className="btn btn-primary" onClick={() => void send()} disabled={sending || (!draft.trim() && !files.length)}>{sending ? 'Sending…' : 'Send'}</button>
          </div>
        </div>
      ) : (
        <div className="wp-composer-box wp-readonly">{channel.postingNote ?? 'This channel is read-only'}</div>
      )}
      {panel === 'members' && <MembersModal channel={channel} me={me.name} onClose={() => setPanel(null)} />}
      {panel === 'search' && <SearchModal channel={channel} onClose={() => setPanel(null)} onOpen={(id) => { setPanel(null); onOpenChannel(id); }} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'leave' ? `Leave ${channel.label}?` : confirm.kind === 'archive' ? `Archive ${channel.label}?` : 'Delete this message?'}
          body={confirm.kind === 'leave' ? 'You can join public channels again from Browse.' : confirm.kind === 'archive' ? 'Members keep the history; nobody can post until it is unarchived.' : 'Everyone in the channel will see “Message deleted”.'}
          confirmLabel={confirm.kind === 'leave' ? 'Leave' : confirm.kind === 'archive' ? 'Archive' : 'Delete'}
          danger
          onConfirm={() => void confirmAction()}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}

/** Socket `chat:send` with an ack; falls back to REST (idempotent on clientMsgId). */
async function sendMessage(channelId: string, body: ChatSendBody): Promise<ChatMessageRow> {
  const s = getSocket();
  if (s?.connected) {
    const res = await new Promise<{ ok: boolean; message?: ChatMessageRow; error?: string } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000);
      s.emit('chat:send', { ...body, channelId }, (r: { ok: boolean; message?: ChatMessageRow; error?: string }) => {
        clearTimeout(timer);
        resolve(r);
      });
    });
    if (res?.ok && res.message) return res.message;
    if (res && !res.ok) throw new Error(res.error ?? 'Message not sent');
  }
  return hubApi.send(channelId, body);
}

function MembersModal({ channel, onClose }: { channel: ChatChannelRow; me: string; onClose: () => void }) {
  const qc = useQueryClient();
  const members = useQuery({ queryKey: hubKeys.members(channel.id), queryFn: () => hubApi.members(channel.id) });
  const people = useQuery({ queryKey: hubKeys.people, queryFn: hubApi.people, enabled: channel.canManage });
  const [add, setAdd] = useState<string[]>([]);
  const inv = [hubKeys.members(channel.id), hubKeys.channels];
  const addAct = useAction((ids: string[]) => hubApi.addMembers(channel.id, ids), { success: 'Members added', invalidate: inv, onSuccess: () => setAdd([]) });
  const removeAct = useAction((userId: string) => hubApi.removeMember(channel.id, userId), { success: 'Member removed', invalidate: inv });
  const current = new Set((members.data ?? []).map((m) => m.userId));
  const options = (people.data ?? []).filter((p) => !current.has(p.userId)).map((p) => ({ value: p.userId, label: p.name }));
  return (
    <Modal title={`Members · ${channel.label}`} onClose={onClose} actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {members.isLoading ? <Loading /> : (
        <div className="wp-member-list">
          {(members.data ?? []).map((m) => (
            <div key={m.userId} className="list-row">
              <span className="row" style={{ gap: 8 }}><span className={`wp-presence${m.online ? ' is-on' : ''}`} /> {m.name} <span className="muted">{m.title ?? ''}</span></span>
              <span className="row" style={{ gap: 8 }}>
                {m.role === 'OWNER' && <span className="tag tag-outline">Owner</span>}
                {m.managed && <span className="tag tag-neutral" title="Member through their department or project">Team</span>}
                {channel.canManage && !m.managed && m.role !== 'OWNER' && <button className="btn btn-ghost btn-sm" onClick={() => removeAct.mutate(m.userId)}>Remove</button>}
              </span>
            </div>
          ))}
        </div>
      )}
      {channel.canManage && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>Add people</label>
          <MultiSelect options={options} value={add} onChange={setAdd} />
          <button className="btn btn-primary btn-sm" style={{ marginTop: 8, alignSelf: 'flex-start' }} disabled={!add.length || addAct.isPending} onClick={() => addAct.mutate(add)}>Add</button>
        </div>
      )}
      {void qc}
    </Modal>
  );
}

function SearchModal({ channel, onClose, onOpen }: { channel: ChatChannelRow; onClose: () => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'here' | 'all'>('here');
  const [term, setTerm] = useState('');
  const res = useQuery({ queryKey: ['workplace', 'chat', 'search', term, scope, channel.id], queryFn: () => hubApi.search(term, scope === 'here' ? channel.id : undefined), enabled: term.length >= 2 });
  return (
    <Modal title="Search messages" onClose={onClose} wide actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <input className="input" autoFocus placeholder="Search text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search text" />
        <select className="input" style={{ maxWidth: 180 }} value={scope} onChange={(e) => setScope(e.target.value as 'here' | 'all')} aria-label="Where">
          <option value="here">In {channel.label}</option>
          <option value="all">All my channels</option>
        </select>
        <button className="btn btn-primary" type="submit" disabled={q.trim().length < 2}>Search</button>
      </form>
      <div style={{ marginTop: 12 }}>
        {term.length < 2 ? <div className="muted">Type at least 2 characters.</div> : res.isLoading ? <Loading /> : res.error ? <ErrorBlock error={res.error} /> : !res.data?.length ? <Empty>No messages match “{term}”.</Empty> : (
          res.data.map((h) => (
            <button key={h.messageId} className="wp-search-hit" onClick={() => onOpen(h.channelId)}>
              <span className="muted">{h.channelLabel} · {h.date} {h.t}</span>
              <span><strong>{h.who}</strong> {h.body}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

function BrowseModal({ canCreate, onClose, onOpen }: { canCreate: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [tab, setTab] = useState<'browse' | 'create'>('browse');
  const rows = useQuery({ queryKey: hubKeys.browse, queryFn: hubApi.browse });
  const people = useQuery({ queryKey: hubKeys.people, queryFn: hubApi.people, enabled: tab === 'create' });
  const lk = useLookups(['departments', 'projects']);
  const [form, setForm] = useState({ name: '', topic: '', kind: 'PUBLIC' as 'PUBLIC' | 'PRIVATE', link: '' as '' | 'DEPARTMENT' | 'PROJECT', linkedId: '', members: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function join(id: string) {
    try {
      await hubApi.joinChannel(id);
      await qc.invalidateQueries({ queryKey: hubKeys.chat });
      onOpen(id);
    } catch (e) {
      toastError(e);
    }
  }

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const c = await hubApi.createChannel({ name: form.name.trim().toLowerCase(), topic: form.topic || null, kind: form.kind, memberUserIds: form.members, linkedType: form.link || null, linkedId: form.link ? form.linkedId || null : null });
      toast(`${c.label} created`);
      await qc.invalidateQueries({ queryKey: hubKeys.chat });
      onOpen(c.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Channels" onClose={onClose} wide actions={tab === 'create' ? <><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || form.name.trim().length < 2 || (!!form.link && !form.linkedId)} onClick={() => void create()}>{busy ? 'Creating…' : 'Create channel'}</button></> : <button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <Tabs tabs={[{ value: 'browse' as const, label: 'Browse' }, ...(canCreate ? [{ value: 'create' as const, label: 'Create' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'browse' ? (
        rows.isLoading ? <Loading /> : (
          <div style={{ marginTop: 10 }}>
            {(rows.data ?? []).map((c) => (
              <div key={c.id} className="list-row">
                <span><strong>{c.label}</strong> <span className="muted">{c.topic ?? ''} · {c.memberCount} members</span></span>
                {c.joined ? <button className="btn btn-ghost btn-sm" onClick={() => onOpen(c.id)}>Open</button> : <button className="btn btn-secondary btn-sm" onClick={() => void join(c.id)}>Join</button>}
              </div>
            ))}
            {!canCreate && <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>Leads, managers, HR and Admin can create channels.</div>}
          </div>
        )
      ) : (
        <div className="form-grid" style={{ marginTop: 10 }}>
          <div className="field"><label htmlFor="ch-name">Name</label><input id="ch-name" className="input" placeholder="e.g. kestrel-app" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></div>
          <div className="field"><label htmlFor="ch-kind">Visibility</label><select id="ch-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'PUBLIC' | 'PRIVATE' })}><option value="PUBLIC">Public — anyone can join</option><option value="PRIVATE">Private — invite only</option></select></div>
          <div className="field span-2"><label htmlFor="ch-topic">Topic</label><input id="ch-topic" className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></div>
          <div className="field"><label htmlFor="ch-link">Members follow</label><select id="ch-link" className="input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value as '' | 'DEPARTMENT' | 'PROJECT', linkedId: '' })}><option value="">Nobody — invite people</option><option value="DEPARTMENT">A department</option><option value="PROJECT">A project</option></select></div>
          {form.link && (
            <div className="field"><label htmlFor="ch-ref">{form.link === 'DEPARTMENT' ? 'Department' : 'Project'}</label><select id="ch-ref" className="input" value={form.linkedId} onChange={(e) => setForm({ ...form, linkedId: e.target.value })}><option value="">Select…</option>{opts(lk.data, form.link === 'DEPARTMENT' ? 'departments' : 'projects').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          )}
          <div className="field span-2"><label>Invite people</label><MultiSelect options={(people.data ?? []).map((p: ChatPerson) => ({ value: p.userId, label: p.name }))} value={form.members} onChange={(v) => setForm({ ...form, members: v })} /></div>
          {err && <div className="field-error span-2" role="alert">{err}</div>}
        </div>
      )}
    </Modal>
  );
}

function NewMessageModal({ myUserId, onClose, onOpen }: { myUserId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { toastError } = useToast();
  const people = useQuery({ queryKey: hubKeys.people, queryFn: hubApi.people });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const rows = (people.data ?? []).filter((p) => p.userId !== myUserId && p.name.toLowerCase().includes(q.toLowerCase()));
  async function start() {
    setBusy(true);
    try {
      const c = await hubApi.openDm(picked);
      await qc.invalidateQueries({ queryKey: hubKeys.channels });
      onOpen(c.id);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="New message" onClose={onClose} actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!picked.length || busy} onClick={() => void start()}>{picked.length > 1 ? 'Start group chat' : 'Start chat'}</button></>}>
      <input className="input" placeholder="Search people" autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>Up to 8 people.</div>
      <div className="wp-people-pick">
        {people.isLoading ? <Loading /> : rows.map((p) => {
          const on = picked.includes(p.userId);
          return (
            <label key={p.userId} className="list-row" style={{ cursor: 'pointer' }}>
              <span className="row" style={{ gap: 8 }}><input type="checkbox" checked={on} disabled={!on && picked.length >= 8} onChange={() => setPicked((x) => (on ? x.filter((y) => y !== p.userId) : [...x, p.userId]))} /> <span className={`wp-presence${p.online ? ' is-on' : ''}`} /> {p.name}</span>
              <span className="muted">{p.title ?? ''}</span>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
