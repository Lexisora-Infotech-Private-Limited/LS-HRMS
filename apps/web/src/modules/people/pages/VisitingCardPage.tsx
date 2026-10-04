import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@lexisora/shared';
import { authUrl, download } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FormModal, type FieldDef } from '@/components/form';
import { Card, ErrorBlock, Loading, Modal, PageHeader, Tag } from '@/components/ui';
import { peopleApi, peopleKeys, type VCardFull } from '../api';
import '../people.css';

/**
 * Digital visiting card (M11): auto-filled from the profile with the corporate template.
 * PNG (1050 × 600 px, 300 DPI) and print PDF (3 mm bleed) are rendered by the server;
 * email share attaches the PNG + .vcf through Mailpit; WhatsApp opens a wa.me deep link.
 */
export default function VisitingCardPage() {
  const { toast, toastError } = useToast();
  const q = useQuery({ queryKey: peopleKeys.vcard, queryFn: () => peopleApi.vcard() });
  const myId = useQuery({ queryKey: [...peopleKeys.idcards, 'mine'], queryFn: () => peopleApi.myIdCard() });
  const [busy, setBusy] = useState<'png' | 'pdf' | 'vcf' | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [wa, setWa] = useState(false);
  const [settings, setSettings] = useState(false);

  async function save(kind: 'png' | 'pdf' | 'vcf') {
    setBusy(kind);
    try {
      await download(`/vcard/${kind}`);
      toast(kind === 'vcf' ? 'Contact file saved' : 'Saved');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Public link copied');
    } catch {
      toastError('Could not copy the link; select it and copy manually');
    }
  }

  if (q.error) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  const c = q.data;
  const id = myId.data;

  return (
    <div data-screen-label="Visiting card" className="stack" style={{ gap: 18 }}>
      <PageHeader title="Digital visiting card" sub="Auto-filled from your profile using the corporate template." actions={<button className="btn btn-ghost" onClick={() => setSettings(true)}>Card settings</button>} />
      <div className="pp-vc">
        <div className="pp-vc-card" aria-label="Visiting card preview">
          <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{c.company}</span>
            <img src={c.qrDataUrl} alt={c.isPublic ? 'QR code: opens the public card' : 'QR code: contact details'} width={54} height={54} style={{ flex: 'none' }} />
          </div>
          <div>
            <div className="pp-vc-name">{c.name}</div>
            <div className="pp-vc-title">{c.title}</div>
          </div>
          <div className="pp-vc-foot">
            <span>{c.email}</span>
            {c.phone && <span className="tnum">{c.phone}</span>}
          </div>
        </div>
        <div className="pp-vc-actions">
          <button className="btn btn-secondary" disabled={busy === 'png'} onClick={() => void save('png')}>{busy === 'png' ? 'Preparing…' : 'Download PNG'}</button>
          <button className="btn btn-secondary" disabled={busy === 'pdf'} onClick={() => void save('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
          <button className="btn btn-primary" onClick={() => setEmailing(true)}>Share by email</button>
          <button className="btn btn-primary" onClick={() => setWa(true)}>Share on WhatsApp</button>
          <div className="faint" style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 260 }}>
            {c.isPublic ? (
              <>
                Public card:{' '}
                <a href={c.publicUrl} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all' }}>{c.publicUrl.replace(/^https?:\/\//, '')}</a>
                <br />
                <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => void copyLink(c.publicUrl)}>Copy link</button>
                <button className="btn btn-ghost btn-sm" disabled={busy === 'vcf'} onClick={() => void save('vcf')}>Save contact (.vcf)</button>
              </>
            ) : (
              <>
                Public link is off — the QR carries your contact details directly.
                <br />
                <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} disabled={busy === 'vcf'} onClick={() => void save('vcf')}>Save contact (.vcf)</button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>Name, designation and email come from your profile. To change them, ask HR to update your profile.</div>

      {id && (
        <Card kicker="My ID card" title={id.serial} actions={<Tag tone={id.status === 'REVOKED' ? 'danger' : id.status === 'QUEUED' ? 'outline' : 'accent'}>{id.statusLabel}</Tag>}>
          {id.status === 'QUEUED' ? (
            <div className="faint" style={{ fontSize: 13 }}>Your card is queued{id.missing.length ? ` — add your ${id.missing.join(' and ').toLowerCase()} on your profile so HR can print it` : ' and will be printed with the next batch'}.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                {(['front', 'back'] as const).map((s) => (
                  <img key={s} src={authUrl(`/id-cards/${id.id}/png/${s}`)} alt={`ID card ${s}`} style={{ height: 220, border: '1px solid var(--color-divider)', borderRadius: 8, background: '#fff' }} />
                ))}
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => download(`/id-cards/${id.id}/pdf`).then(() => toast('Saved'), toastError)}>Download PDF</button>
                {id.generatedAt && <span className="faint" style={{ fontSize: 12 }}>Generated {formatDate(id.generatedAt)}</span>}
              </div>
            </div>
          )}
        </Card>
      )}

      {emailing && <EmailModal card={c} onClose={() => setEmailing(false)} />}
      {wa && <WhatsappModal onClose={() => setWa(false)} />}
      {settings && <SettingsModal card={c} onClose={() => setSettings(false)} />}
    </div>
  );
}

