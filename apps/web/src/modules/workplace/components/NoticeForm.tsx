import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoticeDetail } from '@lexisora/shared';
import { HttpError, uploadFile } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Check, ConfirmDialog, Modal } from '@/components/ui';
import { FileDrop } from '@/components/form';
import { fileSize, fromLocalInput, toLocalInput, wpApi, wpKeys, type NoticeSave } from '../api';
import { htmlText, RichTextEditor } from './RichText';

type Att = { fileId: string; name: string; size: number };
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx,application/pdf,image/png,image/jpeg';
const MAX_BYTES = 10 * 1024 * 1024;

/** FORMS.notice — "Publish notice": Title, Visibility, Team, Body, Attachment (+ advanced). */
export function NoticeFormModal({ notice, onClose, onSaved }: { notice?: NoticeDetail | null; onClose: () => void; onSaved?: (n: NoticeDetail) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const opts = useQuery({ queryKey: wpKeys.noticeAudiences, queryFn: wpApi.noticeAudiences, staleTime: 60_000 });
  const live = !!notice && (notice.status === 'PUBLISHED' || notice.status === 'EXPIRED');

  const [title, setTitle] = useState(notice?.title ?? '');
  const [vis, setVis] = useState<'GLOBAL' | 'TEAM' | null>(notice?.visibility ?? null);
  const [teams, setTeams] = useState<string[]>(() => (notice?.audiences ?? []).filter((a) => a.refId && (a.type === 'DEPARTMENT' || a.type === 'PROJECT')).map((a) => `${a.type === 'DEPARTMENT' ? 'D' : 'P'}:${a.refId}`));
  const [html, setHtml] = useState(notice?.bodyHtml ?? '');
  const [files, setFiles] = useState<Att[]>(() => (notice?.attachments ?? []).map((a) => ({ fileId: a.fileId, name: a.name, size: a.sizeBytes })));
  const [uploading, setUploading] = useState(false);
  const [showAdv, setShowAdv] = useState(!!(notice?.publishAt || notice?.expiresAt || notice?.pinned));
  const [publishAt, setPublishAt] = useState(toLocalInput(notice?.publishAt));
  const [expiresAt, setExpiresAt] = useState(toLocalInput(notice?.expiresAt));
  const [pinned, setPinned] = useState(notice?.pinned ?? false);
  const [email, setEmail] = useState<boolean | null>(notice ? notice.emailRecipients : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState<'draft' | 'publish' | null>(null);

  const o = opts.data;
  const visibility: 'GLOBAL' | 'TEAM' = vis ?? (o?.canGlobal ? 'GLOBAL' : 'TEAM');
  const emailOn = email ?? visibility === 'GLOBAL';
  const scheduled = !live && !!publishAt && new Date(fromLocalInput(publishAt)!).getTime() > Date.now() + 60_000;
  const teamOptions = [...(o?.departments ?? []).map((d) => ({ key: `D:${d.value}`, label: d.label, group: 'Departments' })), ...(o?.projects ?? []).map((p) => ({ key: `P:${p.value}`, label: p.label, group: 'Projects' }))];
  // Keep already-chosen teams visible even if the options list no longer includes them.
  const known = new Set(teamOptions.map((t) => t.key));
  const extra = (notice?.audiences ?? []).filter((a) => a.refId && !known.has(`${a.type === 'DEPARTMENT' ? 'D' : 'P'}:${a.refId}`) && (a.type === 'DEPARTMENT' || a.type === 'PROJECT'));

  async function addFile(f: File | null) {
    if (!f) return;
    if (files.length >= 5) return setErrors((e) => ({ ...e, files: 'Up to 5 attachments' }));
    if (f.size > MAX_BYTES) return setErrors((e) => ({ ...e, files: `${f.name} is larger than 10 MB` }));
    setUploading(true);
    try {
      const up = await uploadFile(f, 'notice');
      setFiles((s) => [...s, { fileId: up.id, name: up.filename, size: up.size }]);
      setErrors(({ files: _f, ...rest }) => rest);
    } catch (e) {
      setErrors((s) => ({ ...s, files: (e as Error).message }));
    } finally {
      setUploading(false);
    }
  }

  async function submit(action: 'draft' | 'publish', force = false) {
    const errs: Record<string, string> = {};
    if (title.trim().length < 5) errs.title = 'Title needs at least 5 characters';
    if (visibility === 'TEAM' && !teams.length && !live) errs.teams = 'Pick at least one team';
    if (action === 'publish' && !htmlText(html) && !files.length) errs.body = 'Write the notice or attach a file';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body: NoticeSave = {
      title: title.trim(),
      visibility,
      audiences: visibility === 'TEAM' ? (live ? notice!.audiences : teams.map((k) => ({ type: k.startsWith('D:') ? ('DEPARTMENT' as const) : ('PROJECT' as const), refId: k.slice(2) }))) : [],
      bodyHtml: html,
      attachmentFileIds: files.map((f) => f.fileId),
      publishAt: live ? notice!.publishAt : fromLocalInput(publishAt),
      expiresAt: fromLocalInput(expiresAt),
      pinned,
      emailRecipients: emailOn,
      action,
      force,
    };
    setBusy(true);
    setFormError(null);
    try {
      const saved = notice ? await wpApi.updateNotice(notice.id, body) : await wpApi.createNotice(body);
      void qc.invalidateQueries({ queryKey: wpKeys.notices });
      void qc.invalidateQueries({ queryKey: wpKeys.dashboard });
      toast(live ? 'Notice updated' : action === 'draft' ? 'Draft saved' : saved.status === 'SCHEDULED' ? 'Notice scheduled' : 'Notice published');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof HttpError && e.code === 'NOTICE_AUDIENCE_EMPTY') {
        setConfirmEmpty(action);
      } else if (e instanceof HttpError && e.details && typeof e.details === 'object' && 'fieldErrors' in (e.details as object)) {
        const fe = (e.details as { fieldErrors: Record<string, string[]> }).fieldErrors;
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k === 'audiences' ? 'teams' : k, v[0] ?? 'Invalid'])));
        setFormError(e.message);
      } else setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggleTeam = (k: string, on: boolean) => setTeams((s) => (on ? [...new Set([...s, k])] : s.filter((x) => x !== k)));
  const primaryLabel = live ? 'Save changes' : scheduled ? 'Schedule' : 'Publish';

  return (
    <>
      <Modal
        title={notice ? (live ? 'Edit notice' : 'Edit draft') : 'Publish notice'}
        onClose={onClose}
        wide
        actions={
          <>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            {!live && (
              <button className="btn btn-secondary" disabled={busy || uploading} onClick={() => void submit('draft')}>
                Save draft
              </button>
            )}
            <button className="btn btn-primary" disabled={busy || uploading} onClick={() => void submit('publish')}>
              {busy ? 'Saving…' : primaryLabel}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="n-title">Title</label>
            <input id="n-title" className="input" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title || undefined} />
            {errors.title && <div className="field-error">{errors.title}</div>}
          </div>
          <div className="field">
            <label htmlFor="n-vis">Visibility</label>
            <select id="n-vis" className="input" value={visibility} disabled={live || !o} onChange={(e) => setVis(e.target.value as 'GLOBAL' | 'TEAM')}>
              {(o?.canGlobal || visibility === 'GLOBAL') && <option value="GLOBAL">Global · everyone</option>}
              <option value="TEAM">Team-specific</option>
            </select>
            {live && <div className="field-hint">The audience can’t change after publishing.</div>}
          </div>
          <div className="field">
            <label>Notify</label>
            <label className="radio" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={emailOn} disabled={live} onChange={(e) => setEmail(e.target.checked)} />
              <span className="dot" style={{ borderRadius: 3 }} />
              Also email recipients
            </label>
          </div>
          <div className="field span-2">
            <label>Team</label>
            <div className={`wp-team-pick${visibility === 'GLOBAL' || live ? ' disabled' : ''}`} aria-disabled={visibility === 'GLOBAL' || live}>
              {(['Departments', 'Projects'] as const).map((g) => {
                const list = teamOptions.filter((t) => t.group === g);
                return (
                  <div key={g}>
                    <div className="eyebrow">{g}</div>
                    {list.map((t) => (
                      <label key={t.key} className="wp-team-opt">
                        <Check checked={teams.includes(t.key)} onChange={(on) => toggleTeam(t.key, on)} label={t.label} />
                        <span onClick={() => toggleTeam(t.key, !teams.includes(t.key))}>{t.label}</span>
                      </label>
                    ))}
                    {g === 'Departments' &&
                      extra.filter((a) => a.type === 'DEPARTMENT').map((a) => (
                        <div key={a.refId!} className="wp-team-opt faint">{a.label ?? 'Department'}</div>
                      ))}
                    {g === 'Projects' &&
                      extra.filter((a) => a.type === 'PROJECT').map((a) => (
                        <div key={a.refId!} className="wp-team-opt faint">{a.label ?? 'Project'}</div>
                      ))}
                    {!list.length && <div className="faint" style={{ fontSize: 12.5 }}>{o ? (o.anyTeam ? 'None yet' : 'None that you lead') : 'Loading…'}</div>}
                  </div>
                );
              })}
            </div>
            {errors.teams ? <div className="field-error">{errors.teams}</div> : visibility === 'TEAM' && !o?.anyTeam && <div className="field-hint">You can publish to teams you lead or manage.</div>}
          </div>
          <div className="field span-2">
            <label>Body</label>
            <RichTextEditor value={html} onChange={setHtml} placeholder="What should people know?" />
            {errors.body && <div className="field-error">{errors.body}</div>}
          </div>
          <div className="field span-2">
            <label>Attachment</label>
            {files.map((f) => (
              <div key={f.fileId} className="wp-file-row">
                <span>
                  {f.name} <span className="faint">· {fileSize(f.size)}</span>
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFiles((s) => s.filter((x) => x.fileId !== f.fileId))}>
                  Remove
                </button>
              </div>
            ))}
            {files.length < 5 && <FileDrop file={null} onFile={(f) => void addFile(f)} accept={ACCEPT} label={uploading ? 'Uploading…' : 'Drop file or browse'} />}
            {errors.files ? <div className="field-error">{errors.files}</div> : <div className="field-hint">Up to 5 files, 10 MB each · PDF, PNG, JPG, DOCX, XLSX</div>}
          </div>
          <div className="field span-2 wp-advanced">
            <button type="button" className="wp-link" onClick={() => setShowAdv((s) => !s)}>
              {showAdv ? '− Hide advanced' : '+ Advanced: schedule, expiry, pin'}
            </button>
          </div>
          {showAdv && (
            <>
              <div className="field">
                <label htmlFor="n-at">Publish at</label>
                <input id="n-at" className="input" type="datetime-local" value={publishAt} disabled={live} onChange={(e) => setPublishAt(e.target.value)} />
                <div className="field-hint">{live ? 'Already published' : 'Leave empty to publish now'}</div>
              </div>
              <div className="field">
                <label htmlFor="n-exp">Expires on</label>
                <input id="n-exp" className="input" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                {errors.expiresAt && <div className="field-error">{errors.expiresAt}</div>}
              </div>
              {o?.canPin && (
                <div className="field span-2">
                  <label className="radio">
                    <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                    <span className="dot" style={{ borderRadius: 3 }} />
                    Pin to top
                  </label>
                </div>
              )}
            </>
          )}
        </div>
        {formError && (
          <div className="field-error" role="alert">
            {formError}
          </div>
        )}
      </Modal>
      {confirmEmpty && (
        <ConfirmDialog
          title="Nobody is in this audience yet"
          body="The selected teams have no active members right now. People who join later will still receive this notice. Publish anyway?"
          confirmLabel="Publish anyway"
          busy={busy}
          onClose={() => setConfirmEmpty(null)}
          onConfirm={() => {
            const a = confirmEmpty;
            setConfirmEmpty(null);
            void submit(a, true);
          }}
        />
      )}
    </>
  );
}
