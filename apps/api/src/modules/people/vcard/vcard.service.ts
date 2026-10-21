import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { COMPANY_PROFILE_KEY, DEFAULT_COMPANY_PROFILE, DEFAULT_ID_CARD_BG_FIT, VCARD_ACCESS_KEY, companyProfileSchema, type CompanyProfile, vcardAllowed, type IdCardBgFit, type IdCardElement, type IdCardTemplateDto, type IdCardTemplateInput, type VCardAccess, type VCardAccessDto, type VCardDto } from '@lexisora/shared';
import { env } from '../../../config/env';
import { AuditService } from '../../../core/audit/audit.service';
import { forgetVcardAccess, loadVcardAccess } from '../../../core/auth/vcard-access';
import { SettingsService } from '../../../core/settings/settings.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, notFound } from '../../../core/http/errors';
import { MailService, type MailInput } from '../../../core/mail/mail.service';
import { PdfService } from '../../../core/pdf/pdf.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { buildVcf, slugify, whatsappLink } from '../people.rules';
import { IdCardsService } from '../idcards/idcards.service';
import { PT_PER_MM, dataUrlSize, qrDataUrl, renderCardSvg, svgToPng } from '../idcards/card-render';
import { H_MM, W_MM, defaultVisitingFront } from './vcard-default';

const TEMPLATES_KEY = 'people.vcard.templates';
/** The earlier single-template setting, read once to carry an existing design over. */
const OLD_TEMPLATE_KEY = 'people.vcard.template';
type StoredTemplate = { id: string; name: string; front: IdCardElement[]; frontBgFileId: string | null; frontBgFit: IdCardBgFit; /** older saves have no back */ back?: IdCardElement[]; backBgFileId?: string | null; backBgFit?: IdCardBgFit; version: number };
const hasBackSide = (t: { back: IdCardElement[]; backBgFileId?: string | null }) => t.back.length > 0 || !!t.backBgFileId;
type StoredTemplates = { items: StoredTemplate[]; defaultId: string };

const publicUrl = (tenantSlug: string, slug: string) => `${env.WEB_ORIGIN}/api/v1/vcard/c/${tenantSlug}/${slug}`;

