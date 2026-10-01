import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ChatCall, type ChatChannel, type ChatMember, type ChatMessage } from '@prisma/client';
import {
  CALLS_NEED_LIVEKIT,
  initialsOf,
  type CallJoin,
  type ChannelCreateInput,
  type ChatAttachment,
  type ChatBrowseRow,
  type ChatChannelRow,
  type ChatChannelsResponse,
  type ChatMemberRow,
  type ChatMessageRow,
  type ChatMessagesPage,
  type ChatPerson,
  type ChatSearchHit,
  type MessageSendInput,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { AuditService } from '../../../core/audit/audit.service';
import { getContext, requireContext, type RequestContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { SpineReader } from '../common/spine';
import { dayMonth, hhmm } from '../common/dates';
import { rtcProviderFromEnv, type RtcProvider } from './adapters/rtc';
import { callSummaryText, canEditMessage, canPostIn, channelLabel, dmKeyFor, normalizeBody, resolveMentions } from './chat.rules';

type UserBrief = { userId: string; name: string; initials: string; title: string | null; employeeId: string | null; active: boolean };
type ChannelWithMembers = ChatChannel & { members: ChatMember[] };

type ChannelCreateBody = ChannelCreateInput;

const AUDIENCE_LINKS = ['COMPANY_GENERAL', 'COMPANY_ANNOUNCEMENTS', 'DEPARTMENT', 'PROJECT'];

/**
 * Comms hub (spec §5): channels, DMs and group DMs, message persistence with a per-channel
 * sequence, unread counts, mentions, attachments, and calls (LiveKit when configured, else a
 * local preview). Realtime fan-out goes through the core RealtimeGateway rooms `ch:<channelId>`.
 */
@Injectable()
export class ChatService {
  private readonly log = new Logger('Chat');
  readonly rtc: RtcProvider = rtcProviderFromEnv();
  private readonly ensured = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly spine: SpineReader,
  ) {}

  // ── Helpers ─────────────────────────────────────────────────────────────

  private me(): { ctx: RequestContext; userId: string } {
    const ctx = requireContext();
    if (!ctx.userId) throw forbidden();
    return { ctx, userId: ctx.userId };
  }

  isPublisher(ctx: RequestContext): boolean {
    return hasPerm(ctx, 'notices.publish.global');
  }

  canCreate(ctx: RequestContext): boolean {
    return hasPerm(ctx, 'notices.publish.global') || hasPerm(ctx, 'notices.publish.team');
  }

  private canManage(ctx: RequestContext, m: ChatMember | null | undefined): boolean {
    return this.isPublisher(ctx) || m?.role === 'OWNER' || m?.role === 'ADMIN';
  }

  async userBriefs(userIds: (string | null | undefined)[]): Promise<Map<string, UserBrief>> {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, status: true, employee: { select: { id: true, fullName: true, status: true, designation: { select: { name: true } } } } },
    });
    return new Map(
      rows.map((u) => {
        const name = u.employee?.fullName ?? u.name;
        return [u.id, { userId: u.id, name, initials: initialsOf(name), title: u.employee?.designation?.name ?? null, employeeId: u.employee?.id ?? null, active: u.status !== 'DISABLED' && u.employee?.status !== 'EXITED' }];
      }),
    );
  }

  /** User ids with at least one connected socket in this tenant. */
  async onlineUserIds(): Promise<Set<string>> {
    const ctx = getContext();
    const server = this.realtime.server;
    if (!server || !ctx) return new Set();
    try {
      const sockets = await server.in(`t:${ctx.tenantId}`).fetchSockets();
      return new Set(sockets.map((s) => (s.data as any)?.user?.userId).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  /** Make every socket of these users join / leave a channel room. */
  private rooms(userIds: string[], channelId: string, join: boolean) {
    const server = this.realtime.server;
    if (!server || !userIds.length) return;
    const target = server.in(userIds.map((u) => `u:${u}`));
    if (join) target.socketsJoin(`ch:${channelId}`);
    else target.socketsLeave(`ch:${channelId}`);
  }

  private async member(channelId: string, userId: string) {
    return this.prisma.chatMember.findFirst({ where: { channelId, userId }, include: { channel: true } });
  }

  async assertMember(channelId: string): Promise<ChatMember & { channel: ChatChannel }> {
    const { userId } = this.me();
    const m = await this.member(channelId, userId);
    if (!m) throw forbidden('You are not a member of this channel');
    return m;
  }

  // ── Company channels + audience membership sync ───────────────────────

  /** #general and #announcements exist in every tenant (created lazily for new tenants). */
  async ensureCompanyChannels(tenantId: string): Promise<void> {
    if (this.ensured.has(tenantId)) return;
    const defs = [
      { name: 'general', linkedType: 'COMPANY_GENERAL', topic: 'Company-wide conversation', postingPolicy: 'ALL_MEMBERS' as const, sortOrder: 1 },
      { name: 'announcements', linkedType: 'COMPANY_ANNOUNCEMENTS', topic: 'Official announcements from HR and leadership', postingPolicy: 'ADMINS_ONLY' as const, sortOrder: 4 },
    ];
    for (const d of defs) {
      const exists = await this.prisma.chatChannel.findFirst({ where: { linkedType: d.linkedType } });
      if (!exists) {
        await this.prisma.chatChannel
          .create({ data: { kind: 'PUBLIC', name: d.name, topic: d.topic, linkedType: d.linkedType, postingPolicy: d.postingPolicy, sortOrder: d.sortOrder } })
          .catch(() => undefined);
      }
    }
    this.ensured.add(tenantId);
  }

  /**
   * Adds the user to the audience-linked channels they belong to (company, their department,
   * their projects) and removes AUDIENCE-managed memberships that no longer match.
   */
  async syncFor(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId }, select: { id: true, status: true, employee: { select: { id: true, departmentId: true, status: true } } } });
    if (!user) return;
    const active = user.status !== 'DISABLED' && user.employee?.status !== 'EXITED';
    const emp = user.employee;
    const projectIds = emp ? await this.spine.projectIdsOf(emp.id) : [];
    const channels = await this.prisma.chatChannel.findMany({ where: { linkedType: { in: AUDIENCE_LINKS }, archivedAt: null } });
    if (!channels.length) return;
    const mine = await this.prisma.chatMember.findMany({ where: { userId, channelId: { in: channels.map((c) => c.id) } } });
    const byChannel = new Map(mine.map((m) => [m.channelId, m]));
    const add: string[] = [];
    const remove: string[] = [];
    for (const c of channels) {
      const should =
        active &&
        (c.linkedType === 'COMPANY_GENERAL' || c.linkedType === 'COMPANY_ANNOUNCEMENTS' || (c.linkedType === 'DEPARTMENT' && !!emp?.departmentId && c.linkedId === emp.departmentId) || (c.linkedType === 'PROJECT' && !!c.linkedId && projectIds.includes(c.linkedId)));
      const m = byChannel.get(c.id);
      if (should && !m) add.push(c.id);
      if (!should && m?.managedBy === 'AUDIENCE') remove.push(c.id);
    }
    if (add.length) {
      await this.prisma.chatMember.createMany({ data: add.map((channelId) => ({ channelId, userId, managedBy: 'AUDIENCE' })), skipDuplicates: true });
      for (const id of add) this.rooms([userId], id, true);
    }
    if (remove.length) {
      await this.prisma.chatMember.deleteMany({ where: { userId, channelId: { in: remove }, managedBy: 'AUDIENCE' } });
      for (const id of remove) this.rooms([userId], id, false);
    }
  }

  /** Every member of an audience-linked channel (used when the channel is created / linked). */
  private async audienceUserIds(linkedType: string, linkedId: string | null): Promise<string[]> {
    if (linkedType === 'COMPANY_GENERAL' || linkedType === 'COMPANY_ANNOUNCEMENTS') {
      const users = await this.prisma.user.findMany({ where: { status: { not: 'DISABLED' } }, select: { id: true } });
      return users.map((u) => u.id);
    }
    let employeeIds: string[] = [];
    if (linkedType === 'DEPARTMENT' && linkedId) {
      employeeIds = (await this.prisma.employee.findMany({ where: { departmentId: linkedId, status: { in: ['ACTIVE', 'NOTICE_PERIOD', 'ONBOARDING'] } }, select: { id: true } })).map((e) => e.id);
    } else if (linkedType === 'PROJECT' && linkedId) {
      employeeIds = await this.spine.projectEmployeeIds(linkedId);
    }
    if (!employeeIds.length) return [];
    const rows = await this.prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { userId: true } });
    return rows.map((r) => r.userId).filter((x): x is string => !!x);
  }

  // ── Channels ────────────────────────────────────────────────────────────

  async listChannels(): Promise<ChatChannelsResponse> {
    const { ctx, userId } = this.me();
    await this.ensureCompanyChannels(ctx.tenantId);
    await this.syncFor(userId).catch((e) => this.log.warn(`sync ${userId}: ${(e as Error).message}`));
    const memberships = await this.prisma.chatMember.findMany({ where: { userId, channel: { archivedAt: null } }, include: { channel: { include: { members: true } } } });
    const rows = await this.rowsFor(memberships.map((m) => ({ ...m.channel, me: m })), ctx, userId);
    const channels = rows.filter((r) => r.kind === 'PUBLIC' || r.kind === 'PRIVATE');
    const dms = rows.filter((r) => r.kind === 'DM' || r.kind === 'GROUP_DM');
    const order = new Map(memberships.map((m) => [m.channelId, m.channel.sortOrder]));
    channels.sort((a, b) => (order.get(a.id) ?? 100) - (order.get(b.id) ?? 100) || a.name.localeCompare(b.name));
    dms.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || a.label.localeCompare(b.label));
    return { channels, dms, canCreate: this.canCreate(ctx), userId };
  }

  private async rowsFor(list: (ChannelWithMembers & { me: ChatMember })[], ctx: RequestContext, userId: string): Promise<ChatChannelRow[]> {
    const dmUserIds = list.filter((c) => c.kind === 'DM' || c.kind === 'GROUP_DM').flatMap((c) => c.members.map((m) => m.userId));
    const [briefs, online, calls] = await Promise.all([
      this.userBriefs(dmUserIds),
      this.onlineUserIds(),
      this.prisma.chatCall.findMany({ where: { channelId: { in: list.map((c) => c.id) }, endedAt: null } }),
    ]);
    const liveBy = new Map(calls.map((c) => [c.channelId, c]));
    const unread = await Promise.all(
      list.map((c) => this.prisma.chatMessage.count({ where: { channelId: c.id, seq: { gt: c.me.lastReadSeq }, senderUserId: { not: userId }, deletedAt: null } })),
    );
    return list.map((c, i) => {
      const dm = c.kind === 'DM' || c.kind === 'GROUP_DM';
      const others = dm ? c.members.filter((m) => m.userId !== userId).map((m) => briefs.get(m.userId)).filter((b): b is UserBrief => !!b) : [];
      const deactivated = dm && c.kind === 'DM' && others.length === 1 && !others[0]!.active;
      const canPost = !deactivated && canPostIn(c.postingPolicy, this.isPublisher(ctx), !!c.archivedAt);
      const call = liveBy.get(c.id);
      return {
        id: c.id,
        kind: c.kind,
        name: c.name ?? '',
        label: channelLabel(c.kind, c.name, others.map((o) => o.name)),
        topic: dm ? (others.length === 1 ? others[0]!.title : `${others.length + 1} people`) : c.topic,
        unread: unread[i]!,
        muted: c.me.muted,
        canPost,
        postingNote: deactivated ? 'User deactivated' : canPost ? null : c.postingPolicy === 'ADMINS_ONLY' ? 'Only HR/Admin can post here' : 'This channel is read-only',
        memberCount: c.members.length,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        dmUserId: c.kind === 'DM' ? (others[0]?.userId ?? userId) : null,
        managed: !!c.linkedType && AUDIENCE_LINKS.includes(c.linkedType) && c.me.managedBy === 'AUDIENCE',
        canManage: !dm && this.canManage(ctx, c.me),
        online: dm && others.length === 1 ? online.has(others[0]!.userId) : dm && !others.length ? true : null,
        lastSeq: c.lastMessageSeq,
        lastReadSeq: c.me.lastReadSeq,
        liveCall: call ? { callId: call.id, kind: call.kind } : null,
      };
    });
  }

  async channelRow(channelId: string): Promise<ChatChannelRow> {
    const { ctx, userId } = this.me();
    const m = await this.prisma.chatMember.findFirst({ where: { channelId, userId }, include: { channel: { include: { members: true } } } });
    if (!m) throw forbidden('You are not a member of this channel');
    const [row] = await this.rowsFor([{ ...m.channel, me: m }], ctx, userId);
    return row!;
  }

  async browse(): Promise<ChatBrowseRow[]> {
    const { userId } = this.me();
    const rows = await this.prisma.chatChannel.findMany({ where: { kind: 'PUBLIC', archivedAt: null }, include: { members: { select: { userId: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return rows.map((c) => ({ id: c.id, name: c.name ?? '', label: `# ${c.name}`, topic: c.topic, memberCount: c.members.length, joined: c.members.some((m) => m.userId === userId), kind: c.kind }));
  }

  async createChannel(dto: ChannelCreateBody): Promise<ChatChannelRow> {
    const { ctx, userId } = this.me();
    if (!this.canCreate(ctx)) throw forbidden('Only leads, managers, HR and Admin can create channels');
    const taken = await this.prisma.chatChannel.findFirst({ where: { name: dto.name } });
    if (taken) throw conflict(`#${dto.name} already exists`, 'CHANNEL_EXISTS');
    if (dto.linkedType && !dto.linkedId) throw badRequest('Pick the department or project to link');
    const ch = await this.prisma.chatChannel.create({
      data: { kind: dto.kind, name: dto.name, topic: dto.topic ?? null, createdByUserId: userId, linkedType: dto.linkedType ?? null, linkedId: dto.linkedType ? dto.linkedId : null },
    });
    const audience = dto.linkedType ? await this.audienceUserIds(dto.linkedType, dto.linkedId ?? null) : [];
    const manual = [...new Set(dto.memberUserIds.filter((u) => u !== userId && !audience.includes(u)))];
    await this.prisma.chatMember.createMany({
      data: [
        { channelId: ch.id, userId, role: 'OWNER', managedBy: 'MANUAL', lastReadSeq: 0 },
        ...audience.filter((u) => u !== userId).map((u) => ({ channelId: ch.id, userId: u, managedBy: 'AUDIENCE' })),
        ...manual.map((u) => ({ channelId: ch.id, userId: u, managedBy: 'MANUAL' })),
      ],
      skipDuplicates: true,
    });
    const all = [userId, ...audience, ...manual];
    this.rooms(all, ch.id, true);
    await this.systemMessage(ch.id, `${ctx.userName ?? 'Someone'} created #${dto.name}`);
    await this.audit.record({ action: 'chat.channel.create', entity: 'ChatChannel', entityId: ch.id, meta: { name: dto.name, kind: dto.kind, linkedType: dto.linkedType ?? null } });
    this.realtime.toUsers(all.filter((u) => u !== userId), 'chat:channels', { reason: 'created', channelId: ch.id });
    return this.channelRow(ch.id);
  }

  async join(channelId: string): Promise<ChatChannelRow> {
    const { userId } = this.me();
    const ch = await this.prisma.chatChannel.findFirst({ where: { id: channelId, archivedAt: null } });
    if (!ch) throw notFound('Channel');
    if (ch.kind !== 'PUBLIC') throw forbidden('This channel is private');
    await this.prisma.chatMember.createMany({ data: [{ channelId, userId, managedBy: 'MANUAL', lastReadSeq: Math.max(0, ch.lastMessageSeq - 20) }], skipDuplicates: true });
    this.rooms([userId], channelId, true);
    return this.channelRow(channelId);
  }

  async leave(channelId: string): Promise<{ ok: true }> {
    const { userId } = this.me();
    const m = await this.assertMember(channelId);
    if (m.channel.kind === 'DM' || m.channel.kind === 'GROUP_DM') throw badRequest('Direct messages cannot be left — mute them instead', 'CHAT_DM_LEAVE');
    if (m.managedBy === 'AUDIENCE') throw conflict('Team channels follow your department and projects — you can mute this channel instead', 'CHAT_MANAGED');
    await this.prisma.chatMember.delete({ where: { id: m.id } });
    this.rooms([userId], channelId, false);
    return { ok: true };
  }

  async setMuted(channelId: string, muted: boolean): Promise<ChatChannelRow> {
    const m = await this.assertMember(channelId);
    await this.prisma.chatMember.update({ where: { id: m.id }, data: { muted } });
    return this.channelRow(channelId);
  }

  async members(channelId: string): Promise<ChatMemberRow[]> {
    await this.assertMember(channelId);
    const rows = await this.prisma.chatMember.findMany({ where: { channelId }, orderBy: { joinedAt: 'asc' } });
    const [briefs, online] = await Promise.all([this.userBriefs(rows.map((r) => r.userId)), this.onlineUserIds()]);
    return rows
      .map((r) => {
        const b = briefs.get(r.userId);
        return { userId: r.userId, name: b?.name ?? 'Former user', initials: b?.initials ?? '?', title: b?.title ?? null, role: r.role, managed: r.managedBy === 'AUDIENCE', online: online.has(r.userId) };
      })
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  async addMembers(channelId: string, userIds: string[]): Promise<ChatMemberRow[]> {
    const { ctx } = this.me();
    const m = await this.assertMember(channelId);
    if (m.channel.kind === 'DM' || m.channel.kind === 'GROUP_DM') throw badRequest('Start a new group message to add people');
    if (!this.canManage(ctx, m)) throw forbidden('Only channel owners and HR/Admin can add members');
    const valid = await this.prisma.user.findMany({ where: { id: { in: userIds }, status: { not: 'DISABLED' } }, select: { id: true } });
    await this.prisma.chatMember.createMany({ data: valid.map((u) => ({ channelId, userId: u.id, managedBy: 'MANUAL' })), skipDuplicates: true });
    this.rooms(valid.map((u) => u.id), channelId, true);
    this.realtime.toUsers(valid.map((u) => u.id), 'chat:channels', { reason: 'added', channelId });
    await this.audit.record({ action: 'chat.channel.member.add', entity: 'ChatChannel', entityId: channelId, meta: { userIds: valid.map((u) => u.id) } });
    return this.members(channelId);
  }

  async removeMember(channelId: string, targetUserId: string): Promise<ChatMemberRow[]> {
    const { ctx } = this.me();
    const m = await this.assertMember(channelId);
    if (!this.canManage(ctx, m)) throw forbidden('Only channel owners and HR/Admin can remove members');
    const target = await this.prisma.chatMember.findFirst({ where: { channelId, userId: targetUserId } });
    if (!target) throw notFound('Member');
    if (target.managedBy === 'AUDIENCE') throw conflict('This person is a member through their department or project', 'CHAT_MANAGED');
    await this.prisma.chatMember.delete({ where: { id: target.id } });
    this.rooms([targetUserId], channelId, false);
    this.realtime.toUser(targetUserId, 'chat:channels', { reason: 'removed', channelId });
    await this.audit.record({ action: 'chat.channel.member.remove', entity: 'ChatChannel', entityId: channelId, meta: { userId: targetUserId } });
    return this.members(channelId);
  }

  async archive(channelId: string, archived: boolean): Promise<{ ok: true }> {
    const { ctx } = this.me();
    const m = await this.assertMember(channelId);
    if (!this.canManage(ctx, m)) throw forbidden('Only channel owners and HR/Admin can archive channels');
    if (m.channel.linkedType === 'COMPANY_GENERAL' || m.channel.linkedType === 'COMPANY_ANNOUNCEMENTS') throw badRequest('Company channels cannot be archived');
    await this.prisma.chatChannel.update({ where: { id: channelId }, data: { archivedAt: archived ? new Date() : null } });
    await this.audit.record({ action: archived ? 'chat.channel.archive' : 'chat.channel.unarchive', entity: 'ChatChannel', entityId: channelId });
    this.realtime.toRoom(`ch:${channelId}`, 'chat:channels', { reason: 'archived', channelId });
    return { ok: true };
  }

  /** Existing or new DM (2 people), group DM (3-9) or "notes to self" (just me). */
  async openDm(userIds: string[]): Promise<ChatChannelRow> {
    const { userId } = this.me();
    const people = [...new Set([userId, ...userIds])];
    if (people.length > 9) throw badRequest('Group messages can include up to 8 people');
    const found = await this.prisma.user.findMany({ where: { id: { in: people } }, select: { id: true } });
    if (found.length !== people.length) throw badRequest('Pick people from your organisation');
    const key = dmKeyFor(people);
    let ch = await this.prisma.chatChannel.findFirst({ where: { dmKey: key } });
    if (!ch) {
      try {
        ch = await this.prisma.chatChannel.create({ data: { kind: people.length > 2 ? 'GROUP_DM' : 'DM', dmKey: key, createdByUserId: userId } });
        await this.prisma.chatMember.createMany({ data: people.map((u) => ({ channelId: ch!.id, userId: u, role: u === userId ? 'OWNER' : 'MEMBER' })), skipDuplicates: true });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        ch = await this.prisma.chatChannel.findFirst({ where: { dmKey: key } });
      }
    }
    if (!ch) throw notFound('Conversation');
    this.rooms(people, ch.id, true);
    return this.channelRow(ch.id);
  }

  async people(): Promise<ChatPerson[]> {
    const users = await this.prisma.user.findMany({
      where: { status: { not: 'DISABLED' } },
      select: { id: true, name: true, employee: { select: { id: true, fullName: true, status: true, designation: { select: { name: true } } } } },
    });
    const online = await this.onlineUserIds();
    return users
      .filter((u) => u.employee?.status !== 'EXITED')
      .map((u) => {
        const name = u.employee?.fullName ?? u.name;
        return { userId: u.id, employeeId: u.employee?.id ?? null, name, initials: initialsOf(name), title: u.employee?.designation?.name ?? null, online: online.has(u.id) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Messages ────────────────────────────────────────────────────────────

  private async toRows(msgs: ChatMessage[], viewer: { userId: string; ctx: RequestContext; member?: ChatMember | null }): Promise<ChatMessageRow[]> {
    const replyIds = [...new Set(msgs.map((m) => m.replyToId).filter((x): x is string => !!x))];
    const replies = replyIds.length ? await this.prisma.chatMessage.findMany({ where: { id: { in: replyIds } } }) : [];
    const briefs = await this.userBriefs([...msgs.map((m) => m.senderUserId), ...replies.map((r) => r.senderUserId)]);
    const replyBy = new Map(replies.map((r) => [r.id, r]));
    const now = new Date();
    const moderator = this.canManage(viewer.ctx, viewer.member);
    return msgs.map((m) => {
      const b = m.senderUserId ? briefs.get(m.senderUserId) : null;
      const mine = !!m.senderUserId && m.senderUserId === viewer.userId;
      const deleted = !!m.deletedAt;
      const r = m.replyToId ? replyBy.get(m.replyToId) : null;
      return {
        id: m.id,
        channelId: m.channelId,
        seq: m.seq,
        kind: m.kind,
        senderUserId: m.senderUserId,
        who: m.kind === 'USER' ? (b?.name ?? 'Former user') : 'Lexisora',
        init: m.kind === 'USER' ? (b?.initials ?? '?') : 'LX',
        t: hhmm(m.createdAt),
        body: deleted ? null : m.body,
        attachments: deleted ? [] : ((m.attachments as ChatAttachment[]) ?? []),
        mentions: m.mentions,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
        deleted,
        mine,
        canEdit: mine && !deleted && m.kind === 'USER' && canEditMessage(m.createdAt, now),
        canDelete: !deleted && m.kind === 'USER' && (mine || moderator),
        replyTo: r ? { id: r.id, who: (r.senderUserId && briefs.get(r.senderUserId)?.name) || 'Lexisora', body: r.deletedAt ? null : (r.body ?? '').slice(0, 140) } : null,
      };
    });
  }

  /** Viewer-neutral row for broadcasts (each client derives `mine`/`canEdit` itself). */
  private async broadcastRow(m: ChatMessage): Promise<ChatMessageRow> {
    const ctx = requireContext();
    const [row] = await this.toRows([m], { userId: '', ctx: { ...ctx, permissions: new Set() } });
    return { ...row!, mine: false, canEdit: false, canDelete: false };
  }

  async messages(channelId: string, q: { beforeSeq?: number; afterSeq?: number; limit: number }): Promise<ChatMessagesPage> {
    const { ctx, userId } = this.me();
    const m = await this.assertMember(channelId);
    let rows: ChatMessage[];
    let hasMore = false;
    if (q.afterSeq !== undefined) {
      rows = await this.prisma.chatMessage.findMany({ where: { channelId, seq: { gt: q.afterSeq } }, orderBy: { seq: 'asc' }, take: q.limit });
    } else {
      const page = await this.prisma.chatMessage.findMany({
        where: { channelId, ...(q.beforeSeq !== undefined ? { seq: { lt: q.beforeSeq } } : {}) },
        orderBy: { seq: 'desc' },
        take: q.limit + 1,
      });
      hasMore = page.length > q.limit;
      rows = page.slice(0, q.limit).reverse();
    }
    return { items: await this.toRows(rows, { userId, ctx, member: m }), hasMore, lastReadSeq: m.lastReadSeq, lastSeq: m.channel.lastMessageSeq };
  }

  async send(dto: MessageSendInput): Promise<ChatMessageRow> {
    const { ctx, userId } = this.me();
    const m = await this.assertMember(dto.channelId);
    const ch = m.channel;
    const existing = await this.prisma.chatMessage.findFirst({ where: { channelId: ch.id, senderUserId: userId, clientMsgId: dto.clientMsgId } });
    if (existing) return (await this.toRows([existing], { userId, ctx, member: m }))[0]!;

    const memberRows = await this.prisma.chatMember.findMany({ where: { channelId: ch.id }, select: { userId: true, muted: true } });
    const briefs = await this.userBriefs(memberRows.map((r) => r.userId));
    if (ch.kind === 'DM' && memberRows.some((r) => r.userId !== userId && briefs.get(r.userId)?.active === false)) throw forbidden('User deactivated');
    if (!canPostIn(ch.postingPolicy, this.isPublisher(ctx), !!ch.archivedAt)) throw forbidden(ch.archivedAt ? 'This channel is archived' : 'Only HR/Admin can post here');
    const label = channelLabel(ch.kind, ch.name, [...briefs.values()].filter((b) => b.userId !== userId).map((b) => b.name));

    const body = normalizeBody(dto.body ?? '');
    if (!body && !dto.attachments.length) throw badRequest('Type a message');
    if (dto.attachments.length) {
      const files = await this.prisma.fileObject.findMany({ where: { id: { in: dto.attachments.map((a) => a.fileId) } }, select: { id: true, ownerUserId: true } });
      if (files.length !== dto.attachments.length || files.some((f) => f.ownerUserId && f.ownerUserId !== userId)) throw badRequest('Attach files you uploaded');
    }
    if (dto.replyToId) {
      const parent = await this.prisma.chatMessage.findFirst({ where: { id: dto.replyToId, channelId: ch.id } });
      if (!parent) throw badRequest('The message you replied to is not in this channel');
    }
    const mentions = resolveMentions(body, [...briefs.values()].map((b) => ({ userId: b.userId, name: b.name }))).filter((u) => u !== userId);

    let msg: ChatMessage;
    try {
      msg = await this.prisma.$transaction(async (tx) => {
        const c = await tx.chatChannel.update({ where: { id: ch.id }, data: { lastMessageSeq: { increment: 1 }, lastMessageAt: new Date() } });
        const created = await tx.chatMessage.create({
          data: { tenantId: ctx.tenantId, channelId: ch.id, seq: c.lastMessageSeq, senderUserId: userId, kind: 'USER', body: body || null, replyToId: dto.replyToId ?? null, mentions, attachments: dto.attachments as unknown as Prisma.InputJsonValue, clientMsgId: dto.clientMsgId },
        });
        await tx.chatMember.update({ where: { id: m.id }, data: { lastReadSeq: c.lastMessageSeq } });
        return created;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.chatMessage.findFirst({ where: { channelId: ch.id, senderUserId: userId, clientMsgId: dto.clientMsgId } });
        if (again) return (await this.toRows([again], { userId, ctx, member: m }))[0]!;
      }
      throw e;
    }
    this.realtime.toRoom(`ch:${ch.id}`, 'chat:message', await this.broadcastRow(msg));
    void this.notifyAfterSend(ch, label, msg, mentions, memberRows, ctx).catch((e) => this.log.warn(`notify: ${(e as Error).message}`));
    return (await this.toRows([msg], { userId, ctx, member: m }))[0]!;
  }

  private async notifyAfterSend(ch: ChatChannel, label: string, msg: ChatMessage, mentions: string[], members: { userId: string; muted: boolean }[], ctx: RequestContext) {
    const from = ctx.userName ?? 'Someone';
    const snippet = (msg.body ?? (msg.attachments as ChatAttachment[]).map((a) => a.name).join(', ')).slice(0, 140);
    const link = `/chat?c=${ch.id}`;
    if (mentions.length) {
      await this.notifications.notify({ userIds: mentions, type: 'chat.mention', title: `${from} mentioned you in ${ch.kind === 'DM' || ch.kind === 'GROUP_DM' ? 'a message' : label}`, body: snippet, link, from });
    }
    if (ch.kind === 'DM' || ch.kind === 'GROUP_DM') {
      const online = await this.onlineUserIds();
      const offline = members.filter((x) => x.userId !== msg.senderUserId && !x.muted && !online.has(x.userId) && !mentions.includes(x.userId)).map((x) => x.userId);
      if (offline.length) await this.notifications.notify({ userIds: offline, type: 'chat.dm', title: `New message from ${from}`, body: snippet, link, from });
    }
  }

  /** A SYSTEM / CALL_SUMMARY line in a channel (no sender). */
  async systemMessage(channelId: string, body: string, kind: 'SYSTEM' | 'CALL_SUMMARY' = 'SYSTEM', attachments: ChatAttachment[] = []): Promise<ChatMessage> {
    const tenantId = requireContext().tenantId;
    const msg = await this.prisma.$transaction(async (tx) => {
      const c = await tx.chatChannel.update({ where: { id: channelId }, data: { lastMessageSeq: { increment: 1 }, lastMessageAt: new Date() } });
      return tx.chatMessage.create({ data: { tenantId, channelId, seq: c.lastMessageSeq, senderUserId: null, kind, body, mentions: [], attachments: attachments as unknown as Prisma.InputJsonValue } });
    });
    this.realtime.toRoom(`ch:${channelId}`, 'chat:message', await this.broadcastRow(msg));
    return msg;
  }

  async edit(id: string, body: string): Promise<ChatMessageRow> {
    const { ctx, userId } = this.me();
    const msg = await this.prisma.chatMessage.findFirst({ where: { id } });
    if (!msg || msg.deletedAt) throw notFound('Message');
    const m = await this.assertMember(msg.channelId);
    if (msg.senderUserId !== userId) throw forbidden('You can only edit your own messages');
    if (!canEditMessage(msg.createdAt)) throw new AppError(409, 'CHAT_EDIT_WINDOW', 'Messages can be edited for 15 minutes after sending');
    const memberRows = await this.prisma.chatMember.findMany({ where: { channelId: msg.channelId }, select: { userId: true } });
    const briefs = await this.userBriefs(memberRows.map((r) => r.userId));
    const text = normalizeBody(body);
    const updated = await this.prisma.chatMessage.update({
      where: { id },
      data: { body: text, editedAt: new Date(), mentions: resolveMentions(text, [...briefs.values()].map((b) => ({ userId: b.userId, name: b.name }))).filter((u) => u !== userId) },
    });
    this.realtime.toRoom(`ch:${msg.channelId}`, 'chat:message:updated', await this.broadcastRow(updated));
    return (await this.toRows([updated], { userId, ctx, member: m }))[0]!;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const { ctx, userId } = this.me();
    const msg = await this.prisma.chatMessage.findFirst({ where: { id } });
    if (!msg || msg.deletedAt) throw notFound('Message');
    const m = await this.assertMember(msg.channelId);
    const mine = msg.senderUserId === userId;
    if (!mine && !this.canManage(ctx, m)) throw forbidden('You can only delete your own messages');
    await this.prisma.chatMessage.update({ where: { id }, data: { deletedAt: new Date(), body: null, attachments: [] as unknown as Prisma.InputJsonValue } });
    if (!mine) await this.audit.record({ action: 'chat.message.delete', entity: 'ChatMessage', entityId: id, meta: { channelId: msg.channelId } });
    this.realtime.toRoom(`ch:${msg.channelId}`, 'chat:message:deleted', { id, channelId: msg.channelId });
    return { ok: true };
  }

  async markRead(channelId: string, seq: number): Promise<{ ok: true; lastReadSeq: number }> {
    const { userId } = this.me();
    const m = await this.assertMember(channelId);
    const target = Math.min(Math.max(seq, 0), m.channel.lastMessageSeq);
    if (target > m.lastReadSeq) {
      await this.prisma.chatMember.updateMany({ where: { id: m.id, lastReadSeq: { lt: target } }, data: { lastReadSeq: target } });
      this.realtime.toUser(userId, 'chat:read', { channelId, seq: target });
    }
    return { ok: true, lastReadSeq: Math.max(target, m.lastReadSeq) };
  }

  async search(q: string, channelId?: string): Promise<ChatSearchHit[]> {
    const { userId } = this.me();
    const memberships = await this.prisma.chatMember.findMany({ where: { userId }, include: { channel: { include: { members: true } } } });
    const allowed = new Map(memberships.map((m) => [m.channelId, m.channel]));
    if (channelId && !allowed.has(channelId)) throw forbidden('You are not a member of this channel');
    const ids = channelId ? [channelId] : [...allowed.keys()];
    const rows = await this.prisma.chatMessage.findMany({ where: { channelId: { in: ids }, deletedAt: null, body: { contains: q, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: 30 });
    const dmUsers = memberships.flatMap((m) => (m.channel.kind === 'DM' || m.channel.kind === 'GROUP_DM' ? m.channel.members.map((x) => x.userId) : []));
    const briefs = await this.userBriefs([...rows.map((r) => r.senderUserId), ...dmUsers]);
    return rows.map((r) => {
      const ch = allowed.get(r.channelId)!;
      const others = ch.members.filter((x) => x.userId !== userId).map((x) => briefs.get(x.userId)?.name ?? '').filter(Boolean);
      return {
        messageId: r.id,
        channelId: r.channelId,
        channelLabel: channelLabel(ch.kind, ch.name, others),
        seq: r.seq,
        who: r.senderUserId ? (briefs.get(r.senderUserId)?.name ?? 'Former user') : 'Lexisora',
        t: hhmm(r.createdAt),
        date: dayMonth(r.createdAt),
        body: (r.body ?? '').slice(0, 240),
      };
    });
  }

  /** File access hook: chat attachments are visible to members of the channel. */
  async canOpenFile(fileId: string): Promise<boolean> {
    const ctx = getContext();
    if (!ctx?.userId) return false;
    const msgs = await this.prisma.chatMessage.findMany({ where: { deletedAt: null, attachments: { array_contains: [{ fileId }] } }, select: { channelId: true }, take: 5 });
    if (!msgs.length) return false;
    const n = await this.prisma.chatMember.count({ where: { userId: ctx.userId, channelId: { in: msgs.map((x) => x.channelId) } } });
    return n > 0;
  }

  // ── Calls ───────────────────────────────────────────────────────────────

  private canRecord(ctx: RequestContext, call: ChatCall, userId: string): boolean {
    return call.startedByUserId === userId || hasPerm(ctx, 'notices.publish.global') || hasPerm(ctx, 'notices.publish.team');
  }

  private async callJoin(call: ChatCall, label?: string): Promise<CallJoin> {
    const { ctx, userId } = this.me();
    const name = ctx.userName ?? 'Participant';
    const token = await this.rtc.issueToken({ room: call.roomName, identity: userId, name });
    const briefs = await this.userBriefs(call.participantIds);
    return {
      callId: call.id,
      roomName: call.roomName,
      kind: call.kind,
      provider: this.rtc.name,
      url: this.rtc.url,
      token,
      recording: call.recording,
      notice: this.rtc.name === 'local' ? CALLS_NEED_LIVEKIT : null,
      channelId: call.channelId,
      channelLabel: label ?? (await this.channelRow(call.channelId)).label,
      startedAt: call.startedAt.toISOString(),
      participants: call.participantIds.map((u) => ({ userId: u, name: briefs.get(u)?.name ?? 'Participant', initials: briefs.get(u)?.initials ?? '?' })),
      canRecord: this.canRecord(ctx, call, userId),
    };
  }

  async activeCall(channelId: string): Promise<CallJoin | null> {
    await this.assertMember(channelId);
    const call = await this.prisma.chatCall.findFirst({ where: { channelId, endedAt: null }, orderBy: { startedAt: 'desc' } });
    return call ? this.callJoin(call) : null;
  }

  /** One live call per channel: starting while one is live joins it instead. */
  async startCall(channelId: string, kind: 'AUDIO' | 'VIDEO' | 'SCREEN'): Promise<CallJoin> {
    const { ctx, userId } = this.me();
    await this.assertMember(channelId);
    const row = await this.channelRow(channelId);
    if (!row.canPost) throw forbidden(row.postingNote ?? 'You cannot start a call here');
    const live = await this.prisma.chatCall.findFirst({ where: { channelId, endedAt: null } });
    if (live) return this.joinCall(live.id);
    const call = await this.prisma.chatCall.create({
      data: { channelId, kind, roomName: `lx-${ctx.tenantId.slice(-6)}-${channelId.slice(-8)}-${Date.now().toString(36)}`, startedByUserId: userId, participantIds: [userId], maxParticipants: 1 },
    });
    this.realtime.toRoom(`ch:${channelId}`, 'call:ring', { callId: call.id, channelId, channelLabel: row.label, kind, from: ctx.userName ?? 'Someone', fromUserId: userId });
    await this.audit.record({ action: 'chat.call.start', entity: 'ChatCall', entityId: call.id, meta: { channelId, kind, provider: this.rtc.name } });
    return this.callJoin(call, row.label);
  }

  async joinCall(callId: string): Promise<CallJoin> {
    const { userId } = this.me();
    const call = await this.prisma.chatCall.findFirst({ where: { id: callId } });
    if (!call) throw notFound('Call');
    await this.assertMember(call.channelId);
    if (call.endedAt) throw new AppError(409, 'CALL_ENDED', 'This call has ended');
    const participants = [...new Set([...call.participantIds, userId])];
    const updated = await this.prisma.chatCall.update({ where: { id: callId }, data: { participantIds: participants, maxParticipants: Math.max(call.maxParticipants, participants.length) } });
    this.realtime.toRoom(`ch:${call.channelId}`, 'call:participants', { callId, channelId: call.channelId, count: participants.length });
    return this.callJoin(updated);
  }

  async leaveCall(callId: string, userIdOverride?: string): Promise<{ ok: true; ended: boolean }> {
    const userId = userIdOverride ?? this.me().userId;
    const call = await this.prisma.chatCall.findFirst({ where: { id: callId } });
    if (!call || call.endedAt) return { ok: true, ended: true };
    const participants = call.participantIds.filter((u) => u !== userId);
    if (participants.length) {
      await this.prisma.chatCall.update({ where: { id: callId }, data: { participantIds: participants, ...(call.recordingByUserId === userId ? { recording: false, recordingByUserId: null } : {}) } });
      this.realtime.toRoom(`ch:${call.channelId}`, 'call:participants', { callId, channelId: call.channelId, count: participants.length });
      if (call.recordingByUserId === userId) this.realtime.toRoom(`ch:${call.channelId}`, 'call:recording', { callId, channelId: call.channelId, on: false });
      return { ok: true, ended: false };
    }
    await this.endCall(call);
    return { ok: true, ended: true };
  }

  async endCall(call: ChatCall): Promise<void> {
    const endedAt = new Date();
    const n = await this.prisma.chatCall.updateMany({ where: { id: call.id, endedAt: null }, data: { endedAt, participantIds: [], recording: false } });
    if (!n.count) return;
    await this.rtc.endRoom(call.roomName);
    await this.systemMessage(call.channelId, callSummaryText(call.kind, call.startedAt, endedAt, call.maxParticipants), 'CALL_SUMMARY');
    this.realtime.toRoom(`ch:${call.channelId}`, 'call:ended', { callId: call.id, channelId: call.channelId });
  }

  async setRecording(callId: string, on: boolean): Promise<CallJoin> {
    const { ctx, userId } = this.me();
    const call = await this.prisma.chatCall.findFirst({ where: { id: callId } });
    if (!call || call.endedAt) throw notFound('Call');
    await this.assertMember(call.channelId);
    if (!this.canRecord(ctx, call, userId)) throw forbidden('Only the host, leads, managers, HR and Admin can record calls');
    const updated = await this.prisma.chatCall.update({ where: { id: callId }, data: { recording: on, recordingByUserId: on ? userId : null } });
    this.realtime.toRoom(`ch:${call.channelId}`, 'call:recording', { callId, channelId: call.channelId, on, by: ctx.userName ?? null });
    await this.audit.record({ action: on ? 'chat.recording.start' : 'chat.recording.stop', entity: 'ChatCall', entityId: callId });
    return this.callJoin(updated);
  }

  /** Called by the socket layer when a user's last socket disconnects. */
  async dropFromCalls(userId: string): Promise<void> {
    const calls = await this.prisma.chatCall.findMany({ where: { endedAt: null, participantIds: { has: userId } } });
    for (const c of calls) await this.leaveCall(c.id, userId);
  }

  /** Every 5 minutes: end calls nobody is in, or that have run for more than 8 hours. */
  async reapCalls(now = Date.now()): Promise<number> {
    const stale = await this.prisma.chatCall.findMany({ where: { endedAt: null, OR: [{ participantIds: { isEmpty: true } }, { startedAt: { lt: new Date(now - 8 * 3_600_000) } }] } });
    for (const c of stale) await this.endCall(c);
    return stale.length;
  }

  /** Recent message dates (for the day separators the web groups by). */
  static dayKeyOf(iso: string): string {
    return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
  }
}
