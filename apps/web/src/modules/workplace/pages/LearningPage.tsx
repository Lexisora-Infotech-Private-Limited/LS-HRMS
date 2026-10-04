import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { CourseDetail, CourseTile, LessonRow, ManageCourseRow } from '@lexisora/shared';
import { download, fileUrl, uploadFile } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { ConfirmDialog, Empty, ErrorBlock, Loading, Modal, PageHeader, Tabs, Tag } from '@/components/ui';
import { DataTable, type Column } from '@/components/table';
import { FileDrop, type Option } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { hubApi, hubKeys } from '../api-b';
import '../workplace.css';
import '../hub.css';

type Tab = 'my' | 'catalogue' | 'certificates' | 'manage';
const HEARTBEAT_MS = 15_000;

/** Learning — GEN.lms tiles + FORMS.course (spec §7). */
export default function LearningPage() {
  const can = useCan();
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'my';
  const courseId = params.get('course');
  const editId = params.get('edit');
  const [upload, setUpload] = useState(false);
  const manage = can('lms.manage');
  const tiles = useQuery({ queryKey: hubKeys.lmsTiles(tab === 'manage' ? 'my' : tab), queryFn: () => hubApi.tiles(tab === 'manage' ? 'my' : tab), enabled: tab !== 'manage' });
  const counts = tiles.data?.counts;
  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
      return n;
    });

  async function act(t: CourseTile) {
    try {
      if (t.cta === 'Download certificate' && t.enrollmentId) {
        await download(`/lms/enrollments/${t.enrollmentId}/certificate`);
        await qc.invalidateQueries({ queryKey: hubKeys.lms });
        return;
      }
      if (t.cta === 'Enroll') {
        await hubApi.enroll(t.courseId);
        toast(`Enrolled in ${t.title}`);
        await qc.invalidateQueries({ queryKey: hubKeys.lms });
      }
      set({ course: t.courseId });
    } catch (e) {
      toastError(e);
    }
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'my', label: `My learning${counts ? ` · ${counts.my}` : ''}` },
    { value: 'catalogue', label: `Catalogue${counts ? ` · ${counts.catalogue}` : ''}` },
    { value: 'certificates', label: `Certificates${counts ? ` · ${counts.certificates}` : ''}` },
    ...(manage ? [{ value: 'manage' as const, label: 'Manage courses' }] : []),
  ];

  return (
    <div data-screen-label="Learning" className="stack" style={{ gap: 20 }}>
      <PageHeader
        title="Learning"
        sub="Training videos and coding guidelines. Certificates issue automatically on completion."
        actions={manage ? <button className="btn btn-primary" onClick={() => setUpload(true)}>Upload course</button> : undefined}
      />
      <Tabs tabs={tabs} value={tab} onChange={(v) => set({ tab: v === 'my' ? null : v })} />
      {tab === 'manage' ? (
        <ManageCourses onOpen={(id) => set({ edit: id })} />
      ) : tiles.isLoading ? (
        <Loading />
      ) : tiles.error ? (
        <ErrorBlock error={tiles.error} retry={() => void tiles.refetch()} />
      ) : !tiles.data?.items.length ? (
        <Empty>{tab === 'catalogue' ? 'You are enrolled in every published course.' : tab === 'certificates' ? 'Complete a course to earn your first certificate.' : 'No courses assigned to you yet. Browse the catalogue to enrol.'}</Empty>
      ) : (
        <div className="wp-tiles">
          {tiles.data.items.map((t) => (
            <div key={t.courseId} className="card wp-tile">
              <button className="placeholder-media" style={{ cursor: 'pointer', font: 'inherit' }} onClick={() => set({ course: t.courseId })} aria-label={`Open ${t.title}`}>{t.media}</button>
              <div className="card-kicker">{t.kicker}</div>
              <div className="card-title">{t.title}</div>
              <div className="card-body">{t.statusLine}</div>
              {t.status === 'IN_PROGRESS' || t.status === 'OVERDUE' ? <div className="wp-progress" aria-label={`${t.progressPct}% complete`}><span style={{ width: `${t.progressPct}%` }} /></div> : null}
              <div className="wp-tile-foot">
                <button className="btn btn-ghost" onClick={() => void act(t)}>{t.cta}</button>
                {t.dueLabel && <Tag tone={t.overdue ? 'outline' : 'neutral'}>{t.overdue ? `Overdue · ${t.dueLabel.replace('Due ', '')}` : t.dueLabel}</Tag>}
              </div>
            </div>
          ))}
        </div>
      )}
      {courseId && <CoursePlayer id={courseId} onClose={() => set({ course: null })} />}
      {editId && manage && <CourseEditor id={editId} onClose={() => set({ edit: null })} />}
      {upload && <UploadCourse onClose={() => setUpload(false)} onCreated={(id) => { setUpload(false); set({ tab: 'manage', edit: id }); }} />}
    </div>
  );
}

