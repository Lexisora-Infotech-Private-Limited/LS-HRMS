import { Injectable, Logger } from '@nestjs/common';
import type { IdCard, IdCardTemplate, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { COMPANY_PROFILE_KEY, DEFAULT_COMPANY_PROFILE, DEFAULT_ID_CARD_BG_FIT, DEFAULT_ID_CARD_PHOTO_FRAME, companyProfileSchema, idCardPhotoPlacement, type IdCardBgFit, type IdCardElement, type IdCardPreviewData, IdCardRow, IdCardSettings, IdCardTemplateDto, IdCardTemplateInput } from '@lexisora/shared';
import { env } from '../../../config/env';
import { AuditService } from '../../../core/audit/audit.service';
import { getContext, requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { MailService } from '../../../core/mail/mail.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PdfService } from '../../../core/pdf/pdf.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SequenceService } from '../../../core/registry/sequence.service';
import { SettingsService } from '../../../core/settings/settings.service';
import { StorageService } from '../../../core/storage/storage.service';
import { buildVcf, idCardMissing, MISSING_LABELS } from '../people.rules';
import { pickTemplateId } from './template-choice';
import { dbDateKey, fmt, fmtStamp } from '../people.util';
import { renderScanPage } from './scan-page';
import { brandedQrDataUrl, cardDate, cardMobile, classicPortrait, darkenHex, dataUrlSize, landscapeMinimal, PT_PER_MM, qrDataUrl, renderCardSvg, svgToPng, toDataUrl } from './card-render';

const SETTINGS_KEY = 'people.idcard.settings';
/** employee id → the ID card template chosen for that person (everyone else uses the default). */
const EMPLOYEE_TEMPLATES_KEY = 'people.idcard.employeeTemplates';
/** role key → the ID card template for everyone in that role (unless they have their own). */
const ROLE_TEMPLATES_KEY = 'people.idcard.roleTemplates';
const ACTIVE: IdCard['status'][] = ['QUEUED', 'READY', 'SENT_TO_PRINT', 'PRINTED', 'ISSUED'];
const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Queued',
  READY: 'Ready',
  SENT_TO_PRINT: 'Sent to print',
  PRINTED: 'Printed',
  ISSUED: 'Issued',
  REVOKED: 'Revoked',
  REPLACED: 'Replaced',
  SURRENDERED: 'Surrendered',
  VOID: 'Void',
};

type EmpForCard = Prisma.EmployeeGetPayload<{ include: { designation: true; department: true } }>;

export const verifyUrl = (token: string) => `${env.WEB_ORIGIN}/api/v1/id-cards/verify/${token}`;

/** ID card designer, generation, print batches and public QR verification (M10). */
@Injectable()
export class IdCardsService {
  private readonly log = new Logger('IdCards');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsSvc: SettingsService,
    private readonly seq: SequenceService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    private readonly mail: MailService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ── Settings ─────────────────────────────────────────────────────────────

  async settings(): Promise<IdCardSettings> {
    const t = await this.prisma.raw.tenant.findUnique({ where: { id: requireContext().tenantId } });
    const company = t?.brandName ? `${t.legalName ?? t.name}` : (t?.name ?? 'Lexisora');
    return this.settingsSvc.get<IdCardSettings>(SETTINGS_KEY, {
      printVendorEmail: 'print@shreeprints.in',
      printVendorName: 'Shree Prints',
      returnAddress: `${t?.name ?? company}, ${t?.address?.split(',')[0] ?? ''}${t?.city ? `, ${t.city}` : ''}`.replace(/, ,/g, ','),
      emergencyLine: t?.phone ?? null,
      autoGenerate: false,
      requireBloodGroup: true,
    });
  }

  async saveSettings(s: IdCardSettings) {
    await this.settingsSvc.set(SETTINGS_KEY, s);
    await this.audit.record({ action: 'idcard.settings_updated', entity: 'Setting', entityId: SETTINGS_KEY, meta: { printVendorEmail: s.printVendorEmail } });
    return this.settings();
  }

  // ── Templates ────────────────────────────────────────────────────────────

  async ensureTemplates() {
    if (await this.prisma.idCardTemplate.count()) return;
    const c = classicPortrait();
    const l = landscapeMinimal();
    await this.prisma.idCardTemplate.create({ data: { name: 'Classic portrait', orientation: 'PORTRAIT', widthMm: 53.98, heightMm: 85.6, front: c.front, back: c.back, isDefault: true } as unknown as Prisma.IdCardTemplateUncheckedCreateInput });
    await this.prisma.idCardTemplate.create({ data: { name: 'Landscape minimal', orientation: 'LANDSCAPE', widthMm: 85.6, heightMm: 53.98, front: l.front, back: l.back, isDefault: false } as unknown as Prisma.IdCardTemplateUncheckedCreateInput });
  }

  private tplDto(t: IdCardTemplate): IdCardTemplateDto {
    return {
      id: t.id,
      name: t.name,
      orientation: t.orientation as 'PORTRAIT' | 'LANDSCAPE',
      front: t.front as unknown as IdCardElement[],
      back: t.back as unknown as IdCardElement[],
      frontBgFileId: t.frontBgFileId,
      backBgFileId: t.backBgFileId,
      frontBgFit: (t.frontBgFit as IdCardBgFit | null) ?? DEFAULT_ID_CARD_BG_FIT,
      backBgFit: (t.backBgFit as IdCardBgFit | null) ?? DEFAULT_ID_CARD_BG_FIT,
      isDefault: t.isDefault,
      widthMm: t.widthMm,
      heightMm: t.heightMm,
      version: t.version,
    };
  }

  async templates(): Promise<IdCardTemplateDto[]> {
    await this.ensureTemplates();
    const rows = await this.prisma.idCardTemplate.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    return rows.map((r) => this.tplDto(r));
  }

