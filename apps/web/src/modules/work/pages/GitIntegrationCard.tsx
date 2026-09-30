import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { FormModal } from '@/components/form';
import { Card, ErrorBlock, Loading, Tag } from '@/components/ui';
import { workApi, workKeys } from '../api';

/** Tenant GitLab integration (REST v4 when a token is saved; recording stub otherwise). */
export function GitIntegrationCard() {
  const can = useCan();
  const manage = can('git.manage');
  const [editing, setEditing] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const q = useQuery({ queryKey: workKeys.git, queryFn: workApi.git });
  const test = useAction(() => workApi.testGit(), { success: (r) => (r.ok ? `Connected${r.user ? ` as ${r.user}` : ''}${r.message ? ` · ${r.message}` : ''}` : `Connection failed · ${r.message ?? ''}`), invalidate: [workKeys.git] });
  const rotate = useAction(() => workApi.rotateGit(), { success: 'Webhook secret rotated · update it in GitLab', invalidate: [workKeys.git], onSuccess: (r) => setSecret(r.webhookSecret ?? null) });
  const save = useAction((b: unknown) => workApi.saveGit(b), { success: 'GitLab settings saved', invalidate: [workKeys.git], onSuccess: (r) => r.webhookSecret && setSecret(r.webhookSecret) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} />;
  const g = q.data;
  return (
    <Card kicker="GitLab integration">
      <div className="wk-kv">
        <span>Mode</span>
        <span>{g.mode === 'gitlab' ? <Tag tone="accent">GitLab REST v4</Tag> : <Tag tone="outline">Stub · branches and MRs recorded only</Tag>}</span>
        <span>Server</span><span>{g.baseUrl}</span>
        <span>Token</span><span>{g.tokenLast4 ? `•••• ${g.tokenLast4}` : 'Not set'}</span>
        <span>Branch pattern</span><span><code>{g.branchPattern}</code> from <code>{g.defaultTargetBranch}</code></span>
        <span>MR title</span><span><code>{g.mrTitlePattern}</code></span>
        <span>Status</span><span><Tag tone={g.status === 'ACTIVE' ? 'accent' : 'danger'}>{g.status === 'ACTIVE' ? 'Active' : 'Auth error'}</Tag>{g.lastCheckedAt && <span className="faint" style={{ fontSize: 12 }}> · checked {formatDate(g.lastCheckedAt)}</span>}</span>
        <span>Webhook URL</span><span style={{ wordBreak: 'break-all' }}><code>{g.webhookUrl}</code></span>
      </div>
      {secret && (
        <div className="note" style={{ marginTop: 10 }}>
          Webhook secret (shown once — paste into GitLab → Settings → Webhooks → Secret token): <code style={{ wordBreak: 'break-all' }}>{secret}</code>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-secondary" disabled={test.isPending} onClick={() => test.mutate(undefined)}>Test connection</button>
        {manage && <button className="btn btn-secondary" disabled={rotate.isPending} onClick={() => rotate.mutate(undefined)}>Rotate webhook secret</button>}
        {manage && <button className="btn btn-primary" onClick={() => setEditing(true)}>Configure</button>}
      </div>
      {editing && (
        <FormModal
          title="GitLab integration"
          fields={[
            { name: 'baseUrl', label: 'GitLab URL', type: 'text', span: 2, required: true },
            { name: 'token', label: 'Access token', type: 'password', span: 2, hint: g.tokenLast4 ? `Leave blank to keep •••• ${g.tokenLast4}. Needs the api scope.` : 'Personal or project access token with the api scope.' },
            { name: 'defaultTargetBranch', label: 'Default target branch', type: 'text', required: true },
            { name: 'branchPattern', label: 'Branch pattern', type: 'text', required: true, hint: 'Must contain {key}' },
            { name: 'mrTitlePattern', label: 'MR title pattern', type: 'text', span: 2, required: true },
          ]}
          initial={{ baseUrl: g.baseUrl, defaultTargetBranch: g.defaultTargetBranch, branchPattern: g.branchPattern, mrTitlePattern: g.mrTitlePattern }}
          onSubmit={(v) => save.mutateAsync({ ...v, token: v.token || undefined })}
          onClose={() => setEditing(false)}
        />
      )}
    </Card>
  );
}