// ── Player ───────────────────────────────────────────────────────────────

function CoursePlayer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const course = useQuery({ queryKey: hubKeys.course(id), queryFn: () => hubApi.course(id) });
  const [lessonId, setLessonId] = useState<string | null>(null);
  const d = course.data;
  useEffect(() => {
    if (d && !lessonId) setLessonId(d.nextLessonId ?? d.lessons[0]?.id ?? null);
  }, [d, lessonId]);
  const lesson = d?.lessons.find((l) => l.id === lessonId) ?? null;
  const idx = d && lesson ? d.lessons.findIndex((l) => l.id === lesson.id) : -1;

  function onProgress(r: { courseCompleted: boolean; certificateId: string | null; done: boolean }, wasComplete: boolean) {
    void qc.invalidateQueries({ queryKey: hubKeys.course(id) });
    void qc.invalidateQueries({ queryKey: hubKeys.lms });
    if (r.courseCompleted && !wasComplete) toast(r.certificateId ? 'Course completed · certificate ready' : 'Course completed');
  }

  async function enroll() {
    try {
      await hubApi.enroll(id);
      await qc.invalidateQueries({ queryKey: hubKeys.lms });
      toast(`Enrolled in ${d?.title ?? 'the course'}`);
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Modal title={d?.title ?? 'Course'} onClose={onClose} wide actions={<>
      {d?.enrollment?.certificateId && <button className="btn btn-secondary" onClick={() => void download(`/lms/enrollments/${d.enrollment!.id}/certificate`).then(() => qc.invalidateQueries({ queryKey: hubKeys.lms })).catch(toastError)}>Download certificate</button>}
      {d && idx >= 0 && idx < d.lessons.length - 1 && <button className="btn btn-secondary" onClick={() => setLessonId(d.lessons[idx + 1]!.id)}>Next lesson</button>}
      <button className="btn btn-primary" onClick={onClose}>Close</button>
    </>}>
      {course.isLoading ? <Loading /> : course.error ? <ErrorBlock error={course.error} /> : d && (
        <>
          <div className="row-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div className="kicker">{d.kicker}{d.enrollment ? ` · ${d.enrollment.status === 'COMPLETED' ? 'Completed' : `${d.enrollment.lessonsDone} of ${d.lessons.length} lessons done`}` : ''}</div>
            {d.enrollment?.dueLabel && <Tag tone={d.enrollment.overdue ? 'outline' : 'neutral'}>{d.enrollment.dueLabel}</Tag>}
          </div>
          {d.description && <p className="muted" style={{ marginTop: 0 }}>{d.description}</p>}
          {!d.enrollment && d.canEnroll && <div className="note" style={{ marginBottom: 12 }}>You are not enrolled. <button className="wp-link" onClick={() => void enroll()}>Enroll</button> to track your progress.</div>}
          <div className="wp-player">
            <nav className="wp-lessons" aria-label="Lessons">
              {d.lessons.map((l) => (
                <button key={l.id} className={`wp-lesson${l.id === lessonId ? ' is-active' : ''}`} onClick={() => setLessonId(l.id)}>
                  <span className={`wp-lesson-check${l.done ? ' is-done' : ''}`} aria-label={l.done ? 'Done' : 'Not done'}>{l.done ? '✓' : ''}</span>
                  <span><span>{l.order}. {l.title}</span><br /><span className="muted" style={{ fontSize: 11.5 }}>{l.type === 'DOCUMENT' ? 'Document' : 'Video'} · {l.durationLabel}{!l.done && l.watchedPct ? ` · ${l.watchedPct}%` : ''}</span></span>
                </button>
              ))}
            </nav>
            <div>{lesson ? <LessonView key={lesson.id} lesson={lesson} enrolled={!!d.enrollment || d.canEnroll} completed={d.enrollment?.status === 'COMPLETED'} onProgress={onProgress} /> : <Empty>This course has no lessons yet.</Empty>}</div>
          </div>
        </>
      )}
    </Modal>
  );
}