  async createTemplate(i: IdCardTemplateInput) {
    const dims = i.orientation === 'LANDSCAPE' ? { widthMm: 85.6, heightMm: 53.98 } : { widthMm: 53.98, heightMm: 85.6 };
    const row = await this.prisma.idCardTemplate.create({
      data: { name: i.name, orientation: i.orientation, ...dims, front: i.front, back: i.back, frontBgFileId: i.frontBgFileId ?? null, backBgFileId: i.backBgFileId ?? null, frontBgFit: i.frontBgFit ?? DEFAULT_ID_CARD_BG_FIT, backBgFit: i.backBgFit ?? DEFAULT_ID_CARD_BG_FIT, isDefault: false } as unknown as Prisma.IdCardTemplateUncheckedCreateInput,
    });
    if (i.isDefault) await this.setDefault(row.id);
    await this.audit.record({ action: 'idcard.template.created', entity: 'IdCardTemplate', entityId: row.id, meta: { name: i.name } });
    return this.tplDto((await this.prisma.idCardTemplate.findUnique({ where: { id: row.id } }))!);
  }

  async updateTemplate(id: string, i: IdCardTemplateInput) {
    const t = await this.prisma.idCardTemplate.findUnique({ where: { id } });
    if (!t) throw notFound('Template');
    const dims = i.orientation === 'LANDSCAPE' ? { widthMm: 85.6, heightMm: 53.98 } : { widthMm: 53.98, heightMm: 85.6 };
    await this.prisma.idCardTemplate.update({
      where: { id },
      data: { name: i.name, orientation: i.orientation, ...dims, front: i.front, back: i.back, frontBgFileId: i.frontBgFileId ?? null, backBgFileId: i.backBgFileId ?? null, frontBgFit: i.frontBgFit ?? DEFAULT_ID_CARD_BG_FIT, backBgFit: i.backBgFit ?? DEFAULT_ID_CARD_BG_FIT, version: t.version + 1 },
    });
    if (i.isDefault) await this.setDefault(id);
    await this.audit.record({ action: 'idcard.template.published', entity: 'IdCardTemplate', entityId: id, meta: { version: t.version + 1 } });
    return this.tplDto((await this.prisma.idCardTemplate.findUnique({ where: { id } }))!);
  }

  /**
   * Delete a template (it is archived, so cards already printed or issued with it still preview). The default cannot be deleted. Anyone assigned
   * to it, by person or by role, goes back to the default, and cards still waiting to print are redrawn with what they should now use.
   */
  async deleteTemplate(id: string) {
    const t = await this.prisma.idCardTemplate.findUnique({ where: { id } });
    if (!t || t.status === 'ARCHIVED') throw notFound('Template');
    if (t.isDefault) throw badRequest('Make another template the default before deleting this one', 'TEMPLATE_IS_DEFAULT');
    const [own, byRole] = await Promise.all([this.employeeTemplateChoices(), this.roleTemplateChoices()]);
    const people = Object.values(own).filter((v) => v === id).length;
    const roles = Object.values(byRole).filter((v) => v === id).length;
    await this.prisma.idCardTemplate.update({ where: { id }, data: { status: 'ARCHIVED' } });
    if (people) await this.settingsSvc.set(EMPLOYEE_TEMPLATES_KEY, Object.fromEntries(Object.entries(own).filter(([, v]) => v !== id)));
    if (roles) await this.settingsSvc.set(ROLE_TEMPLATES_KEY, Object.fromEntries(Object.entries(byRole).filter(([, v]) => v !== id)));
    const r = await this.reapplyWaiting();
    await this.audit.record({ action: 'idcard.template.deleted', entity: 'IdCardTemplate', entityId: id, meta: { name: t.name, people, roles, ...r } });
    return { ok: true, people, roles, ...r };
  }

  async setDefault(id: string) {
    if (!(await this.prisma.idCardTemplate.findUnique({ where: { id } }))) throw notFound('Template');
    await this.prisma.idCardTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    await this.prisma.idCardTemplate.update({ where: { id }, data: { isDefault: true } });
    // Cards not yet sent to print follow the rules again (a person's own template, then their role's, then this default).
    const { moved, regenerated } = await this.reapplyWaiting();
    await this.audit.record({ action: 'idcard.template.default', entity: 'IdCardTemplate', entityId: id, meta: { moved, regenerated } });
    return { ok: true, moved, regenerated };
  }

  private async employeeTemplateChoices(): Promise<Record<string, string>> {
    return this.settingsSvc.get<Record<string, string>>(EMPLOYEE_TEMPLATES_KEY, {});
  }

  private async availableTemplateIds(): Promise<Set<string>> {
    return new Set((await this.prisma.idCardTemplate.findMany({ where: { status: { not: 'ARCHIVED' } }, select: { id: true } })).map((t) => t.id));
  }

  private async roleTemplateChoices(): Promise<Record<string, string>> {
    return this.settingsSvc.get<Record<string, string>>(ROLE_TEMPLATES_KEY, {});
  }