/** Digital visiting card (M11): auto-filled from the profile; PNG/PDF/vCard, email + WhatsApp share. */
@Injectable()
export class VcardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly idcards: IdCardsService,
  ) {}

  /** The "who gets a visiting card" setting (HR / admin). */
  async access(): Promise<VCardAccessDto> {
    const [access, roles] = await Promise.all([loadVcardAccess(this.prisma, requireContext().tenantId), this.prisma.role.findMany({ select: { key: true, name: true }, orderBy: { name: 'asc' } })]);
    return { ...access, roleOptions: roles };
  }

  async saveAccess(input: VCardAccess): Promise<VCardAccessDto> {
    const tenantId = requireContext().tenantId;
    const known = new Set((await this.prisma.role.findMany({ select: { key: true } })).map((r) => r.key));
    const roles = input.roles.filter((r) => known.has(r));
    if (input.mode === 'ROLES' && !roles.length) throw badRequest('Choose at least one role', 'VCARD_ROLES_REQUIRED');
    if (input.mode === 'EMPLOYEES' && !input.employeeIds.length) throw badRequest('Choose at least one employee', 'VCARD_EMPLOYEES_REQUIRED');
    const value: VCardAccess = { mode: input.mode, roles, employeeIds: input.employeeIds };
    await this.settings.set(VCARD_ACCESS_KEY, value);
    forgetVcardAccess(tenantId);
    await this.audit.record({ action: 'vcard.access_updated', entity: 'Setting', entityId: VCARD_ACCESS_KEY, meta: { mode: value.mode, roles: value.roles.length, employees: value.employeeIds.length } });
    return this.access();
  }

  // ── Company details shown on the page an ID card QR opens ────────────────

  async companyProfile(): Promise<CompanyProfile> {
    const r = companyProfileSchema.safeParse(await this.settings.get<unknown>(COMPANY_PROFILE_KEY, {}));
    return r.success ? r.data : DEFAULT_COMPANY_PROFILE;
  }

  async saveCompanyProfile(input: CompanyProfile): Promise<CompanyProfile> {
    await this.settings.set(COMPANY_PROFILE_KEY, input);
    await this.audit.record({ action: 'company.profile.updated', entity: 'Setting', entityId: COMPANY_PROFILE_KEY, meta: { website: input.website, hasOfficeEmail: !!input.officeEmail } });
    return this.companyProfile();
  }

  // ── Templates (designed in the visiting card designer; one is the default every card uses) ──

  private async loadTemplates(): Promise<StoredTemplates> {
    const saved = await this.settings.get<StoredTemplates | null>(TEMPLATES_KEY, null);
    if (saved?.items?.length) return saved;
    // First use (or a company that saved the single-template version): start with one template.
    const old = await this.settings.get<Omit<StoredTemplate, 'id'> | null>(OLD_TEMPLATE_KEY, null);
    const first: StoredTemplate = { id: 'corporate', name: old?.name ?? 'Corporate', front: old?.front ?? defaultVisitingFront(), frontBgFileId: old?.frontBgFileId ?? null, frontBgFit: old?.frontBgFit ?? DEFAULT_ID_CARD_BG_FIT, version: old?.version ?? 1 };
    return { items: [first], defaultId: first.id };
  }

  private tplDto(t: StoredTemplate, defaultId: string): IdCardTemplateDto {
    return {
      id: t.id,
      name: t.name,
      orientation: 'LANDSCAPE',
      front: t.front,
      back: t.back ?? [],
      frontBgFileId: t.frontBgFileId,
      backBgFileId: t.backBgFileId ?? null,
      frontBgFit: t.frontBgFit,
      backBgFit: t.backBgFit ?? DEFAULT_ID_CARD_BG_FIT,
      isDefault: t.id === defaultId,
      widthMm: W_MM,
      heightMm: H_MM,
      version: t.version,
    };
  }

  async templates(): Promise<IdCardTemplateDto[]> {
    const { items, defaultId } = await this.loadTemplates();
    return items.map((t) => this.tplDto(t, defaultId)).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  /** The template every visiting card is drawn with. */
  private async defaultTemplate(): Promise<IdCardTemplateDto> {
    const { items, defaultId } = await this.loadTemplates();
    return this.tplDto(items.find((t) => t.id === defaultId) ?? items[0]!, items.find((t) => t.id === defaultId)?.id ?? items[0]!.id);
  }

  private async saveTemplates(v: StoredTemplates) {
    await this.settings.set(TEMPLATES_KEY, v);
  }

  async createTemplate(i: IdCardTemplateInput): Promise<IdCardTemplateDto> {
    const cur = await this.loadTemplates();
    if (cur.items.length >= 20) throw badRequest('You can keep up to 20 visiting card templates', 'VCARD_TEMPLATE_LIMIT');
    const t: StoredTemplate = { id: randomBytes(6).toString('hex'), name: i.name, front: i.front, frontBgFileId: i.frontBgFileId ?? null, frontBgFit: i.frontBgFit ?? DEFAULT_ID_CARD_BG_FIT, back: i.back, backBgFileId: i.backBgFileId ?? null, backBgFit: i.backBgFit ?? DEFAULT_ID_CARD_BG_FIT, version: 1 };
    const next = { items: [...cur.items, t], defaultId: i.isDefault ? t.id : cur.defaultId };
    await this.saveTemplates(next);
    await this.audit.record({ action: 'vcard.template.created', entity: 'Setting', entityId: t.id, meta: { name: t.name } });
    return this.tplDto(t, next.defaultId);
  }

  async updateTemplate(id: string, i: IdCardTemplateInput): Promise<IdCardTemplateDto> {
    const cur = await this.loadTemplates();
    const old = cur.items.find((t) => t.id === id);
    if (!old) throw notFound('Template');
    const t: StoredTemplate = { id, name: i.name, front: i.front, frontBgFileId: i.frontBgFileId ?? null, frontBgFit: i.frontBgFit ?? DEFAULT_ID_CARD_BG_FIT, back: i.back, backBgFileId: i.backBgFileId ?? null, backBgFit: i.backBgFit ?? DEFAULT_ID_CARD_BG_FIT, version: old.version + 1 };
    const next = { items: cur.items.map((x) => (x.id === id ? t : x)), defaultId: i.isDefault ? id : cur.defaultId };
    await this.saveTemplates(next);
    await this.audit.record({ action: 'vcard.template.published', entity: 'Setting', entityId: id, meta: { version: t.version, elements: t.front.length, backElements: i.back.length } });
    return this.tplDto(t, next.defaultId);
  }

  /** Delete a visiting card template. The default cannot be deleted (every card is drawn from it). */
  async deleteTemplate(id: string) {
    const cur = await this.loadTemplates();
    if (!cur.items.some((t) => t.id === id)) throw notFound('Template');
    if (cur.defaultId === id) throw badRequest('Make another template the default before deleting this one', 'TEMPLATE_IS_DEFAULT');
    await this.saveTemplates({ items: cur.items.filter((t) => t.id !== id), defaultId: cur.defaultId });
    await this.audit.record({ action: 'vcard.template.deleted', entity: 'Setting', entityId: id });
    return { ok: true };
  }

  async setDefaultTemplate(id: string) {
    const cur = await this.loadTemplates();
    if (!cur.items.some((t) => t.id === id)) throw notFound('Template');
    await this.saveTemplates({ items: cur.items, defaultId: id });
    await this.audit.record({ action: 'vcard.template.default', entity: 'Setting', entityId: id });
    return { ok: true };
  }

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
    const hasBack = hasBackSide(await this.defaultTemplate());
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
      hasBack,
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

  async png(employeeId = this.meId(), side: 'front' | 'back' = 'front'): Promise<Buffer> {
    const c = await this.card(employeeId);
    const tpl = await this.defaultTemplate();
    const data = await this.idcards.dataFor(employeeId);
    // The card shows what the employee chose to share; the QR is drawn from the card's own link.
    data['employee.email'] = c.email;
    data['employee.mobile'] = c.phone;
    data['qr.verify_url'] = 'x';
    const els = side === 'back' ? tpl.back : tpl.front;
    const photo = await this.idcards.image(data['employee.photo']);
    const bg = await this.idcards.image(side === 'back' ? tpl.backBgFileId : tpl.frontBgFileId, 1100);
    const custom: Record<string, string | null> = {};
    for (const el of els) if (el.type === 'IMAGE' && el.fileId && !(el.fileId in custom)) custom[el.fileId] = await this.idcards.image(el.fileId, 900);
    const svg = renderCardSvg(
      { widthMm: W_MM, heightMm: H_MM, elements: els },
      data,
      { photo, photoSize: await dataUrlSize(photo), logo: await this.idcards.image(data['tenant.logo'], 400), qr: c.qrDataUrl, bg, bgSize: await dataUrlSize(bg), bgFit: (side === 'back' ? tpl.backBgFit : tpl.frontBgFit) ?? undefined, custom },
    );
    return svgToPng(svg);
  }

  async pdfFile(employeeId = this.meId()): Promise<Buffer> {
    const pages = [await this.png(employeeId)];
    if (hasBackSide(await this.defaultTemplate())) pages.push(await this.png(employeeId, 'back'));
    const bleed = 3 * PT_PER_MM;
    const w = W_MM * PT_PER_MM;
    const h = H_MM * PT_PER_MM;
    return this.pdf.render(
      (doc) => {
        pages.forEach((png, i) => {
          if (i > 0) doc.addPage({ size: [w + 2 * bleed, h + 2 * bleed], margin: 0 });
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
        });
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
    const back = hasBackSide(await this.defaultTemplate()) ? await this.png(me, 'back') : null;
    const mail: MailInput & { replyTo: string } = {
      to,
      replyTo: c.email,
      subject: `${c.name} · ${c.company} visiting card`,
      text: `${message ? `${message}\n\n` : ''}${c.name}\n${c.title}\n${c.company}\n${c.email}${c.phone ? `\n${c.phone}` : ''}${c.isPublic ? `\n\nView online: ${c.publicUrl}` : ''}\n\nThe card image and a contact file (.vcf) are attached.`,
      attachments: [
        { filename: `${c.slug}.png`, content: png, contentType: 'image/png' },
        ...(back ? [{ filename: `${c.slug}-back.png`, content: back, contentType: 'image/png' }] : []),
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
    const e = p ? await this.prisma.raw.employee.findUnique({ where: { id: p.employeeId }, include: { designation: true, department: true, user: { include: { role: true } } } }) : null;
    // A card for someone the visiting-card setting no longer covers stops working, same as a private card.
    const covered = t && e ? vcardAllowed(await loadVcardAccess(this.prisma, t.id), { roleKey: e.user?.role.key, employeeId: e.id }) : true;
    const page = (body: string) =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visiting card</title><style>body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:#f7f5f2;color:#201f1d;display:grid;place-items:center;min-height:100vh}.c{background:#fff;border:1px solid #d7d3d3;border-radius:8px;padding:26px;width:min(420px,90vw);box-shadow:0 8px 24px rgba(0,0,0,.06)}.co{font-family:Georgia,serif;font-size:18px}.nm{font-family:Georgia,serif;font-size:28px;margin-top:22px}.ti{font-size:13px;color:#8a6326}.ft{font-size:12.5px;border-top:1px solid #d7d3d3;margin-top:18px;padding-top:8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}a.b{display:inline-block;margin-top:16px;background:#b68235;color:#fff;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:13px}</style></head><body><div class="c">${body}</div></body></html>`;
    const esc = (x: string) => x.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
    if (!t || !p || !e) return { status: 404, html: page('<div class="nm">Card not found</div>') };
    if (!p.isPublic || !covered || e.status === 'EXITED') return { status: 410, html: page(`<div class="nm">No longer available</div><div class="ti">${e.status === 'EXITED' ? `No longer with ${esc(t.name)}` : 'This card is private.'}</div>`) };
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