function LessonView({ lesson, enrolled, completed, onProgress }: { lesson: LessonRow; enrolled: boolean; completed: boolean; onProgress: (r: { courseCompleted: boolean; certificateId: string | null; done: boolean }, wasComplete: boolean) => void }) {
  const { toastError } = useToast();
  const video = useRef<HTMLVideoElement>(null);
  const lastSent = useRef(0);
  const [rate, setRate] = useState(1);
  const [readyToMark, setReadyToMark] = useState(lesson.type !== 'DOCUMENT');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(lesson.done);

  useEffect(() => {
    if (lesson.type !== 'DOCUMENT') return;
    const t = setTimeout(() => setReadyToMark(true), 10_000);
    return () => clearTimeout(t);
  }, [lesson.type]);

  async function beat(force = false) {
    const v = video.current;
    if (!v || !enrolled || done) return;
    const now = Date.now();
    if (!force && now - lastSent.current < HEARTBEAT_MS) return;
    lastSent.current = now;
    try {
      const r = await hubApi.heartbeat(lesson.id, v.currentTime, v.playbackRate);
      if (r.done && !done) {
        setDone(true);
        onProgress(r, completed);
      }
    } catch {
      /* the next heartbeat retries */
    }
  }

  async function mark() {
    setBusy(true);
    try {
      const r = await hubApi.completeLesson(lesson.id);
      setDone(true);
      onProgress(r, completed);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="card-title">{lesson.title}</div>
      {lesson.type === 'VIDEO' && lesson.fileId ? (
        <>
          <video
            ref={video}
            src={fileUrl(lesson.fileId)}
            controls
            preload="metadata"
            onLoadedMetadata={(e) => { if (lesson.positionSec && !lesson.done) e.currentTarget.currentTime = lesson.positionSec; }}
            onTimeUpdate={() => void beat()}
            onPause={() => void beat(true)}
            onEnded={() => void beat(true)}
          />
          <div className="row" style={{ gap: 8, fontSize: 13 }}>
            <label htmlFor="rate">Speed</label>
            <select id="rate" className="input" style={{ width: 90 }} value={rate} onChange={(e) => { const r = Number(e.target.value); setRate(r); if (video.current) video.current.playbackRate = r; }}>
              {[0.75, 1, 1.25, 1.5].map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
            <span className="muted">{done ? 'Completed' : `Watched ${lesson.watchedPct}% · completes at 90%`}</span>
          </div>
        </>
      ) : lesson.type === 'DOCUMENT' && lesson.fileId ? (
        <iframe src={fileUrl(lesson.fileId)} title={lesson.title} style={{ aspectRatio: '4/3' }} />
      ) : (
        <div className="placeholder-media" style={{ aspectRatio: '16/9' }}>{lesson.type === 'DOCUMENT' ? 'Document' : 'Video'}</div>
      )}
      {lesson.content && <p style={{ margin: 0, fontSize: 13.5 }}>{lesson.content}</p>}
      {(lesson.type === 'DOCUMENT' || !lesson.fileId) && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary" disabled={done || busy || !readyToMark || !enrolled} onClick={() => void mark()}>{done ? (lesson.type === 'DOCUMENT' ? 'Read' : 'Done') : lesson.type === 'DOCUMENT' ? 'Mark as read' : 'Mark as done'}</button>
          {!readyToMark && !done && <span className="muted" style={{ fontSize: 12.5 }}>Available after 10 seconds of reading</span>}
        </div>
      )}
    </div>
  );
}

// ── Upload course (FORMS.course) ─────────────────────────────────────────

function useAssignOptions(): { options: Option[]; parse: (v: string) => { type: string; refId: string | null; label: string | null } | null } {
  const lk = useLookups(['departments', 'projects']);
  return useMemo(() => {
    const depts = opts(lk.data, 'departments');
    const projects = opts(lk.data, 'projects');
    const deptLabel = (name: string) => (name === 'Development' ? 'All developers' : name === 'QA' ? 'QA team' : `${name} team`);
    const options: Option[] = [
      ...depts.filter((d) => d.label === 'Development').map((d) => ({ value: `DEPARTMENT:${d.value}`, label: deptLabel(d.label) })),
      { value: 'ALL', label: 'All employees' },
      ...depts.filter((d) => d.label !== 'Development').map((d) => ({ value: `DEPARTMENT:${d.value}`, label: deptLabel(d.label) })),
      ...projects.map((p) => ({ value: `PROJECT:${p.value}`, label: `Project · ${p.label}` })),
      { value: 'EMPLOYMENT_TYPE:INTERN', label: 'Interns' },
      { value: 'NEW_JOINERS', label: 'New joiners' },
      { value: '', label: 'Nobody — self-enrol from the catalogue' },
    ];
    const parse = (v: string) => {
      if (!v) return null;
      const [type, refId] = v.split(':');
      const label = options.find((o) => o.value === v)?.label ?? null;
      return { type: type!, refId: refId ?? null, label };
    };
    return { options, parse };
  }, [lk.data]);
}

function videoDurationMin(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('video/')) return resolve(10);
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Math.max(1, Math.round((v.duration || 600) / 60)));
    };
    v.onerror = () => resolve(10);
    v.src = url;
  });
}

