import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { IdCardElement, VCardDto } from '@lexisora/shared';
import { env } from '../../../config/env';
import { AuditService } from '../../../core/audit/audit.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, notFound } from '../../../core/http/errors';
import { MailService, type MailInput } from '../../../core/mail/mail.service';
import { PdfService } from '../../../core/pdf/pdf.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { buildVcf, slugify, whatsappLink } from '../people.rules';
import { PT_PER_MM, qrDataUrl, renderCardSvg, svgToPng } from '../idcards/card-render';

/** 3.5 × 2 in visiting card (88.9 × 50.8 mm); PNG 1050 × 600 px at 300 DPI. */
const W_MM = 88.9;
const H_MM = 50.8;

const publicUrl = (tenantSlug: string, slug: string) => `${env.WEB_ORIGIN}/api/v1/vcard/c/${tenantSlug}/${slug}`;

function cardElements(showPhone: boolean): IdCardElement[] {
  const f = (size: number, extra: Partial<NonNullable<IdCardElement['font']>> = {}) => ({ size, weight: 'normal' as const, color: '#201f1d', align: 'left' as const, family: 'sans' as const, ...extra });
  return [
    { id: 'company', type: 'TEXT', binding: 'tenant.name', xMm: 6.5, yMm: 5, wMm: 55, hMm: 7, z: 1, font: f(12, { family: 'serif' }) },
    { id: 'qr', type: 'QR', binding: 'qr.verify_url', xMm: 67, yMm: 5, wMm: 15.5, hMm: 15.5, z: 1 },
    { id: 'name', type: 'TEXT', binding: 'employee.full_name', xMm: 6.5, yMm: 21, wMm: 76, hMm: 9, z: 1, font: f(20, { family: 'serif' }) },
    { id: 'title', type: 'TEXT', binding: 'employee.designation', xMm: 6.5, yMm: 29, wMm: 76, hMm: 5, z: 1, font: f(9, { color: '#8a6326' }) },
    { id: 'rule', type: 'SHAPE', xMm: 6.5, yMm: 38.5, wMm: 76, hMm: 0.3, fill: '#d7d3d3', z: 0 },
    { id: 'email', type: 'TEXT', binding: 'employee.emp_code', xMm: 6.5, yMm: 40, wMm: 45, hMm: 5, z: 1, font: f(8) },
    ...(showPhone ? [{ id: 'phone', type: 'TEXT' as const, binding: 'employee.emergency_contact' as const, xMm: 46, yMm: 40, wMm: 36.5, hMm: 5, z: 1, font: f(8, { align: 'right' as const }) }] : []),
  ];
}

