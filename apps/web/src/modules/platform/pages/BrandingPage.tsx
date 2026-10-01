import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BRAND_PRESETS, HEX_RE, ROOT_DOMAIN, brandContrastWarnings, formatDate, normalizeLoginDomain, sidebarForeground, type BrandingDto } from '@lexisora/shared';
import { Card, ConfirmDialog, ErrorBlock, Loading, Seg, Tag } from '@/components/ui';
import { FileDrop } from '@/components/form';
import { HttpError, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { brandingApi, saasKeys, useBranding } from '../api';
import '../platform.css';

type Draft = { preset: string; primary: string; secondary: string; productName: string; domain: string; logoFileId: string | null; logoUrl: string | null };

const draftOf = (b: BrandingDto): Draft => ({
  preset: b.presetKey ?? 'custom',
  primary: b.primaryHex,
  secondary: b.secondaryHex,
  productName: b.productName ?? '',
  domain: b.domain,
  logoFileId: b.logoFileId,
  logoUrl: b.logoUrl,
});

/** Live preview (wireframe mock): sidebar in the secondary colour, cards and button in the primary. */
function AppPreview({ d, logoSrc, name }: { d: Draft; logoSrc: string | null; name: string }) {
  const ok = HEX_RE.test(d.primary) && HEX_RE.test(d.secondary);
  const primary = ok ? d.primary : '#b68235';
  const secondary = ok ? d.secondary : '#2d2b2b';
  const fg = sidebarForeground(secondary);
  const bar = (o: number) => (fg === '#ffffff' ? `rgba(255,255,255,${o})` : `rgba(45,43,43,${o})`);
  return (
    <div className="pf-preview" aria-label="Theme preview">
      <div className="pf-preview-side" style={{ background: secondary, color: fg }}>
        {logoSrc ? <img src={logoSrc} alt="" /> : <div className="pf-wordmark">{name}</div>}
        <div className="pf-bar" style={{ width: '80%', background: bar(0.4) }} />
        <div className="pf-bar" style={{ width: '60%', background: bar(0.4) }} />
        <div className="pf-bar" style={{ width: '75%', background: bar(0.4) }} />
        <div className="pf-bar" style={{ width: '50%', background: bar(0.25) }} />
      </div>
      <div className="pf-preview-main">
        <div style={{ height: 14, width: '40%', background: '#e3e0dd' }} />
        <div className="pf-preview-cards">
          <div className="pf-preview-card" style={{ borderTop: `3px solid ${primary}` }} />
          <div className="pf-preview-card" style={{ borderTop: `3px solid ${primary}` }} />
        </div>
        <div style={{ fontSize: 12, color: primary }}>Text link</div>
        <div className="pf-preview-btn" style={{ background: primary }}>Primary action</div>
      </div>
    </div>
  );
}

function LoginPreview({ d, logoSrc, name, enterprise }: { d: Draft; logoSrc: string | null; name: string; enterprise: boolean }) {
  const primary = HEX_RE.test(d.primary) ? d.primary : '#b68235';
  return (
    <div className="pf-login-preview" aria-label="Login page preview">
      <div className="pf-login-card">
        {logoSrc ? <img src={logoSrc} alt="" style={{ maxHeight: 40, maxWidth: 180, objectFit: 'contain', alignSelf: 'flex-start' }} /> : <div className="serif" style={{ fontSize: 20 }}>{name}</div>}
        <div style={{ fontSize: 12, color: '#6f6a66' }}>Sign in to {normalizeLoginDomain(d.domain || 'workspace')}</div>
        <div className="pf-fake-input" />
        <div className="pf-fake-input" />
        <div className="pf-preview-btn" style={{ background: primary, alignSelf: 'stretch', textAlign: 'center' }}>Sign in</div>
        {!enterprise && <div style={{ fontSize: 10.5, color: '#8b8580', textAlign: 'center' }}>Powered by Lexisora HRMS</div>}
      </div>
    </div>
  );
}

/** Branding (wireframe "Branding"): palette presets or custom colours, logo, product name, login domain. */
export default function BrandingPage() {
  const qc = useQueryClient();
  const { reload } = useAuth();
  const { toast, toastError } = useToast();
  const q = useBranding();
  const [d, setD] = useState<Draft | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'app' | 'login'>('app');
  const [domainMsg, setDomainMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<BrandingDto['versions'][number] | null>(null);
  const [confirmDomain, setConfirmDomain] = useState(false);

  useEffect(() => {
    if (q.data) setD(draftOf(q.data));
  }, [q.data]);

  const filePreview = useMemo(() => (logoFile ? URL.createObjectURL(logoFile) : null), [logoFile]);
  useEffect(() => () => (filePreview ? URL.revokeObjectURL(filePreview) : undefined), [filePreview]);

  if (q.isLoading || (!d && !q.error)) return <Loading />;
  if (q.error || !q.data || !d) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const b = q.data;
  const locked = b.locked;
  const set = (patch: Partial<Draft>) => setD((s) => (s ? { ...s, ...patch } : s));
  const warnings = brandContrastWarnings(d.primary, d.secondary);
  const name = d.productName.trim() || b.tenantName;
  const logoSrc = filePreview ?? d.logoUrl;
  const hexOk = HEX_RE.test(d.primary) && HEX_RE.test(d.secondary);
  const domainChanged = normalizeLoginDomain(d.domain) !== b.domain;

  async function checkDomain() {
    if (!d || !d.domain.trim()) return;
    try {
      const r = await brandingApi.domainCheck(d.domain);
      setDomainMsg(r.domain === b.domain ? null : { ok: r.available, text: r.message });
    } catch (e) {
      setDomainMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function publish() {
    if (!d) return;
    setBusy(true);
    try {
      let logoFileId = d.logoFileId;
      if (logoFile) logoFileId = (await uploadFile(logoFile, 'brand-logo')).id;
      await brandingApi.publish({ presetKey: d.preset === 'custom' ? null : d.preset, primaryHex: d.primary, secondaryHex: d.secondary, logoFileId, productName: d.productName.trim() || null, domain: d.domain });
      setLogoFile(null);
      setDomainMsg(null);
      await qc.invalidateQueries({ queryKey: saasKeys.branding });
      await reload();
      toast('Saved');
    } catch (e) {
      if (e instanceof HttpError && e.code === 'DOMAIN_TAKEN') setDomainMsg({ ok: false, text: e.message });
      toastError(e);
    } finally {
      setBusy(false);
      setConfirmDomain(false);
    }
  }

  async function doRestore(versionId: string) {
    setBusy(true);
    try {
      const r = await brandingApi.restore(versionId);
      qc.setQueryData(saasKeys.branding, r);
      setD(draftOf(r));
      setLogoFile(null);
      await reload();
      toast('Saved');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
      setRestore(null);
    }
  }

  return (
    <div data-screen-label="Branding" className="stack" style={{ gap: 20 }}>
      <div className="pf-brand">
        <div className="pf-brand-form">
          <div>
            <h2 style={{ margin: 0 }}>Branding</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--color-neutral-700)' }}>Each client tenant gets its own colors, logo and login domain.</p>
          </div>
          {locked && (
            <div className="note">
              Branding is available on Growth. Your workspace uses the Default theme. <Link to="/billing">Upgrade</Link>
            </div>
          )}

          <div className="field">
            <label>Brand palette</label>
            <div className="pf-pals" role="radiogroup" aria-label="Brand palette">
              {BRAND_PRESETS.map((p) => (
                <button key={p.key} type="button" className="pf-pal" aria-pressed={d.preset === p.key} disabled={locked} onClick={() => set({ preset: p.key, primary: p.primary, secondary: p.secondary })}>
                  <span className="pf-swatch" style={{ background: p.primary }} />
                  <span className="pf-swatch" style={{ background: p.secondary }} />
                  {p.name}
                </button>
              ))}
              <button type="button" className="pf-pal" aria-pressed={d.preset === 'custom'} disabled={locked} onClick={() => set({ preset: 'custom' })}>
                <span className="pf-swatch" style={{ background: hexOk ? d.primary : 'transparent' }} />
                <span className="pf-swatch" style={{ background: hexOk ? d.secondary : 'transparent' }} />
                Custom
              </button>
            </div>
          </div>

          {d.preset === 'custom' && (
            <div className="field">
              <label>Custom colours</label>
              <div className="pf-color-row">
                <input type="color" aria-label="Primary colour picker" value={HEX_RE.test(d.primary) ? d.primary : '#b68235'} disabled={locked} onChange={(e) => set({ primary: e.target.value })} />
                <input className="input" aria-label="Primary colour" value={d.primary} disabled={locked} onChange={(e) => set({ primary: e.target.value.trim() })} />
                <span className="muted" style={{ fontSize: 12 }}>Primary</span>
              </div>
              <div className="pf-color-row" style={{ marginTop: 6 }}>
                <input type="color" aria-label="Secondary colour picker" value={HEX_RE.test(d.secondary) ? d.secondary : '#2d2b2b'} disabled={locked} onChange={(e) => set({ secondary: e.target.value })} />
                <input className="input" aria-label="Secondary colour" value={d.secondary} disabled={locked} onChange={(e) => set({ secondary: e.target.value.trim() })} />
                <span className="muted" style={{ fontSize: 12 }}>Secondary (sidebar)</span>
              </div>
              {!hexOk && <div className="field-error">Use colours like #c62828</div>}
            </div>
          )}
          {warnings.map((w) => (
            <div key={w} className="pf-warn">{w}</div>
          ))}

          <div className="field">
            <label>Logo</label>
            {locked ? (
              <div className="dropzone" aria-disabled>Drop SVG or PNG</div>
            ) : (
              <FileDrop file={logoFile} onFile={setLogoFile} accept="image/svg+xml,image/png" label="Drop SVG or PNG" />
            )}
            {(logoSrc || d.logoFileId) && (
              <div className="pf-logo-box" style={{ marginTop: 6 }}>
                {logoSrc && <img src={logoSrc} alt="Logo preview" />}
                {!logoFile && d.logoFileId && !locked && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ logoFileId: null, logoUrl: null })}>Remove logo</button>
                )}
              </div>
            )}
            <div className="field-hint">SVG, or PNG at least 64 px tall, up to 2 MB. Shown at 28 px in the sidebar and 40 px on the login page.</div>
          </div>

          <div className="field">
            <label htmlFor="pf-product">Product name</label>
            <input id="pf-product" className="input" maxLength={40} placeholder={b.tenantName} value={d.productName} disabled={locked} onChange={(e) => set({ productName: e.target.value })} />
            <div className="field-hint">Replaces “{b.tenantName}” in the sidebar and on the login page.</div>
          </div>

          <div className="field">
            <label htmlFor="pf-domain">Login domain</label>
            <input
              id="pf-domain"
              className="input"
              value={d.domain}
              disabled={locked}
              onChange={(e) => {
                set({ domain: e.target.value });
                setDomainMsg(null);
              }}
              onBlur={() => void checkDomain()}
            />
            {domainMsg ? <div className={domainMsg.ok ? 'field-hint' : 'field-error'}>{domainMsg.text}</div> : <div className="field-hint">Your workspace address, e.g. acme.{ROOT_DOMAIN}. Custom domains (hr.yourcompany.com) are available on Enterprise.</div>}
          </div>

          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={locked || busy || !hexOk || (domainMsg !== null && !domainMsg.ok)} onClick={() => (domainChanged ? setConfirmDomain(true) : void publish())}>
            {busy ? 'Publishing…' : 'Publish theme'}
          </button>
          {b.version && (
            <div className="muted" style={{ fontSize: 12.5 }}>
              Live: v{b.version} · published {formatDate(b.publishedAt)}{b.publishedByName ? ` by ${b.publishedByName}` : ''}
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <div style={{ alignSelf: 'flex-start' }}>
            <Seg<'app' | 'login'> options={[{ value: 'app', label: 'App preview' }, { value: 'login', label: 'Preview login page' }]} value={mode} onChange={setMode} />
          </div>
          {mode === 'app' ? <AppPreview d={d} logoSrc={logoSrc} name={name} /> : <LoginPreview d={d} logoSrc={logoSrc} name={name} enterprise={b.planCode === 'ENTERPRISE'} />}

          <Card kicker="History" title="Published themes">
            <div className="pf-versions">
              {b.versions.length === 0 && <div className="muted">Nothing published yet.</div>}
              {b.versions.map((v) => (
                <div key={v.id} className="list-row">
                  <span className="pf-swatch" style={{ background: v.primaryHex }} />
                  <span className="pf-swatch" style={{ background: v.secondaryHex }} />
                  <span className="grow">
                    v{v.version} · {BRAND_PRESETS.find((p) => p.key === v.presetKey)?.name ?? `Custom ${v.primaryHex} / ${v.secondaryHex}`}
                    <div className="muted" style={{ fontSize: 12 }}>{formatDate(v.publishedAt)}{v.publishedByName ? ` · ${v.publishedByName}` : ''}</div>
                  </span>
                  {v.status === 'PUBLISHED' ? <Tag tone="accent">Live</Tag> : <button className="btn btn-secondary btn-sm" disabled={locked || busy} onClick={() => setRestore(v)}>Restore</button>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {restore && (
        <ConfirmDialog
          title={`Restore theme v${restore.version}?`}
          body="The colours, logo and product name of that version are published again as a new version. Your login domain stays as it is."
          confirmLabel="Restore"
          busy={busy}
          onConfirm={() => void doRestore(restore.id)}
          onClose={() => setRestore(null)}
        />
      )}
      {confirmDomain && (
        <ConfirmDialog
          title={`Move the workspace to ${normalizeLoginDomain(d.domain)}?`}
          body={`Everyone signs in at ${normalizeLoginDomain(d.domain)} from now on and ${b.domain} stops working. We’ll alert all users by email; desktop tracker users need to update the workspace field.`}
          confirmLabel="Publish and move"
          busy={busy}
          onConfirm={() => void publish()}
          onClose={() => setConfirmDomain(false)}
        />
      )}
    </div>
  );
}