  /** employee id → role key (null when the person has no sign-in account). */
  private async rolesOf(employeeIds: string[]): Promise<Map<string, string | null>> {
    const rows = await this.prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, user: { select: { role: { select: { key: true } } } } } });
    return new Map(rows.map((r) => [r.id, r.user?.role.key ?? null]));
  }

  /** Works out the template id for many people with one set of lookups. */
  private async resolver() {
    const [def, own, byRole, available] = await Promise.all([this.defaultTemplate(), this.employeeTemplateChoices(), this.roleTemplateChoices(), this.availableTemplateIds()]);
    return { def, pick: (employeeId: string, roleKey: string | null) => pickTemplateId(own, employeeId, byRole, roleKey, available, def.id) };
  }

  /** The template this person's card is made with: their own choice, else their role's, else the company default. */
  private async templateFor(employeeId: string): Promise<IdCardTemplate> {
    const { def, pick } = await this.resolver();
    const id = pick(employeeId, (await this.rolesOf([employeeId])).get(employeeId) ?? null);
    return id === def.id ? def : ((await this.prisma.idCardTemplate.findUnique({ where: { id } })) ?? def);
  }

  /**
   * Cards not yet sent to print follow the rules again: moved to the template they should now use, and drawn again if they were Ready.
   * Used after the default template or a role's template changes.
   */
  private async reapplyWaiting(): Promise<{ moved: number; regenerated: number }> {
    const cards = await this.prisma.idCard.findMany({ where: { status: { in: ['QUEUED', 'READY'] } }, select: { id: true, employeeId: true, status: true, templateId: true } });
    const { pick } = await this.resolver();
    const roles = await this.rolesOf([...new Set(cards.map((c) => c.employeeId))]);
    const changed = cards.map((c) => ({ ...c, to: pick(c.employeeId, roles.get(c.employeeId) ?? null) })).filter((c) => c.to !== c.templateId);
    for (const c of changed) await this.prisma.idCard.update({ where: { id: c.id }, data: { templateId: c.to } });
    const ready = changed.filter((c) => c.status === 'READY');
    let regenerated = 0;
    if (ready.length) {
      try {
        regenerated = (await this.generate({ cardIds: ready.map((c) => c.id) })).generated;
      } catch (e) {
        this.log.warn(`Could not redraw ready cards after a template change: ${(e as Error).message}`);
      }
    }
    return { moved: changed.length, regenerated };
  }

  /** Every role with the template set for it (blank = the company default). */
  async roleTemplates() {
    const [roles, choices, available] = await Promise.all([this.prisma.role.findMany({ select: { key: true, name: true } }), this.roleTemplateChoices(), this.availableTemplateIds()]);
    const order = ['employee', 'lead', 'manager', 'hr', 'admin'];
    roles.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99) || a.name.localeCompare(b.name));
    return { roles, choices: Object.fromEntries(Object.entries(choices).filter(([k, v]) => roles.some((r) => r.key === k) && available.has(v))) };
  }

  /** Save the template for each role (null = the company default), then bring waiting cards in line. */
  async setRoleTemplates(input: Record<string, string | null>) {
    const [roles, available] = await Promise.all([this.prisma.role.findMany({ select: { key: true } }), this.availableTemplateIds()]);
    const known = new Set(roles.map((r) => r.key));
    const next: Record<string, string> = {};
    for (const [role, tpl] of Object.entries(input)) {
      if (!known.has(role)) throw notFound('Role');
      if (tpl) {
        if (!available.has(tpl)) throw notFound('Template');
        next[role] = tpl;
      }
    }
    await this.settingsSvc.set(ROLE_TEMPLATES_KEY, next);
    const r = await this.reapplyWaiting();
    await this.audit.record({ action: 'idcard.role_templates', entity: 'Setting', entityId: ROLE_TEMPLATES_KEY, meta: { roles: Object.keys(next).length, ...r } });
    return { ...(await this.roleTemplates()), ...r };
  }

  /**
   * Choose the template for one person (null = back to the company default). A card that has not gone to print yet is redrawn with it
   * straight away; a card already sent to print, printed or issued keeps what was printed, and the choice applies when it is reissued.
   */
  async setEmployeeTemplate(employeeId: string, templateId: string | null) {
    await this.employee(employeeId);
    if (templateId && !(await this.availableTemplateIds()).has(templateId)) throw notFound('Template');
    const choices = { ...(await this.employeeTemplateChoices()) };
    if (templateId) choices[employeeId] = templateId;
    else delete choices[employeeId];
    await this.settingsSvc.set(EMPLOYEE_TEMPLATES_KEY, choices);
    const tpl = await this.templateFor(employeeId);
    const card = await this.prisma.idCard.findFirst({ where: { employeeId, status: { in: ACTIVE } }, orderBy: { createdAt: 'desc' } });
    let applied: 'NOW' | 'ON_REISSUE' | 'NO_CARD' = 'NO_CARD';
    if (card && ['QUEUED', 'READY'].includes(card.status)) {
      await this.prisma.idCard.update({ where: { id: card.id }, data: { templateId: tpl.id } });
      applied = 'NOW';
      if (card.status === 'READY') await this.generate({ cardIds: [card.id] }).catch((e) => this.log.warn(`Could not redraw the card after choosing a template: ${(e as Error).message}`));
    } else if (card) applied = 'ON_REISSUE';
    await this.audit.record({ action: 'idcard.employee_template', entity: 'IdCard', entityId: card?.id ?? employeeId, meta: { employeeId, templateId: templateId ?? 'default', template: tpl.name, applied } });
    return { template: tpl.name, isDefault: tpl.isDefault, applied };
  }

  private async defaultTemplate(): Promise<IdCardTemplate> {
    await this.ensureTemplates();
    return (await this.prisma.idCardTemplate.findFirst({ where: { isDefault: true } })) ?? (await this.prisma.idCardTemplate.findFirstOrThrow({ orderBy: { createdAt: 'asc' } }));
  }

  // ── Data binding ─────────────────────────────────────────────────────────

  private async employee(id: string): Promise<EmpForCard> {
    const e = await this.prisma.employee.findUnique({ where: { id }, include: { designation: true, department: true } });
    if (!e) throw notFound('Employee');
    return e;
  }

  async cardData(e: EmpForCard, card?: { serial: string; verifyToken: string } | null): Promise<IdCardPreviewData> {
    const s = await this.settings();
    const t = await this.prisma.raw.tenant.findUnique({ where: { id: requireContext().tenantId } });
    return {
      'employee.full_name': e.fullName,
      'employee.emp_code': e.empCode,
      'employee.designation': e.designation?.name ?? null,
      'employee.department': e.department?.name ?? null,
      'employee.blood_group': e.bloodGroup ?? null,
      'employee.photo': e.photoFileId ?? null,
      'employee.emergency_contact': e.emergencyContactName ? `${e.emergencyContactName}${e.emergencyContactPhone ? ` · ${e.emergencyContactPhone}` : ''}` : null,
      'employee.joining_date': cardDate(dbDateKey(e.joiningDate)),
      'employee.dob': cardDate(dbDateKey(e.dateOfBirth)),
      'employee.mobile': cardMobile(e.phone),
      'employee.email': e.officialEmail ?? null,
      'employee.address': e.address ?? null,
      'employee.code_blood': [e.empCode, e.bloodGroup].filter(Boolean).join(' · '),
      'card.serial': card?.serial ?? 'IDC-PREVIEW',
      'qr.verify_url': card ? verifyUrl(card.verifyToken) : `${env.WEB_ORIGIN}/verify`,
      'tenant.name': t?.brandName ? (t.name ?? t.brandName) : (t?.name ?? 'Lexisora'),
      'tenant.logo': t?.logoFileId ?? null,
      'tenant.address': t?.address ?? null,
      'settings.return_address': s.returnAddress ?? null,
      'settings.emergency_line': s.emergencyLine ?? null,
    };
  }

  /** Every card field for one employee (used by the visiting card designer too). */
  async dataFor(employeeId: string): Promise<IdCardPreviewData> {
    return this.cardData(await this.employee(employeeId), null);
  }

  /** A stored picture as a data URL, sized for drawing on a card. */
  image(fileId: string | null | undefined, max = 700): Promise<string | null> {
    return this.imageData(fileId, max);
  }

  private async imageData(fileId: string | null | undefined, max = 700): Promise<string | null> {
    if (!fileId) return null;
    try {
      const { data } = await this.storage.read(fileId, getContext()?.tenantId);
      return toDataUrl(data, max);
    } catch {
      return null;
    }
  }

  /** Render both sides as 300-DPI PNGs. */
  async renderSides(tpl: IdCardTemplate, data: IdCardPreviewData): Promise<{ front: Buffer; back: Buffer }> {
    const photo = await this.imageData(data['employee.photo']);
    const images: import('./card-render').CardImages = {
      photo,
      photoSize: await dataUrlSize(photo),
      logo: await this.imageData(data['tenant.logo'], 400),
      qr: data['qr.verify_url'] ? await qrDataUrl(data['qr.verify_url']) : null,
    };
    const custom: Record<string, string | null> = {};
    for (const el of [...(tpl.front as unknown as IdCardElement[]), ...(tpl.back as unknown as IdCardElement[])]) {
      if (el.type === 'IMAGE' && el.fileId && !(el.fileId in custom)) custom[el.fileId] = await this.imageData(el.fileId, 900);
    }
    // QR elements set to BRANDED are drawn in the company colours with their own centre logo (else the company logo).
    const qrStyled: Record<string, string | null> = {};
    const verify = data['qr.verify_url'];
    const branded = [...(tpl.front as unknown as IdCardElement[]), ...(tpl.back as unknown as IdCardElement[])].filter((e) => e.type === 'QR' && e.qrStyle === 'BRANDED');
    if (verify && branded.length) {
      const colors = await this.companyProfile(tpl.tenantId);
      const from = darkenHex(colors.primaryColor, 0.73);
      const to = darkenHex(colors.secondaryColor, 0.73);
      for (const el of branded) qrStyled[el.id] = await brandedQrDataUrl(verify, { from, to, logo: await this.imageData(el.fileId ?? data['tenant.logo'], 400) });
    }
    images.qrStyled = qrStyled;
    const side = async (els: IdCardElement[], bgFileId: string | null, fit: unknown) => {
      const bg = await this.imageData(bgFileId, 1100);
      return svgToPng(renderCardSvg({ widthMm: tpl.widthMm, heightMm: tpl.heightMm, elements: els }, data, { ...images, custom, bg, bgSize: await dataUrlSize(bg), bgFit: (fit as IdCardBgFit | null) ?? DEFAULT_ID_CARD_BG_FIT }));
    };
    const [front, back] = await Promise.all([side(tpl.front as unknown as IdCardElement[], tpl.frontBgFileId, tpl.frontBgFit), side(tpl.back as unknown as IdCardElement[], tpl.backBgFileId, tpl.backBgFit)]);
    return { front, back };
  }

  /** One PDF page per side at exact card size (CR80), 300-DPI artwork. */
  private async cardsPdf(items: { tpl: IdCardTemplate; front: Buffer; back: Buffer }[]): Promise<Buffer> {
    return this.pdf.render(
      (doc) => {
        items.forEach((it, i) => {
          const size: [number, number] = [it.tpl.widthMm * PT_PER_MM, it.tpl.heightMm * PT_PER_MM];
          for (const [j, png] of [it.front, it.back].entries()) {
            if (i > 0 || j > 0) doc.addPage({ size, margin: 0 });
            doc.image(png, 0, 0, { width: size[0], height: size[1] });
          }
        });
      },
      { size: [items[0]!.tpl.widthMm * PT_PER_MM, items[0]!.tpl.heightMm * PT_PER_MM], margin: 0, info: { Title: 'ID cards', Author: 'Lexisora HRMS' } },
    );
  }

  async previewData(employeeId?: string | null) {
    let id = employeeId;
    if (!id) {
      const q = await this.prisma.idCard.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
      id = q?.employeeId ?? requireContext().employeeId ?? null;
    }
    if (!id) throw notFound('Employee');
    const e = await this.employee(id);
    const card = await this.prisma.idCard.findFirst({ where: { employeeId: id, status: { in: ACTIVE } }, orderBy: { createdAt: 'desc' } });
    const data = await this.cardData(e, card);
    const colors = await this.companyProfile(requireContext().tenantId);
    const link = data['qr.verify_url'] ?? env.WEB_ORIGIN;
    return { employeeId: id, name: e.fullName, data, qrDataUrl: await qrDataUrl(link), qrBrandedDataUrl: await brandedQrDataUrl(link, { from: darkenHex(colors.primaryColor, 0.73), to: darkenHex(colors.secondaryColor, 0.73) }) };
  }

  async previewPng(templateId: string, employeeId: string, side: 'front' | 'back') {
    const tpl = await this.prisma.idCardTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) throw notFound('Template');
    const e = await this.employee(employeeId);
    const card = await this.prisma.idCard.findFirst({ where: { employeeId, status: { in: ACTIVE } } });
    const r = await this.renderSides(tpl, await this.cardData(e, card));
    return side === 'back' ? r.back : r.front;
  }

  // ── Cards ────────────────────────────────────────────────────────────────

  private async missingFor(e: EmpForCard): Promise<string[]> {
    const s = await this.settings();
    return idCardMissing({ photoFileId: e.photoFileId, bloodGroup: e.bloodGroup, designation: e.designation?.name, fullName: e.fullName }, s.requireBloodGroup);
  }

  /** Every employee gets a QUEUED card when added. */
  async ensureCard(employeeId: string): Promise<IdCard> {
    const existing = await this.prisma.idCard.findFirst({ where: { employeeId, status: { in: ACTIVE } }, orderBy: { createdAt: 'desc' } });
    if (existing) return existing;
    const e = await this.employee(employeeId);
    const tpl = await this.templateFor(employeeId);
    const year = new Date().getFullYear();
    const serial = await this.seq.next('idcard.serial', { prefix: `IDC-${year}-`, pad: 4, period: String(year) });
    return this.prisma.idCard.create({
      data: { employeeId, templateId: tpl.id, serial, status: 'QUEUED', missingFields: await this.missingFor(e), verifyToken: randomBytes(16).toString('base64url') } as Prisma.IdCardUncheckedCreateInput,
    });
  }

  /** Recompute missing fields after a profile change; a data change on a generated card needs a regenerate. */
  async refresh(employeeId: string) {
    const card = await this.prisma.idCard.findFirst({ where: { employeeId, status: { in: ACTIVE } }, orderBy: { createdAt: 'desc' } });
    if (!card) return;
    const e = await this.employee(employeeId);
    const missing = await this.missingFor(e);
    if (card.status === 'QUEUED') {
      await this.prisma.idCard.update({ where: { id: card.id }, data: { missingFields: missing } });
      const s = await this.settings();
      if (s.autoGenerate && !missing.length && e.status !== 'ONBOARDING') await this.generate({ cardIds: [card.id] }).catch(() => undefined);
    } else if (card.status === 'READY') {
      // Not yet printed: re-render so the PDF matches the profile.
      await this.prisma.idCard.update({ where: { id: card.id }, data: { status: 'QUEUED', missingFields: missing, printPdfFileId: null } });
    }
  }

  private row(c: IdCard, e: { fullName: string; empCode: string } | undefined, tplName: string | undefined, batch: string | undefined, custom: boolean, byRole = false): IdCardRow {
    return {
      id: c.id,
      templateId: c.templateId,
      customTemplate: custom,
      byRole,
      employeeId: c.employeeId,
      employee: e?.fullName ?? '—',
      empCode: e?.empCode ?? '—',
      template: tplName ?? null,
      status: c.status,
      statusLabel: c.status === 'QUEUED' && c.missingFields.length ? `Waiting for ${c.missingFields.map((m) => MISSING_LABELS[m] ?? m).join(', ')}` : (STATUS_LABEL[c.status] ?? c.status),
      missing: c.missingFields.map((m) => MISSING_LABELS[m] ?? m),
      generatedAt: c.generatedAt?.toISOString() ?? null,
      printBatch: batch ?? null,
      serial: c.serial,
    };
  }

  async cards(status?: string, q?: string) {
    const where: Prisma.IdCardWhereInput = status ? { status: status as IdCard['status'] } : { status: { notIn: ['VOID', 'REPLACED'] } };
    if (q) {
      const emps = await this.prisma.employee.findMany({ where: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { empCode: { contains: q, mode: 'insensitive' } }] }, select: { id: true } });
      where.employeeId = { in: emps.map((e) => e.id) };
    }
    const rows = await this.prisma.idCard.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 300 });
    const [emps, tpls, batches] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, fullName: true, empCode: true } }),
      this.prisma.idCardTemplate.findMany({ select: { id: true, name: true } }),
      this.prisma.idCardPrintBatch.findMany({ where: { id: { in: rows.map((r) => r.printBatchId).filter((x): x is string => !!x) } }, select: { id: true, code: true } }),
    ]);
    const em = new Map(emps.map((e) => [e.id, e]));
    const tm = new Map(tpls.map((t) => [t.id, t.name]));
    const bm = new Map(batches.map((b) => [b.id, b.code]));
    const [choices, byRole, roles] = await Promise.all([this.employeeTemplateChoices(), this.roleTemplateChoices(), this.rolesOf(rows.map((r) => r.employeeId))]);
    return rows.map((c) => {
      const own = !!choices[c.employeeId] && choices[c.employeeId] === c.templateId;
      const role = roles.get(c.employeeId);
      return this.row(c, em.get(c.employeeId), c.templateId ? tm.get(c.templateId) : undefined, c.printBatchId ? bm.get(c.printBatchId) : undefined, own, !own && !!role && !!byRole[role] && byRole[role] === c.templateId);
    });
  }

  async generatable() {
    const queued = await this.prisma.idCard.findMany({ where: { status: 'QUEUED' } });
    // Refresh missing fields so the button count is live.
    const emps = await this.prisma.employee.findMany({ where: { id: { in: queued.map((c) => c.employeeId) } }, include: { designation: true, department: true } });
    const em = new Map(emps.map((e) => [e.id, e]));
    const waiting: { cardId: string; employeeId: string; name: string; missing: string[] }[] = [];
    let count = 0;
    for (const c of queued) {
      const e = em.get(c.employeeId);
      if (!e || e.status === 'EXITED') continue;
      const missing = await this.missingFor(e);
      if (missing.join() !== c.missingFields.join()) await this.prisma.idCard.update({ where: { id: c.id }, data: { missingFields: missing } });
      if (missing.length) waiting.push({ cardId: c.id, employeeId: e.id, name: e.fullName, missing: missing.map((m) => MISSING_LABELS[m] ?? m) });
      else count++;
    }
    const ready = await this.prisma.idCard.count({ where: { status: 'READY' } });
    return { count, waiting, ready };
  }

  async generate(opts: { cardIds?: string[]; allGeneratable?: boolean }) {
    const where: Prisma.IdCardWhereInput = opts.cardIds?.length ? { id: { in: opts.cardIds }, status: { in: ['QUEUED', 'READY'] } } : { status: 'QUEUED' };
    const cards = await this.prisma.idCard.findMany({ where });
    let generated = 0;
    const skipped: string[] = [];
    for (const c of cards) {
      const e = await this.employee(c.employeeId);
      const missing = await this.missingFor(e);
      if (missing.length) {
        await this.prisma.idCard.update({ where: { id: c.id }, data: { missingFields: missing } });
        skipped.push(`${e.fullName}: ${missing.map((m) => MISSING_LABELS[m] ?? m).join(', ')}`);
        continue;
      }
      // A card that has not gone to print yet uses its person's template (or the current default).
      const tpl = await this.templateFor(c.employeeId);
      const data = await this.cardData(e, c);
      const sides = await this.renderSides(tpl, data);
      const pdf = await this.cardsPdf([{ tpl, ...sides }]);
      const f = await this.storage.save({ data: pdf, filename: `${e.empCode}-id-card.pdf`, mime: 'application/pdf', category: 'id-card' });
      await this.prisma.idCard.update({
        where: { id: c.id },
        data: { status: 'READY', missingFields: [], printPdfFileId: f.id, generatedAt: new Date(), templateId: tpl.id, dataSnapshot: data as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record({ action: 'idcard.generated', entity: 'IdCard', entityId: c.id, meta: { employeeId: e.id, serial: c.serial } });
      generated++;
    }
    if (generated) {
      await this.notify.notify({
        userIds: await this.notify.usersWithPermission('idcard.manage'),
        type: 'people.idcardsReady',
        title: `${generated} ID card${generated === 1 ? '' : 's'} ready to print`,
        link: '/id-card?tab=cards',
        from: 'System',
      });
    }
    return { generated, skipped };
  }

  private async assertCardAccess(c: IdCard) {
    const ctx = requireContext();
    const hr = ctx.permissions.has('*') || ctx.permissions.has('idcard.manage') || ctx.permissions.has('employees.manage');
    if (!hr && ctx.employeeId !== c.employeeId) throw forbidden();
  }

  async cardPdf(id: string): Promise<{ pdf: Buffer; filename: string }> {
    const c = await this.prisma.idCard.findUnique({ where: { id } });
    if (!c) throw notFound('ID card');
    await this.assertCardAccess(c);
    const e = await this.employee(c.employeeId);
    // Once a card has gone to print, its saved file is the record of what was printed. Until then the download is drawn
    // fresh from the current template, so it always matches the designer.
    if (c.printPdfFileId && !['QUEUED', 'READY'].includes(c.status)) {
      const { data } = await this.storage.read(c.printPdfFileId);
      return { pdf: data, filename: `${e.empCode}-id-card.pdf` };
    }
    const tpl = (c.templateId && (await this.prisma.idCardTemplate.findUnique({ where: { id: c.templateId } }))) || (await this.defaultTemplate());
    const data = c.status === 'READY' ? ((c.dataSnapshot as unknown as IdCardPreviewData | null) ?? (await this.cardData(e, c))) : await this.cardData(e, c);
    const sides = await this.renderSides(tpl, data);
    return { pdf: await this.cardsPdf([{ tpl, ...sides }]), filename: `${e.empCode}-id-card${c.status === 'READY' ? '' : '-preview'}.pdf` };
  }

  async cardPng(id: string, side: 'front' | 'back'): Promise<Buffer> {
    const c = await this.prisma.idCard.findUnique({ where: { id } });
    if (!c) throw notFound('ID card');
    await this.assertCardAccess(c);
    const e = await this.employee(c.employeeId);
    const tpl = (c.templateId && (await this.prisma.idCardTemplate.findUnique({ where: { id: c.templateId } }))) || (await this.defaultTemplate());
    const data = (c.dataSnapshot as unknown as IdCardPreviewData | null) ?? (await this.cardData(e, c));
    const sides = await this.renderSides(tpl, data);
    return side === 'back' ? sides.back : sides.front;
  }

  async myCard() {
    const me = requireContext().employeeId;
    if (!me) throw notFound('Employee');
    const c = await this.prisma.idCard.findFirst({ where: { employeeId: me, status: { in: ACTIVE } }, orderBy: { createdAt: 'desc' } });
    if (!c) return null;
    return this.row(c, await this.prisma.employee.findUnique({ where: { id: me }, select: { fullName: true, empCode: true } }) ?? undefined, undefined, undefined, false);
  }

  // ── Print batches ────────────────────────────────────────────────────────

  async sendToPrint(opts: { cardIds?: string[]; allReady?: boolean }) {
    const ctx = requireContext();
    const s = await this.settings();
    if (!s.printVendorEmail) throw badRequest('Set the print vendor email first', 'VENDOR_MISSING');
    const cards = await this.prisma.idCard.findMany({ where: { status: 'READY', ...(opts.cardIds?.length ? { id: { in: opts.cardIds } } : {}) }, orderBy: { createdAt: 'asc' } });
    if (!cards.length) throw new AppError(409, 'NOTHING_TO_PRINT', 'No ready ID cards to send. Generate cards first.');
    const items: { tpl: IdCardTemplate; front: Buffer; back: Buffer }[] = [];
    for (const c of cards) {
      const e = await this.employee(c.employeeId);
      const tpl = (c.templateId && (await this.prisma.idCardTemplate.findUnique({ where: { id: c.templateId } }))) || (await this.defaultTemplate());
      const data = (c.dataSnapshot as unknown as IdCardPreviewData | null) ?? (await this.cardData(e, c));
      items.push({ tpl, ...(await this.renderSides(tpl, data)) });
    }
    const pdf = await this.cardsPdf(items);
    const code = await this.seq.next('idcard.printBatch', { prefix: 'PB-', pad: 3 });
    const file = await this.storage.save({ data: pdf, filename: `${code}-id-cards.pdf`, mime: 'application/pdf', category: 'id-card' });
    const t = await this.prisma.raw.tenant.findUnique({ where: { id: ctx.tenantId } });
    const me = ctx.userId ? await this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }) : null;
    const sent = await this.mail.send({
      to: s.printVendorEmail,
      cc: me?.email,
      subject: `ID cards · ${t?.name ?? 'Lexisora'} · batch ${code} · ${cards.length} cards`,
      text: `Hello ${s.printVendorName ?? ''},\n\nPlease print the attached ${cards.length} ID card${cards.length === 1 ? '' : 's'} (CR80, front and back, 300 DPI artwork, ${cards.length * 2} pages).\n\nBatch: ${code}\n\n— ${ctx.userName ?? 'HR'}, ${t?.name ?? ''}`,
      attachments: [{ filename: `${code}-id-cards.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    const batch = await this.prisma.idCardPrintBatch.create({
      data: { code, vendorEmail: s.printVendorEmail, cardCount: cards.length, pdfFileId: file.id, status: sent ? 'SENT' : 'FAILED', sentAt: new Date(), sentByName: ctx.userName ?? null } as Prisma.IdCardPrintBatchUncheckedCreateInput,
    });
    if (!sent) throw new AppError(502, 'MAIL_FAILED', 'Could not email the print vendor; the batch is saved as failed');
    await this.prisma.idCard.updateMany({ where: { id: { in: cards.map((c) => c.id) } }, data: { status: 'SENT_TO_PRINT', printBatchId: batch.id } });
    await this.audit.record({ action: 'idcard.sent_to_print', entity: 'IdCardPrintBatch', entityId: batch.id, meta: { cards: cards.length, vendor: s.printVendorEmail } });
    return { batchId: batch.id, code, cards: cards.length, vendorEmail: s.printVendorEmail };
  }

  async batches() {
    const rows = await this.prisma.idCardPrintBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((b) => ({ id: b.id, code: b.code, sentAt: b.sentAt?.toISOString() ?? null, cards: b.cardCount, vendor: b.vendorEmail, status: b.status, pdfFileId: b.pdfFileId, sentBy: b.sentByName }));
  }

  async setBatchStatus(id: string, status: 'ACKNOWLEDGED' | 'DELIVERED') {
    const b = await this.prisma.idCardPrintBatch.findUnique({ where: { id } });
    if (!b) throw notFound('Print batch');
    await this.prisma.idCardPrintBatch.update({ where: { id }, data: { status } });
    if (status === 'DELIVERED') await this.prisma.idCard.updateMany({ where: { printBatchId: id, status: 'SENT_TO_PRINT' }, data: { status: 'PRINTED' } });
    await this.audit.record({ action: 'idcard.batch_' + status.toLowerCase(), entity: 'IdCardPrintBatch', entityId: id });
    return { ok: true };
  }

  // ── Card lifecycle ───────────────────────────────────────────────────────

  async markIssued(id: string) {
    const c = await this.prisma.idCard.findUnique({ where: { id } });
    if (!c) throw notFound('ID card');
    if (!['READY', 'SENT_TO_PRINT', 'PRINTED'].includes(c.status)) throw new AppError(409, 'INVALID_STATUS', 'Only generated or printed cards can be issued');
    await this.prisma.idCard.update({ where: { id }, data: { status: 'ISSUED', issuedAt: new Date() } });
    await this.notify.notify({ userIds: await this.notify.usersForEmployees([c.employeeId]), type: 'people.idcardIssued', title: 'Your ID card has been issued', body: 'Collect it from the HR desk if you have not already.', link: '/me', from: 'HR' });
    await this.audit.record({ action: 'idcard.issued', entity: 'IdCard', entityId: id });
    return { ok: true };
  }

  async revoke(id: string, reason: string) {
    const c = await this.prisma.idCard.findUnique({ where: { id } });
    if (!c) throw notFound('ID card');
    await this.prisma.idCard.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason } });
    await this.audit.record({ action: 'idcard.revoked', entity: 'IdCard', entityId: id, meta: { reason } });
    return { ok: true };
  }

  async reissue(employeeId: string, reason: string) {
    const old = await this.prisma.idCard.findFirst({ where: { employeeId, status: { in: [...ACTIVE, 'REVOKED'] } }, orderBy: { createdAt: 'desc' } });
    if (old) await this.prisma.idCard.update({ where: { id: old.id }, data: { status: old.status === 'QUEUED' ? 'VOID' : 'REPLACED', revokedAt: new Date(), revokeReason: reason } });
    const card = await this.ensureCard(employeeId);
    await this.audit.record({ action: 'idcard.reissued', entity: 'IdCard', entityId: card.id, meta: { reason, previous: old?.id ?? null } });
    return this.row(card, (await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { fullName: true, empCode: true } })) ?? undefined, undefined, undefined, false);
  }

  async surrender(employeeId: string) {
    await this.prisma.idCard.updateMany({ where: { employeeId, status: { in: ['READY', 'SENT_TO_PRINT', 'PRINTED', 'ISSUED'] } }, data: { status: 'SURRENDERED', revokedAt: new Date(), revokeReason: 'EXITED' } });
    await this.prisma.idCard.updateMany({ where: { employeeId, status: 'QUEUED' }, data: { status: 'VOID' } });
  }

  async revokeForExit(employeeId: string) {
    await this.prisma.idCard.updateMany({ where: { employeeId, status: { in: ['READY', 'SENT_TO_PRINT', 'PRINTED', 'ISSUED'] } }, data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'EXITED' } });
    await this.prisma.idCard.updateMany({ where: { employeeId, status: 'QUEUED' }, data: { status: 'VOID' } });
  }

  // ── Public verification (QR) ─────────────────────────────────────────────

  /** The company details for the scan page (blank fields stay blank; colours and tagline have defaults). */
  private async companyProfile(tenantId: string) {
    const raw = await this.settingsSvc.getFor<unknown>(tenantId, COMPANY_PROFILE_KEY, {});
    const r = companyProfileSchema.safeParse(raw);
    return r.success ? r.data : DEFAULT_COMPANY_PROFILE;
  }

  /** What the employee chose to share on their card, for the page a scanned ID card opens. */
  private async sharing(employeeId: string, e: { phone: string | null }) {
    const p = await this.prisma.raw.vCardProfile.findUnique({ where: { employeeId } });
    return { isPublic: p?.isPublic ?? true, phone: (p?.showPhone ?? true) ? (p?.workPhone || e.phone || null) : null, linkedin: p?.linkedinUrl ?? null };
  }

  /** The page a scanned ID card QR opens: a digital profile card (photo, contact details, Save Contact, company information). */
  async verifyHtml(token: string): Promise<{ status: number; html: string }> {
    const c = await this.prisma.raw.idCard.findUnique({ where: { verifyToken: token } });
    if (!c) {
      const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ID card verification</title><meta name="robots" content="noindex"></head><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;background:#eef1f5"><div style="background:#fff;border-radius:16px;padding:28px;max-width:360px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)"><div style="font-size:24px;font-weight:600">Card not found</div><p style="color:#5b6475">This QR code does not match any ID card.</p></div></body></html>';
      return { status: 404, html: body };
    }
    const [e, t, profile] = await Promise.all([
      this.prisma.raw.employee.findUnique({ where: { id: c.employeeId }, include: { designation: true, department: true } }),
      this.prisma.raw.tenant.findUnique({ where: { id: c.tenantId } }),
      this.companyProfile(c.tenantId),
    ]);
    const share = e ? await this.sharing(e.id, e) : { isPublic: false, phone: null, linkedin: null };
    const toUrl = async (fileId: string | null | undefined, px: number) => {
      if (!fileId) return null;
      try {
        return await toDataUrl((await this.storage.read(fileId, c.tenantId)).data, px);
      } catch {
        return null;
      }
    };
    // The photo sits in its round frame the way HR framed it on the ID card (zoom and position), so the face stays in view.
    const photo = await toUrl(e?.photoFileId, 600);
    let photoFrame: { left: number; top: number; width: number; height: number } | null = null;
    const size = await dataUrlSize(photo);
    if (size) {
      const used = c.templateId ? await this.prisma.raw.idCardTemplate.findUnique({ where: { id: c.templateId }, select: { front: true } }) : null;
      const el = ((used?.front ?? []) as unknown as IdCardElement[]).find((x) => x.type === 'PHOTO');
      const r = idCardPhotoPlacement(size, { w: 1, h: 1 }, el?.photo ?? DEFAULT_ID_CARD_PHOTO_FRAME);
      photoFrame = { left: r.x * 100, top: r.y * 100, width: r.w * 100, height: r.h * 100 };
    }
    const valid = ['READY', 'SENT_TO_PRINT', 'PRINTED', 'ISSUED'].includes(c.status) && e?.status !== 'EXITED';
    const label = valid ? 'Valid' : c.status === 'QUEUED' ? 'Not yet issued' : 'Revoked';
    await this.audit.recordRaw(c.tenantId, { action: 'idcard.verified_public', entity: 'IdCard', entityId: c.id, meta: { status: label } });
    // Contact details only for a valid card whose owner keeps their public card on.
    const showContacts = valid && share.isPublic;
    const html = renderScanPage({
      valid,
      statusLabel: label,
      company: { name: t?.name ?? '', legalName: t?.legalName ?? t?.name ?? '', address: [t?.address, t?.city].filter(Boolean).join(', ') || null, logo: await toUrl(t?.logoFileId, 400), officePhone: t?.phone ?? null },
      profile,
      employee: {
        name: e?.fullName ?? '—',
        designation: e?.designation?.name ?? null,
        department: e?.department?.name ?? null,
        empCode: e?.empCode ?? '',
        serial: c.serial,
        email: e?.officialEmail ?? '',
        phone: showContacts ? share.phone : null,
        linkedin: showContacts ? share.linkedin : null,
        photo,
        photoFrame,
      },
      showContacts,
      vcfUrl: showContacts ? `/api/v1/id-cards/verify/${token}/contact.vcf` : null,
    });
    return { status: 200, html };
  }

  /** The "Save Contact" file for a scanned ID card (valid cards whose owner keeps their public card on). */
  async verifyVcf(token: string): Promise<{ status: number; vcf?: string; filename?: string }> {
    const c = await this.prisma.raw.idCard.findUnique({ where: { verifyToken: token } });
    if (!c || !['READY', 'SENT_TO_PRINT', 'PRINTED', 'ISSUED'].includes(c.status)) return { status: 404 };
    const [e, t] = await Promise.all([
      this.prisma.raw.employee.findUnique({ where: { id: c.employeeId }, include: { designation: true } }),
      this.prisma.raw.tenant.findUnique({ where: { id: c.tenantId } }),
    ]);
    if (!e || e.status === 'EXITED') return { status: 404 };
    const share = await this.sharing(e.id, e);
    if (!share.isPublic) return { status: 404 };
    const profile = await this.companyProfile(c.tenantId);
    const vcf = buildVcf({ name: e.fullName, org: t?.name ?? '', title: e.designation?.name, email: e.officialEmail, phone: share.phone, url: profile.website || null, address: [t?.address, t?.city].filter(Boolean).join(', ') || null, linkedin: share.linkedin });
    return { status: 200, vcf, filename: `${e.empCode}.vcf` };
  }

  /** Scan helper for Time's ID compliance (authenticated). */
  async scan(token: string) {
    const c = await this.prisma.idCard.findFirst({ where: { verifyToken: token } });
    if (!c) throw notFound('ID card');
    return { employeeId: c.employeeId, status: c.status, generatedAt: dbDateKey(c.generatedAt) };
  }
}