/** Digital visiting card (M11): auto-filled from the profile; PNG/PDF/vCard, email + WhatsApp share. */
@Injectable()
export class VcardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService,
  ) {}

  async ensureProfile(employeeId: string, fullName: string) {
    const existing = await this.prisma.vCardProfile.findUnique({ where: { employeeId } });
    if (existing) return existing;
    const slug = `${slugify(fullName) || 'card'}-${randomBytes(3).readUIntBE(0, 3).toString(36).slice(0, 3)}`;
    return this.prisma.vCardProfile.create({ data: { employeeId, publicSlug: slug } as Prisma.VCardProfileUncheckedCreateInput });
  }

  async disablePublic(employeeId: string) {
    await this.prisma.vCardProfile.updateMany({ where: { employeeId }, data: { isPublic: false } });
  }

  private meId() {
    const me = requireContext().employeeId;
    if (!me) throw notFound('Employee');
    return me;
  }

  async card(employeeId = this.meId()): Promise<VCardDto & { slug: string; tenantSlug: string; vcf: string }> {
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { designation: true, department: true, branch: true } });
    if (!e) throw notFound('Employee');
    const p = await this.ensureProfile(e.id, e.fullName);
    const t = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
    const company = t.name;
    const phone = p.showPhone ? (p.workPhone || e.phone || null) : null;
    const url = publicUrl(t.slug, p.publicSlug);
    const address = e.branch?.address ?? t.address ?? null;
    const title = [e.designation?.name, e.department?.name].filter(Boolean).join(' · ');
    const vcf = buildVcf({ name: e.fullName, org: company, title: e.designation?.name, email: e.officialEmail, phone, url: p.isPublic ? url : null, address, linkedin: p.linkedinUrl });
    return {
      name: e.fullName,
      title,
      designation: e.designation?.name ?? null,
      department: e.department?.name ?? null,
      email: e.officialEmail,
      phone,
      company,
      address,
      publicUrl: url,
      // Public link off → the QR carries the vCard itself (works offline).
      qrDataUrl: await qrDataUrl(p.isPublic ? url : vcf),
      showPhone: p.showPhone,
      workPhone: p.workPhone,
      linkedinUrl: p.linkedinUrl,
      isPublic: p.isPublic,
      slug: p.publicSlug,
      tenantSlug: t.slug,
      vcf,
    };
  }

  async updateSettings(dto: { showPhone?: boolean; workPhone?: string | null; linkedinUrl?: string | null; isPublic?: boolean }) {
    const me = this.meId();
    const e = await this.prisma.employee.findUniqueOrThrow({ where: { id: me } });
    const p = await this.ensureProfile(me, e.fullName);
    await this.prisma.vCardProfile.update({
      where: { id: p.id },
      data: {
        ...(dto.showPhone !== undefined ? { showPhone: dto.showPhone } : {}),
        ...(dto.workPhone !== undefined ? { workPhone: dto.workPhone || null } : {}),
        ...(dto.linkedinUrl !== undefined ? { linkedinUrl: dto.linkedinUrl || null } : {}),
        ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
      },
    });
    if (dto.isPublic !== undefined && dto.isPublic !== p.isPublic) await this.audit.record({ action: 'vcard.public_toggled', entity: 'VCardProfile', entityId: p.id, meta: { isPublic: dto.isPublic } });
    return this.card(me);
  }

  async png(employeeId = this.meId()): Promise<Buffer> {
    const c = await this.card(employeeId);
    const data: Record<string, string | null> = {
      'tenant.name': c.company,
      'employee.full_name': c.name,
      'employee.designation': c.title,
      'employee.emp_code': c.email,
      'employee.emergency_contact': c.phone,
      'qr.verify_url': 'x',
    };
    const svg = renderCardSvg({ widthMm: W_MM, heightMm: H_MM, elements: cardElements(!!c.phone) }, data, { qr: c.qrDataUrl });
    return svgToPng(svg);
  }

  async pdfFile(employeeId = this.meId()): Promise<Buffer> {
    const png = await this.png(employeeId);
    const bleed = 3 * PT_PER_MM;
    const w = W_MM * PT_PER_MM;
    const h = H_MM * PT_PER_MM;
    return this.pdf.render(
      (doc) => {
        doc.rect(0, 0, w + 2 * bleed, h + 2 * bleed).fill('#ffffff');
        doc.image(png, bleed, bleed, { width: w, height: h });
        // crop marks
        doc.lineWidth(0.3).strokeColor('#999999');
        for (const [x, y] of [[bleed, bleed], [bleed + w, bleed], [bleed, bleed + h], [bleed + w, bleed + h]] as [number, number][]) {
          doc.moveTo(x, y - bleed).lineTo(x, y - bleed / 2).stroke();
          doc.moveTo(x, y + bleed / 2).lineTo(x, y + bleed).stroke();
          doc.moveTo(x - bleed, y).lineTo(x - bleed / 2, y).stroke();
          doc.moveTo(x + bleed / 2, y).lineTo(x + bleed, y).stroke();
        }
      },
      { size: [w + 2 * bleed, h + 2 * bleed], margin: 0, info: { Title: 'Visiting card', Author: 'Lexisora HRMS' } },
    );
  }

  async vcf(employeeId = this.meId()) {
    const c = await this.card(employeeId);
    return { vcf: c.vcf, filename: `${c.slug}.vcf` };
  }

  private async sharesToday(employeeId: string) {
    const since = new Date(Date.now() - 86400_000);
    return this.prisma.vCardShare.count({ where: { employeeId, createdAt: { gte: since } } });
  }

  async shareEmail(to: string[], message?: string | null) {
    const me = this.meId();
    if ((await this.sharesToday(me)) + to.length > 20) throw new AppError(429, 'SHARE_LIMIT', 'You can share your card with up to 20 people a day');
    const c = await this.card(me);
    const png = await this.png(me);
    const mail: MailInput & { replyTo: string } = {
      to,
      replyTo: c.email,
      subject: `${c.name} · ${c.company} visiting card`,
      text: `${message ? `${message}\n\n` : ''}${c.name}\n${c.title}\n${c.company}\n${c.email}${c.phone ? `\n${c.phone}` : ''}${c.isPublic ? `\n\nView online: ${c.publicUrl}` : ''}\n\nThe card image and a contact file (.vcf) are attached.`,
      attachments: [
        { filename: `${c.slug}.png`, content: png, contentType: 'image/png' },
        { filename: `${c.slug}.vcf`, content: c.vcf, contentType: 'text/vcard' },
      ],
    };
    const ok = await this.mail.send(mail);
    if (!ok) throw new AppError(502, 'MAIL_FAILED', 'The email could not be sent. Try again.');
    await this.prisma.vCardShare.createMany({ data: to.map((r) => ({ employeeId: me, channel: 'EMAIL', recipient: r, status: 'SENT' })) as Prisma.VCardShareCreateManyInput[] });
    await this.audit.record({ action: 'vcard.shared', entity: 'VCardProfile', entityId: me, meta: { channel: 'EMAIL', recipients: to.map((r) => r.replace(/^(.).*@/, '$1***@')) } });
    return { sent: to.length };
  }

  /** WhatsApp stub adapter: always a wa.me deep link (the Business API is P3). */
  async shareWhatsapp(phone?: string | null) {
    const me = this.meId();
    const digits = (phone ?? '').replace(/\D/g, '');
    if (phone && (digits.length < 10 || digits.length > 13)) throw badRequest('Enter a valid WhatsApp number', 'PHONE_INVALID');
    const c = await this.card(me);
    const text = c.isPublic ? `Here's my visiting card: ${c.publicUrl}` : `${c.name} · ${c.title} · ${c.company} · ${c.email}${c.phone ? ` · ${c.phone}` : ''}`;
    const url = whatsappLink(digits || null, text);
    await this.prisma.vCardShare.create({ data: { employeeId: me, channel: 'WHATSAPP', recipient: digits || 'picker', status: 'DEEPLINK' } as Prisma.VCardShareUncheckedCreateInput });
    await this.audit.record({ action: 'vcard.shared', entity: 'VCardProfile', entityId: me, meta: { channel: 'WHATSAPP' } });
    return { mode: 'deeplink' as const, url };
  }

  // ── Public page ──────────────────────────────────────────────────────────

  async publicCard(tenantSlug: string, slug: string): Promise<{ status: number; html?: string; vcf?: string; filename?: string }> {
    const t = await this.prisma.raw.tenant.findUnique({ where: { slug: tenantSlug } });
    const wantVcf = slug.endsWith('.vcf');
    const s = wantVcf ? slug.slice(0, -4) : slug;
    const p = t ? await this.prisma.raw.vCardProfile.findUnique({ where: { tenantId_publicSlug: { tenantId: t.id, publicSlug: s } } }) : null;
    const e = p ? await this.prisma.raw.employee.findUnique({ where: { id: p.employeeId }, include: { designation: true, department: true } }) : null;
    const page = (body: string) =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visiting card</title><style>body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:#f7f5f2;color:#201f1d;display:grid;place-items:center;min-height:100vh}.c{background:#fff;border:1px solid #d7d3d3;border-radius:8px;padding:26px;width:min(420px,90vw);box-shadow:0 8px 24px rgba(0,0,0,.06)}.co{font-family:Georgia,serif;font-size:18px}.nm{font-family:Georgia,serif;font-size:28px;margin-top:22px}.ti{font-size:13px;color:#8a6326}.ft{font-size:12.5px;border-top:1px solid #d7d3d3;margin-top:18px;padding-top:8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}a.b{display:inline-block;margin-top:16px;background:#b68235;color:#fff;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:13px}</style></head><body><div class="c">${body}</div></body></html>`;
    const esc = (x: string) => x.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
    if (!t || !p || !e) return { status: 404, html: page('<div class="nm">Card not found</div>') };
    if (!p.isPublic || e.status === 'EXITED') return { status: 410, html: page(`<div class="nm">No longer available</div><div class="ti">${e.status === 'EXITED' ? `No longer with ${esc(t.name)}` : 'This card is private.'}</div>`) };
    const phone = p.showPhone ? (p.workPhone || e.phone || null) : null;
    const vcf = buildVcf({ name: e.fullName, org: t.name, title: e.designation?.name, email: e.officialEmail, phone, url: publicUrl(t.slug, p.publicSlug), linkedin: p.linkedinUrl });
    if (wantVcf) return { status: 200, vcf, filename: `${p.publicSlug}.vcf` };
    return {
      status: 200,
      html: page(
        `<div class="co">${esc(t.name)}</div><div class="nm">${esc(e.fullName)}</div><div class="ti">${esc([e.designation?.name, e.department?.name].filter(Boolean).join(' · '))}</div><div class="ft"><span>${esc(e.officialEmail)}</span>${phone ? `<span>${esc(phone)}</span>` : ''}</div><a class="b" href="${publicUrl(t.slug, p.publicSlug)}.vcf">Add to contacts</a>`,
      ),
    };
  }
}