function EmailModal({ card, onClose }: { card: VCardFull; onClose: () => void }) {
  const send = useAction((b: { to: string[]; message: string | null }) => peopleApi.shareVcardEmail(b.to, b.message), { success: 'Visiting card sent by email', onSuccess: onClose });
  const fields: FieldDef[] = [
    { name: 'to', label: 'Recipients', type: 'text', span: 2, required: true, placeholder: 'client@example.com, partner@example.com', hint: 'Up to 10 email addresses, separated by commas' },
    { name: 'message', label: 'Message (optional)', type: 'area', span: 2, placeholder: `Hi, sharing my contact details. — ${card.name}` },
  ];
  return (
    <FormModal
      title="Share by email"
      fields={fields}
      submitLabel="Send card"
      intro={<span className="faint" style={{ fontSize: 12.5 }}>The card image and a contact file (.vcf) are attached. Replies come to {card.email}.</span>}
      onClose={onClose}
      onSubmit={async (v) => {
        const to = String(v.to ?? '')
          .split(/[,;\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        await send.mutateAsync({ to, message: v.message ? String(v.message) : null });
      }}
    />
  );
}

function WhatsappModal({ onClose }: { onClose: () => void }) {
  const { toast, toastError } = useToast();
  const [phone, setPhone] = useState('+91 ');
  const [busy, setBusy] = useState(false);
  const digits = phone.replace(/\D/g, '');
  const valid = digits.length === 0 || digits.length === 2 || (digits.length >= 10 && digits.length <= 13);

  async function open() {
    // Open the tab synchronously (popup blockers), then point it at the wa.me link from the server.
    const w = window.open('about:blank', '_blank');
    setBusy(true);
    try {
      const num = digits.length > 2 ? phone.trim() : null;
      const r = await peopleApi.shareVcardWhatsapp(num);
      if (w) w.location.href = r.url;
      else window.open(r.url, '_blank', 'noopener');
      toast('Opened WhatsApp');
      onClose();
    } catch (e) {
      w?.close();
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Share on WhatsApp"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void open()}>{busy ? 'Opening…' : 'Open WhatsApp'}</button>
        </>
      }
    >
      <div className="dialog-body stack" style={{ gap: 10 }}>
        <div className="field">
          <label htmlFor="wa-phone">WhatsApp number (optional)</label>
          <input id="wa-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98250 12345" />
          {!valid ? <span className="field-error">Enter a valid WhatsApp number</span> : <span className="field-hint">Leave the number blank to pick a chat in WhatsApp.</span>}
        </div>
        <div className="faint" style={{ fontSize: 12.5 }}>WhatsApp opens with a message containing your public card link. Nothing is sent until you press send there.</div>
      </div>
    </Modal>
  );
}

function SettingsModal({ card, onClose }: { card: VCardFull; onClose: () => void }) {
  const save = useAction((b: { showPhone: boolean; workPhone: string | null; linkedinUrl: string | null; isPublic: boolean }) => peopleApi.saveVcard(b), { success: 'Card settings saved', invalidate: [peopleKeys.vcard] });
  const fields: FieldDef[] = [
    { name: 'showPhone', label: 'Show a phone number on my card', type: 'checkbox', span: 2 },
    { name: 'workPhone', label: 'Work phone (instead of my personal phone)', type: 'text', span: 2, placeholder: '+91 79 4000 1234', showIf: (v) => !!v.showPhone },
    { name: 'linkedinUrl', label: 'LinkedIn URL', type: 'text', span: 2, placeholder: 'https://www.linkedin.com/in/your-name' },
    { name: 'isPublic', label: 'Public link (anyone with the QR or link can view the card)', type: 'checkbox', span: 2 },
  ];
  return (
    <FormModal
      title="Card settings"
      fields={fields}
      initial={{ showPhone: card.showPhone, workPhone: card.workPhone ?? '', linkedinUrl: card.linkedinUrl ?? '', isPublic: card.isPublic }}
      submitLabel="Save settings"
      intro={<span className="faint" style={{ fontSize: 12.5 }}>Card fields come from your profile; only these options can be changed here.</span>}
      onClose={onClose}
      onSubmit={(v) =>
        save.mutateAsync({
          showPhone: !!v.showPhone,
          workPhone: v.showPhone && v.workPhone ? String(v.workPhone).trim() : null,
          linkedinUrl: v.linkedinUrl ? String(v.linkedinUrl).trim() : null,
          isPublic: !!v.isPublic,
        })
      }
    />
  );
}
