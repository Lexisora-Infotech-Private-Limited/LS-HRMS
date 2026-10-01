import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { FeedComment, FeedListResponse, FeedPostView } from '@lexisora/shared';
import { download } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { ConfirmDialog, Empty, ErrorBlock, Loading, Modal, Tag } from '@/components/ui';
import { ago, withFileTokens, wpApi, wpKeys } from '../api';
import { htmlText, RichTextEditor, SafeHtml } from '../components/RichText';
import '../workplace.css';

const PAGE = 10;
const TOOLS = ['B', 'I', 'H2', 'Link', 'Image', 'List'] as const;
const KINDS: { value: 'BLOG' | 'MILESTONE' | 'UPDATE'; label: string }[] = [
  { value: 'BLOG', label: 'Blog' },
  { value: 'MILESTONE', label: 'Milestone' },
  { value: 'UPDATE', label: 'Update' },
];
type Kind = (typeof KINDS)[number]['value'];
type FeedPages = InfiniteData<FeedListResponse, number>;

/** Company feed (wireframe "Company feed", spec §3): composer, posts, likes, comments, sidebar. */
export default function FeedPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const focusId = params.get('post');
  const canPublish = can('feed.publish');

  const feed = useInfiniteQuery({
    queryKey: [...wpKeys.feed, 'list'],
    queryFn: ({ pageParam }) => wpApi.feed({ page: pageParam, pageSize: PAGE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const focusLoaded = !!focusId && posts.some((p) => p.id === focusId);
  const focus = useQuery({ queryKey: [...wpKeys.feed, 'post', focusId], queryFn: () => wpApi.post(focusId!), enabled: !!focusId && !!feed.data && !focusLoaded, retry: false });

  // Live updates: new posts refetch; like/comment counters patch the cache in place.
  useEffect(() => onRealtime('feed:new', () => void qc.invalidateQueries({ queryKey: wpKeys.feed })), [qc]);
  useEffect(
    () =>
      onRealtime<{ postId: string; likeCount?: number; commentCount?: number }>('feed:like', (e) => patchPost(qc, e.postId, { likeCount: e.likeCount })),
    [qc],
  );
  useEffect(() => onRealtime<{ postId: string; commentCount?: number }>('feed:comment', (e) => patchPost(qc, e.postId, { commentCount: e.commentCount })), [qc]);

  // Deep link (?post=…): scroll the post into view once loaded.
  useEffect(() => {
    if (!focusId || !focusLoaded) return;
    const el = document.getElementById(`post-${focusId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusId, focusLoaded]);

  // Infinite scroll sentinel.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div data-screen-label="Company feed" className="wp-feed">
      <div className="stack" style={{ gap: 16 }}>
        <h2 style={{ margin: 0 }}>Company feed</h2>
        {canPublish && <Composer drafts={feed.data?.pages[0]?.drafts ?? 0} />}
        {feed.error && <ErrorBlock error={feed.error} retry={() => void feed.refetch()} />}
        {feed.isLoading && <Loading />}
        {focusId && !focusLoaded && focus.data && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row-between">
              <span className="eyebrow">Shared post</span>
              <button className="wp-link" onClick={() => setParams({})}>
                Back to the feed
              </button>
            </div>
            <PostCard p={focus.data} highlight />
          </div>
        )}
        {posts.map((p) => (
          <PostCard key={p.id} p={p} highlight={p.id === focusId} />
        ))}
        {feed.data && !posts.length && <Empty>Nothing on the feed yet{canPublish ? ' — write the first post above.' : '.'}</Empty>}
        <div ref={sentinel} />
        {feed.hasNextPage && (
          <button className="btn btn-secondary" style={{ alignSelf: 'center' }} disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
      <FeedSidebarPanel />
    </div>
  );
}

function patchPost(qc: ReturnType<typeof useQueryClient>, postId: string, patch: Partial<Pick<FeedPostView, 'likeCount' | 'commentCount' | 'liked'>>) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  qc.setQueryData<FeedPages>([...wpKeys.feed, 'list'], (d) =>
    d ? { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => (p.id === postId ? { ...p, ...clean } : p)) })) } : d,
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function FeedSidebarPanel() {
  const can = useCan();
  const { data } = useQuery({ queryKey: wpKeys.feedSidebar, queryFn: wpApi.feedSidebar });
  return (
    <aside className="stack wp-feed-side" style={{ gap: 12 }}>
      <h4 style={{ margin: 0 }}>Employee of the month</h4>
      {data?.eotm ? (
        <div className="card">
          <div className="card-kicker">{data.eotm.month}</div>
          <div className="card-title">{data.eotm.name}</div>
          <div className="card-body">{data.eotm.citation}</div>
        </div>
      ) : (
        <div className="card">
          <div className="card-body">{data ? 'Not announced yet this month.' : '…'}</div>
        </div>
      )}
      <h4 style={{ margin: '6px 0 0' }}>Kudos this week</h4>
      <div>
        {(data?.kudosThisWeek ?? []).map((k) => (
          <Link key={k.id} to="/kudos" className="wp-side-row">
            {k.text}
          </Link>
        ))}
        {data && !data.kudosThisWeek.length && <div className="wp-side-row faint">No kudos yet this week.</div>}
      </div>
      {can('kudos.give') && (
        <Link to="/kudos?give=1" className="wp-link">
          Give kudos
        </Link>
      )}
    </aside>
  );
}

// ── Composer ───────────────────────────────────────────────────────────────

type Draft = { id: string | null; title: string; kind: Kind; bodyHtml: string };
const EMPTY: Draft = { id: null, title: '', kind: 'BLOG', bodyHtml: '' };

/** New post / draft editor (and edit-in-place for published posts when `editing` is set). */
function Composer({ drafts, editing, onDone }: { drafts: number; editing?: FeedPostView; onDone?: () => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [d, setD] = useState<Draft>(() => (editing ? { id: editing.id, title: editing.title, kind: (editing.kind as Kind) ?? 'BLOG', bodyHtml: withFileTokens(editing.bodyHtml) } : EMPTY));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [menu, setMenu] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [autosaved, setAutosaved] = useState<string | null>(null);
  const draftList = useQuery({ queryKey: wpKeys.feedDrafts, queryFn: wpApi.feedDrafts, enabled: menu });
  const live = !!editing;

  const set = (patch: Partial<Draft>) => {
    setD((s) => ({ ...s, ...patch }));
    setDirty(true);
  };
  const empty = !d.title.trim() && !htmlText(d.bodyHtml);
  const payload = (action: 'draft' | 'publish') => ({ title: d.title.trim(), kind: d.kind, bodyHtml: d.bodyHtml, coverFileId: null, action });

  async function save(action: 'draft' | 'publish', silent = false) {
    if (!d.title.trim()) {
      if (!silent) toastError(new Error('Add a title first'));
      return;
    }
    if (action === 'publish' && !htmlText(d.bodyHtml) && !/<img/i.test(d.bodyHtml)) {
      toastError(new Error('Write something before publishing'));
      return;
    }
    setBusy(action);
    try {
      const saved = d.id ? await wpApi.updatePost(d.id, payload(live ? 'publish' : action)) : await wpApi.createPost(payload(action));
      setDirty(false);
      void qc.invalidateQueries({ queryKey: wpKeys.feed });
      if (live) {
        toast('Post updated');
        onDone?.();
      } else if (action === 'publish') {
        toast('Post published to feed');
        setD(EMPTY);
        setEditorKey((k) => k + 1);
        setAutosaved(null);
      } else {
        setD((s) => ({ ...s, id: saved.id }));
        if (silent) setAutosaved(new Date().toISOString());
        else toast('Draft saved');
      }
    } catch (e) {
      if (!silent) toastError(e);
    } finally {
      setBusy(null);
    }
  }

  // Autosave drafts every 10 s while there are unsaved changes.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (live) return;
    const t = window.setInterval(() => {
      if (dirty && d.title.trim() && !busy) void saveRef.current('draft', true);
    }, 10_000);
    return () => window.clearInterval(t);
  }, [dirty, d.title, busy, live]);

  async function open(id: string) {
    setMenu(false);
    try {
      const p = await wpApi.post(id);
      setD({ id: p.id, title: p.title, kind: (p.kind as Kind) ?? 'BLOG', bodyHtml: withFileTokens(p.bodyHtml) });
      setEditorKey((k) => k + 1);
      setDirty(false);
      setAutosaved(null);
    } catch (e) {
      toastError(e);
    }
  }

  const removeDraft = useAction(() => wpApi.deleteDraft(d.id!), {
    success: 'Draft deleted',
    invalidate: [wpKeys.feed],
    onSuccess: () => {
      setD(EMPTY);
      setEditorKey((k) => k + 1);
      setDiscard(false);
    },
  });

  return (
    <div className={live ? 'stack' : 'card wp-composer'} style={{ gap: 10 }}>
      <div className="wp-composer-head">
        <input className="input" placeholder="Title" aria-label="Title" maxLength={150} value={d.title} onChange={(e) => set({ title: e.target.value })} />
        <select className="input" aria-label="Kind" value={d.kind} onChange={(e) => set({ kind: e.target.value as Kind })} style={{ width: 'auto' }}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {!live && (
          <div className="wp-menu-anchor">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
              My drafts{drafts ? ` (${drafts})` : ''}
            </button>
            {menu && (
              <div className="menu" style={{ minWidth: 260 }} onMouseLeave={() => setMenu(false)}>
                {draftList.isLoading && <span className="faint" style={{ padding: 8 }}>Loading…</span>}
                {draftList.data?.map((x) => (
                  <button key={x.id} onClick={() => void open(x.id)}>
                    <div>{x.title}</div>
                    <div className="faint" style={{ fontSize: 11.5 }}>
                      Draft · saved {ago(x.updatedAt)}
                    </div>
                  </button>
                ))}
                {draftList.data && !draftList.data.length && <span className="faint" style={{ padding: 8, fontSize: 13 }}>No drafts.</span>}
              </div>
            )}
          </div>
        )}
      </div>
      <RichTextEditor key={editorKey} value={d.bodyHtml} onChange={(html) => set({ bodyHtml: html })} placeholder="Write a blog post, milestone or update…" tools={[...TOOLS]} minHeight={70} variant="plain" />
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        {!live && autosaved && <span className="faint" style={{ fontSize: 12, marginRight: 'auto' }}>Draft autosaved {ago(autosaved)}</span>}
        {!live && d.id && (
          <button className="btn btn-ghost" onClick={() => setDiscard(true)}>
            Delete draft
          </button>
        )}
        {live ? (
          <>
            <button className="btn btn-secondary" onClick={onDone}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void save('publish')}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" disabled={!!busy || empty} onClick={() => void save('draft')}>
              {busy === 'draft' ? 'Saving…' : 'Save draft'}
            </button>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void save('publish')}>
              {busy === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
          </>
        )}
      </div>
      {discard && <ConfirmDialog title="Delete this draft?" body="The draft will be removed. This cannot be undone." confirmLabel="Delete draft" danger busy={removeDraft.isPending} onConfirm={() => removeDraft.mutate(undefined)} onClose={() => setDiscard(false)} />}
    </div>
  );
}

// ── Post card ──────────────────────────────────────────────────────────────

function PostCard({ p, highlight }: { p: FeedPostView; highlight?: boolean }) {
  const qc = useQueryClient();
  const { toastError } = useToast();
  const [liked, setLiked] = useState(p.liked);
  const [likes, setLikes] = useState(p.likeCount);
  const [open, setOpen] = useState(highlight ?? false);
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busyLike, setBusyLike] = useState(false);
  useEffect(() => {
    setLiked(p.liked);
    setLikes(p.likeCount);
  }, [p.liked, p.likeCount]);

  const long = htmlText(p.bodyHtml).length > 600;
  const html = useMemo(() => withFileTokens(p.bodyHtml), [p.bodyHtml]);

  async function toggleLike() {
    if (busyLike) return;
    const next = !liked;
    setBusyLike(true);
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    try {
      const r = await wpApi.like(p.id, next);
      setLikes(r.likeCount);
      patchPost(qc, p.id, { liked: next, likeCount: r.likeCount });
    } catch (e) {
      setLiked(!next);
      setLikes(p.likeCount);
      toastError(e);
    } finally {
      setBusyLike(false);
    }
  }

  const inv = [wpKeys.feed];
  const pin = useAction((on: boolean) => wpApi.pinPost(p.id, on), { success: (_r, on) => (on ? 'Pinned to the top of the feed' : 'Unpinned'), invalidate: inv });
  const archive = useAction(() => wpApi.archivePost(p.id), { success: 'Post archived', invalidate: inv, onSuccess: () => setConfirmArchive(false) });

  return (
    <article id={`post-${p.id}`} className={`wp-post${highlight ? ' wp-post-focus' : ''}${p.kind === 'KUDOS' ? ' wp-post-kudos' : ''}`}>
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="wp-post-avatar">{p.author.initials}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14 }}>{p.author.name}</div>
          <div style={{ fontSize: 11.5 }} className="faint">
            {p.author.meta}
            {p.editedAt && ' · edited'}
            {p.pinned && ' · Pinned'}
          </div>
        </div>
        <Tag tone="accent">{p.kindLabel}</Tag>
        {p.canModerate && (
          <div className="wp-menu-anchor" style={{ alignSelf: 'center' }}>
            <button className="btn btn-ghost btn-sm" aria-label="Post actions" onClick={() => setMenu((m) => !m)}>
              ⋯
            </button>
            {menu && (
              <div className="menu" style={{ right: 0, left: 'auto' }} onMouseLeave={() => setMenu(false)}>
                <button
                  onClick={() => {
                    setMenu(false);
                    pin.mutate(!p.pinned);
                  }}
                >
                  {p.pinned ? 'Unpin' : 'Pin to top'}
                </button>
                {p.canEdit && (
                  <button
                    onClick={() => {
                      setMenu(false);
                      setEdit(true);
                    }}
                  >
                    Edit post
                  </button>
                )}
                <button
                  onClick={() => {
                    setMenu(false);
                    setConfirmArchive(true);
                  }}
                >
                  Archive
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="wp-post-title">{p.title}</div>
      <div className={`wp-post-body${long && !expanded ? ' clamped' : ''}`}>
        <SafeHtml html={html} />
      </div>
      {long && (
        <button className="wp-link" style={{ alignSelf: 'flex-start' }} onClick={() => setExpanded((x) => !x)}>
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
      <div className="row" style={{ gap: 16, fontSize: 13 }}>
        <button className="wp-link" aria-pressed={liked} onClick={() => void toggleLike()}>
          {liked ? 'Liked' : 'Like'} · {likes}
        </button>
        <button className="wp-link wp-link-plain" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {p.commentCount} comment{p.commentCount === 1 ? '' : 's'}
        </button>
        {p.certificateId && (
          <button className="wp-link" onClick={() => void download(wpApi.certificatePdfPath(p.certificateId!)).catch(toastError)}>
            Download certificate
          </button>
        )}
      </div>
      {open && <Comments post={p} />}
      {edit && (
        <Modal title="Edit post" onClose={() => setEdit(false)} wide>
          <Composer drafts={0} editing={p} onDone={() => setEdit(false)} />
        </Modal>
      )}
      {confirmArchive && (
        <ConfirmDialog
          title="Archive this post?"
          body="It disappears from the feed for everyone. Likes and comments are kept."
          confirmLabel="Archive"
          busy={archive.isPending}
          onConfirm={() => archive.mutate(undefined)}
          onClose={() => setConfirmArchive(false)}
        />
      )}
    </article>
  );
}

// ── Comments ───────────────────────────────────────────────────────────────

function Comments({ post }: { post: FeedPostView }) {
  const qc = useQueryClient();
  const { toastError } = useToast();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.comments(post.id), queryFn: () => wpApi.comments(post.id) });
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => onRealtime<{ postId: string }>('feed:comment', (e) => e.postId === post.id && void refetch()), [post.id, refetch]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const rows = await wpApi.addComment(post.id, text, replyTo?.id ?? null);
      qc.setQueryData(wpKeys.comments(post.id), rows);
      patchPost(qc, post.id, { commentCount: rows.filter((r) => !r.deleted).length });
      setBody('');
      setReplyTo(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const remove = useAction((id: string) => wpApi.deleteComment(id), {
    success: 'Comment deleted',
    onSuccess: (r) => {
      patchPost(qc, post.id, { commentCount: r.commentCount });
      void refetch();
    },
  });

  const top = (data ?? []).filter((c) => !c.parentId);
  const replies = (id: string) => (data ?? []).filter((c) => c.parentId === id);

  return (
    <div className="wp-comments">
      {isLoading && <Loading />}
      {error && <ErrorBlock error={error} retry={() => void refetch()} />}
      {top.map((c) => (
        <div key={c.id} className="stack" style={{ gap: 6 }}>
          <CommentRow c={c} onReply={post.canComment ? () => setReplyTo(c) : undefined} onDelete={() => remove.mutate(c.id)} />
          {replies(c.id).map((r) => (
            <div key={r.id} style={{ marginLeft: 34 }}>
              <CommentRow c={r} onDelete={() => remove.mutate(r.id)} />
            </div>
          ))}
        </div>
      ))}
      {data && !data.length && <div className="faint" style={{ fontSize: 13 }}>No comments yet — start the conversation.</div>}
      {post.canComment ? (
        <div className="stack" style={{ gap: 6 }}>
          {replyTo && (
            <div className="faint" style={{ fontSize: 12 }}>
              Replying to {replyTo.authorName} ·{' '}
              <button className="wp-link" style={{ fontSize: 12 }} onClick={() => setReplyTo(null)}>
                cancel
              </button>
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <input
              className="input"
              placeholder="Write a comment… (type @name to mention someone)"
              aria-label="Comment"
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn btn-primary" disabled={busy || !body.trim()} onClick={() => void send()}>
              {busy ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </div>
      ) : (
        <div className="faint" style={{ fontSize: 12.5 }}>Comments are closed on archived posts.</div>
      )}
    </div>
  );
}

function CommentRow({ c, onReply, onDelete }: { c: FeedComment; onReply?: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <span className="wp-comment-avatar">{c.initials}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5 }}>
          <strong style={{ fontWeight: 600 }}>{c.authorName}</strong> <span className="faint">{ago(c.createdAt)}</span>
        </div>
        <div style={{ fontSize: 14 }} className={c.deleted ? 'faint' : undefined}>
          {c.body}
        </div>
        <div className="row" style={{ gap: 12 }}>
          {onReply && !c.deleted && (
            <button className="wp-link" style={{ fontSize: 12 }} onClick={onReply}>
              Reply
            </button>
          )}
          {c.canDelete && (
            <button className="wp-link" style={{ fontSize: 12 }} onClick={() => setConfirm(true)}>
              Delete
            </button>
          )}
        </div>
      </div>
      {confirm && (
        <ConfirmDialog
          title="Delete this comment?"
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setConfirm(false);
            onDelete();
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