function UploadCourse({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { options, parse } = useAssignOptions();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [cert, setCert] = useState('Yes');
  const [assign, setAssign] = useState<string | null>(null);
  const [category, setCategory] = useState<'REQUIRED' | 'OPTIONAL' | 'ONBOARDING'>('REQUIRED');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const assignValue = assign ?? options[0]?.value ?? 'ALL';

  async function submit() {
    if (title.trim().length < 3) return setErr('Title is required');
    if (!file) return setErr('Add the first video (or a PDF)');
    setBusy(true);
    setErr(null);
    try {
      const durationMin = await videoDurationMin(file);
      const up = await uploadFile(file, 'lms');
      const a = parse(assignValue);
      const c = await hubApi.createCourse({
        title: title.trim(),
        description: null,
        category: assignValue === 'NEW_JOINERS' ? 'ONBOARDING' : category,
        certificateOnCompletion: cert === 'Yes',
        videoFileId: up.id,
        lessonTitle: null,
        durationMin,
        assignTo: a ? { type: a.type as 'ALL', refId: a.refId, label: a.label } : null,
        dueInDays: due ? Number(due) : null,
        publish: true,
      });
      toast('Course published');
      await qc.invalidateQueries({ queryKey: hubKeys.lms });
      onCreated(c.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Upload course" onClose={onClose} actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Publishing…' : 'Publish'}</button></>}>
      <div className="form-grid">
        <div className="field span-2"><label htmlFor="c-title">Title</label><input id="c-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field span-2"><label>Video</label><FileDrop file={file} onFile={setFile} accept="video/mp4,video/webm,video/quicktime,application/pdf" label="Drop an mp4, mov or webm (or a PDF) or browse" /></div>
        <div className="field"><label htmlFor="c-cert">Certificate on completion</label><select id="c-cert" className="input" value={cert} onChange={(e) => setCert(e.target.value)}><option>Yes</option><option>No</option></select></div>
        <div className="field"><label htmlFor="c-assign">Assign to</label><select id="c-assign" className="input" value={assignValue} onChange={(e) => setAssign(e.target.value)}>{options.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}</select></div>
        <div className="field"><label htmlFor="c-cat">Category</label><select id="c-cat" className="input" value={assignValue === 'NEW_JOINERS' ? 'ONBOARDING' : category} disabled={assignValue === 'NEW_JOINERS'} onChange={(e) => setCategory(e.target.value as typeof category)}><option value="REQUIRED">Required</option><option value="OPTIONAL">Optional</option><option value="ONBOARDING">Onboarding</option></select></div>
        <div className="field"><label htmlFor="c-due">Due in (days)</label><input id="c-due" className="input" type="number" min={1} max={365} placeholder={assignValue === 'NEW_JOINERS' ? '14' : 'No due date'} value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      {err && <div className="field-error" role="alert">{err}</div>}
    </Modal>
  );
}

// ── Manage courses (lms.manage) ──────────────────────────────────────────

function ManageCourses({ onOpen }: { onOpen: (id: string) => void }) {
  const rows = useQuery({ queryKey: hubKeys.lmsManage, queryFn: hubApi.manageCourses });
  const cols: Column<ManageCourseRow>[] = [
    { key: 'title', header: 'Title', render: (r) => <strong style={{ fontWeight: 600 }}>{r.title}</strong> },
    { key: 'cat', header: 'Category', render: (r) => r.categoryLabel },
    { key: 'lessons', header: 'Lessons', num: true, render: (r) => `${r.lessons} · ${r.durationLabel}` },
    { key: 'assigned', header: 'Assigned to', render: (r) => r.assignedTo },
    { key: 'enrolled', header: 'Enrolled', num: true, render: (r) => r.enrolled },
    { key: 'done', header: 'Completed %', num: true, render: (r) => `${r.completedPct}%` },
    { key: 'overdue', header: 'Overdue', num: true, render: (r) => (r.overdue ? <Tag tone="outline">{r.overdue}</Tag> : '0') },
    { key: 'status', header: 'Status', render: (r) => <Tag tone={r.status === 'PUBLISHED' ? 'accent' : 'neutral'}>{r.status === 'PUBLISHED' ? 'Published' : r.status === 'DRAFT' ? 'Draft' : 'Archived'}</Tag> },
  ];
  if (rows.error) return <ErrorBlock error={rows.error} retry={() => void rows.refetch()} />;
  return <DataTable columns={cols} rows={rows.data} rowKey={(r) => r.id} loading={rows.isLoading} onRowClick={(r) => onOpen(r.id)} empty="No courses yet. Use Upload course to publish the first one." />;
}

function CourseEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toastError, toast } = useToast();
  const course = useQuery({ queryKey: hubKeys.course(id), queryFn: () => hubApi.course(id) });
  const report = useQuery({ queryKey: hubKeys.courseReport(id), queryFn: () => hubApi.courseReport(id) });
  const { options, parse } = useAssignOptions();
  const [view, setView] = useState<'lessons' | 'assign' | 'report' | 'details'>('lessons');
  const [lesson, setLesson] = useState({ title: '', type: 'VIDEO' as 'VIDEO' | 'DOCUMENT', duration: '5', content: '' });
  const [lessonFile, setLessonFile] = useState<File | null>(null);
  const [assign, setAssign] = useState({ value: 'ALL', required: true, due: '' });
  const [confirm, setConfirm] = useState<null | { kind: 'archive' } | { kind: 'lesson'; id: string; title: string }>(null);
  const [busy, setBusy] = useState(false);
  const inv = () => {
    void qc.invalidateQueries({ queryKey: hubKeys.lms });
  };
  const run = async (fn: () => Promise<CourseDetail | unknown>, success?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'lessons' in (r as CourseDetail)) qc.setQueryData(hubKeys.course(id), r);
      inv();
      if (success) toast(success);
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const d = course.data;
  const [details, setDetails] = useState<{ title: string; description: string; category: string; cert: boolean } | null>(null);
  useEffect(() => {
    if (d && !details) setDetails({ title: d.title, description: d.description ?? '', category: d.category, cert: d.certificateOnCompletion });
  }, [d, details]);

  async function addLesson() {
    const ok = await run(async () => {
      let fileId: string | null = null;
      let duration = Number(lesson.duration) || 5;
      if (lessonFile) {
        if (lesson.type === 'VIDEO') duration = await videoDurationMin(lessonFile);
        fileId = (await uploadFile(lessonFile, 'lms')).id;
      }
      return hubApi.addLesson(id, { title: lesson.title, type: lesson.type, fileId, durationMin: duration, content: lesson.content || null });
    }, 'Lesson added');
    if (ok) {
      setLesson({ title: '', type: 'VIDEO', duration: '5', content: '' });
      setLessonFile(null);
    }
  }

  function move(i: number, dir: -1 | 1) {
    if (!d) return;
    const ids = d.lessons.map((l) => l.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => hubApi.reorderLessons(id, ids));
  }

  return (
    <Modal title={d ? `Course · ${d.title}` : 'Course'} onClose={onClose} wide actions={<>
      {d?.status !== 'ARCHIVED' && <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm({ kind: 'archive' })}>Archive</button>}
      {d && d.status !== 'PUBLISHED' && <button className="btn btn-primary" disabled={busy || !d.lessons.length} onClick={() => void run(() => hubApi.publishCourse(id), 'Course published')}>Publish</button>}
      <button className="btn btn-secondary" onClick={onClose}>Close</button>
    </>}>
      {course.isLoading ? <Loading /> : course.error ? <ErrorBlock error={course.error} /> : d && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="kicker">{d.kicker}</span>
            <Tag tone={d.status === 'PUBLISHED' ? 'accent' : 'neutral'}>{d.status === 'PUBLISHED' ? 'Published' : d.status === 'DRAFT' ? 'Draft' : 'Archived'}</Tag>
          </div>
          <Tabs tabs={[{ value: 'lessons' as const, label: `Lessons · ${d.lessons.length}` }, { value: 'assign' as const, label: `Assignments · ${d.assignments.length}` }, { value: 'report' as const, label: `Report${report.data ? ` · ${report.data.length}` : ''}` }, { value: 'details' as const, label: 'Details' }]} value={view} onChange={setView} />
          <div style={{ marginTop: 12 }}>
            {view === 'lessons' && (
              <>
                {d.lessons.map((l, i) => (
                  <div key={l.id} className="list-row">
                    <span>{l.order}. {l.title} <span className="muted">· {l.type === 'DOCUMENT' ? 'Document' : 'Video'} · {l.durationLabel}{l.fileId ? '' : ' · no file'}</span></span>
                    <span className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${l.title} up`}>↑</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy || i === d.lessons.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${l.title} down`}>↓</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm({ kind: 'lesson', id: l.id, title: l.title })}>Remove</button>
                    </span>
                  </div>
                ))}
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <div className="field"><label htmlFor="l-title">Lesson title</label><input id="l-title" className="input" value={lesson.title} onChange={(e) => setLesson({ ...lesson, title: e.target.value })} /></div>
                  <div className="field"><label htmlFor="l-type">Type</label><select id="l-type" className="input" value={lesson.type} onChange={(e) => setLesson({ ...lesson, type: e.target.value as 'VIDEO' | 'DOCUMENT' })}><option value="VIDEO">Video</option><option value="DOCUMENT">Document (PDF)</option></select></div>
                  <div className="field span-2"><label>File</label><FileDrop file={lessonFile} onFile={setLessonFile} accept={lesson.type === 'VIDEO' ? 'video/mp4,video/webm,video/quicktime' : 'application/pdf'} /></div>
                  <div className="field"><label htmlFor="l-dur">Minutes</label><input id="l-dur" className="input" type="number" min={1} max={600} value={lesson.duration} onChange={(e) => setLesson({ ...lesson, duration: e.target.value })} disabled={lesson.type === 'VIDEO' && !!lessonFile} /></div>
                  <div className="field"><label htmlFor="l-notes">Notes</label><input id="l-notes" className="input" value={lesson.content} onChange={(e) => setLesson({ ...lesson, content: e.target.value })} /></div>
                </div>
                <button className="btn btn-secondary" style={{ marginTop: 8 }} disabled={busy || lesson.title.trim().length < 2 || (lesson.type === 'VIDEO' && !lessonFile && !lesson.content.trim())} onClick={() => void addLesson()}>Add lesson</button>
              </>
            )}
            {view === 'assign' && (
              <>
                {d.assignments.map((a) => (
                  <div key={a.id} className="list-row">
                    <span>{a.label} <span className="muted">· {a.required ? 'Required' : 'Optional'}{a.dueInDays ? ` · due in ${a.dueInDays} days` : ''} · {a.enrolled} enrolled</span></span>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => hubApi.deleteAssignment(a.id), 'Assignment removed')}>Remove</button>
                  </div>
                ))}
                {!d.assignments.length && <div className="muted">Not assigned — people can self-enrol from the catalogue.</div>}
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <div className="field"><label htmlFor="a-to">Assign to</label><select id="a-to" className="input" value={assign.value} onChange={(e) => setAssign({ ...assign, value: e.target.value })}>{options.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                  <div className="field"><label htmlFor="a-due">Due in (days)</label><input id="a-due" className="input" type="number" min={1} max={365} value={assign.due} onChange={(e) => setAssign({ ...assign, due: e.target.value })} /></div>
                  <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={assign.required} onChange={(e) => setAssign({ ...assign, required: e.target.checked })} /> Required</label>
                </div>
                <button className="btn btn-secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => { const a = parse(assign.value); if (a) void run(() => hubApi.addAssignment(id, { audienceType: a.type, refId: a.refId, label: a.label, required: assign.required, dueInDays: assign.due ? Number(assign.due) : null }), 'Course assigned'); }}>Add assignment</button>
              </>
            )}
            {view === 'report' && (
              <>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <span className="muted">{report.data?.filter((r) => r.status === 'COMPLETED').length ?? 0} of {report.data?.length ?? 0} completed</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => void download(`/lms/courses/${id}/report.csv`).catch(toastError)}>Download CSV</button>
                </div>
                <DataTable
                  columns={[
                    { key: 'name', header: 'Employee', render: (r) => r.name },
                    { key: 'dept', header: 'Department', render: (r) => r.department ?? '—' },
                    { key: 'progress', header: 'Progress', num: true, render: (r) => `${r.lessonsDone}/${r.lessonsTotal} · ${r.progressPct}%` },
                    { key: 'due', header: 'Due', render: (r) => (r.overdue ? <Tag tone="outline">{r.dueLabel ?? 'Overdue'}</Tag> : (r.dueLabel ?? '—')) },
                    { key: 'status', header: 'Status', render: (r) => <Tag tone={r.status === 'COMPLETED' ? 'accent' : 'neutral'}>{r.status === 'COMPLETED' ? 'Completed' : r.status === 'IN_PROGRESS' ? 'In progress' : 'Not started'}</Tag> },
                  ]}
                  rows={report.data}
                  rowKey={(r) => r.enrollmentId}
                  loading={report.isLoading}
                  empty="Nobody is enrolled yet."
                />
              </>
            )}
            {view === 'details' && details && (
              <div className="form-grid">
                <div className="field span-2"><label htmlFor="d-title">Title</label><input id="d-title" className="input" value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} /></div>
                <div className="field span-2"><label htmlFor="d-desc">Description</label><textarea id="d-desc" className="input" rows={3} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} /></div>
                <div className="field"><label htmlFor="d-cat">Category</label><select id="d-cat" className="input" value={details.category} onChange={(e) => setDetails({ ...details, category: e.target.value })}><option value="REQUIRED">Required</option><option value="OPTIONAL">Optional</option><option value="ONBOARDING">Onboarding</option></select></div>
                <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={details.cert} onChange={(e) => setDetails({ ...details, cert: e.target.checked })} /> Certificate on completion</label>
                <div className="span-2"><button className="btn btn-primary" disabled={busy} onClick={() => void run(() => hubApi.updateCourse(id, { title: details.title, description: details.description || null, category: details.category, certificateOnCompletion: details.cert }), 'Course updated')}>Save</button></div>
              </div>
            )}
          </div>
        </>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'archive' ? 'Archive this course?' : `Remove “${confirm.title}”?`}
          body={confirm.kind === 'archive' ? 'Learners keep their certificates; the course leaves the catalogue.' : 'Learners lose their progress on this lesson.'}
          confirmLabel={confirm.kind === 'archive' ? 'Archive' : 'Remove'}
          danger
          onConfirm={() => { const c = confirm; setConfirm(null); void run(() => (c.kind === 'archive' ? hubApi.archiveCourse(id) : hubApi.deleteLesson(c.id)), c.kind === 'archive' ? 'Course archived' : 'Lesson removed'); }}
          onClose={() => setConfirm(null)}
        />
      )}
    </Modal>
  );
}
