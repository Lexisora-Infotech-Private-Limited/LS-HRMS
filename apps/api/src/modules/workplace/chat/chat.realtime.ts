import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { channelReadSchema, messageSendSchema } from '@lexisora/shared';
import { z } from 'zod';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RealtimeGateway, type SocketUser } from '../../../core/realtime/realtime.gateway';
import { runWithContext, type RequestContext } from '../../../core/context/request-context';
import { ChatService } from './chat.service';

const joinSchema = z.object({ channelId: z.string().min(1) });
const typingSchema = z.object({ channelId: z.string().min(1), on: z.boolean().default(true) });
const readSchema = channelReadSchema.extend({ channelId: z.string().min(1) });
type Ack = ((res: unknown) => void) | undefined;

/**
 * Comms hub socket events, registered on the core RealtimeGateway server (one Socket.IO
 * server per app — no second gateway). Client → server: chat:join, chat:send, chat:typing,
 * chat:read. Server → client (from ChatService): chat:message, chat:message:updated,
 * chat:message:deleted, chat:typing, chat:read, chat:channels, call:ring / participants /
 * recording / ended. Every handler runs inside the user's tenant context.
 */
@Injectable()
export class ChatRealtime implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger('ChatRealtime');
  private attached = false;

  constructor(
    private readonly realtime: RealtimeGateway,
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  onModuleInit() {
    this.attach();
  }

  onApplicationBootstrap() {
    this.attach();
  }

  private attach() {
    const server = this.realtime.server;
    if (this.attached || !server) return;
    this.attached = true;
    server.on('connection', (socket: Socket) => this.onConnection(socket));
    this.log.log('chat socket handlers registered');
  }

  /** The core gateway authenticates asynchronously; wait for `socket.data.user`. */
  private async userOf(socket: Socket, timeoutMs = 5000): Promise<SocketUser | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (socket.disconnected) return null;
      const u = socket.data?.user as SocketUser | undefined;
      if (u) return u.deviceId ? null : u;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  private async ctxOf(socket: Socket): Promise<RequestContext | null> {
    const cached = socket.data.wpCtx as { ctx: RequestContext; at: number } | undefined;
    if (cached && Date.now() - cached.at < 60_000) return cached.ctx;
    const su = await this.userOf(socket);
    if (!su) return null;
    const u = await this.prisma.raw.user.findUnique({ where: { id: su.userId }, include: { role: true, employee: { select: { id: true, fullName: true, status: true } } } });
    if (!u || u.tenantId !== su.tenantId || u.status === 'DISABLED' || u.employee?.status === 'EXITED') return null;
    const perms = new Set(u.role.permissions);
    if (!perms.has('chat.use') && !perms.has('*')) return null;
    const ctx: RequestContext = { tenantId: u.tenantId, userId: u.id, employeeId: u.employee?.id ?? null, roleKey: u.role.key, permissions: perms, isPlatformAdmin: u.isPlatformAdmin, userName: u.employee?.fullName ?? u.name };
    socket.data.wpCtx = { ctx, at: Date.now() };
    return ctx;
  }

  private onConnection(socket: Socket) {
    socket.on('chat:join', (p: unknown, ack: Ack) =>
      this.handle(socket, ack, async () => {
        const { channelId } = joinSchema.parse(p);
        await this.chat.assertMember(channelId);
        await socket.join(`ch:${channelId}`);
        return { ok: true };
      }),
    );
    socket.on('chat:send', (p: unknown, ack: Ack) => this.handle(socket, ack, async () => ({ ok: true, message: await this.chat.send(messageSendSchema.parse(p)) })));
    socket.on('chat:read', (p: unknown, ack: Ack) =>
      this.handle(socket, ack, async () => {
        const { channelId, seq } = readSchema.parse(p);
        return this.chat.markRead(channelId, seq);
      }),
    );
    // Typing is ephemeral: only relayed to the channel room the socket already belongs to.
    socket.on('chat:typing', (p: unknown) => {
      const parsed = typingSchema.safeParse(p);
      if (!parsed.success || !socket.rooms.has(`ch:${parsed.data.channelId}`)) return;
      const ctx = (socket.data.wpCtx as { ctx: RequestContext } | undefined)?.ctx;
      if (!ctx) return;
      socket.to(`ch:${parsed.data.channelId}`).emit('chat:typing', { channelId: parsed.data.channelId, userId: ctx.userId, name: (ctx.userName ?? '').split(' ')[0] || 'Someone', on: parsed.data.on });
    });
    socket.on('disconnect', () => void this.onDisconnect(socket));
    void this.joinRooms(socket);
  }

  /** Join the rooms of every channel the user belongs to. */
  private async joinRooms(socket: Socket) {
    try {
      const ctx = await this.ctxOf(socket);
      if (!ctx?.userId) return;
      const rows = await this.prisma.raw.chatMember.findMany({ where: { tenantId: ctx.tenantId, userId: ctx.userId }, select: { channelId: true } });
      if (rows.length) await socket.join(rows.map((r) => `ch:${r.channelId}`));
    } catch (e) {
      this.log.debug(`joinRooms: ${(e as Error).message}`);
    }
  }

  /** Leaving the last socket drops the user from any live call (the call ends when empty). */
  private async onDisconnect(socket: Socket) {
    const ctx = (socket.data?.wpCtx as { ctx: RequestContext } | undefined)?.ctx;
    if (!ctx?.userId) return;
    setTimeout(() => {
      void (async () => {
        try {
          const still = await this.realtime.server.in(`u:${ctx.userId}`).fetchSockets();
          if (still.length) return;
          await runWithContext(ctx, () => this.chat.dropFromCalls(ctx.userId!));
        } catch (e) {
          this.log.debug(`disconnect cleanup: ${(e as Error).message}`);
        }
      })();
    }, 15_000);
  }

  private async handle(socket: Socket, ack: Ack, fn: () => Promise<unknown>) {
    try {
      const ctx = await this.ctxOf(socket);
      if (!ctx) throw new Error('Not signed in');
      const res = await runWithContext(ctx, fn);
      if (typeof ack === 'function') ack(res);
    } catch (e) {
      const err = e as { message?: string; response?: { message?: string; code?: string }; issues?: { message: string }[] };
      const message = err.response?.message ?? err.issues?.[0]?.message ?? err.message ?? 'Something went wrong';
      if (typeof ack === 'function') ack({ ok: false, error: message, code: err.response?.code ?? 'ERROR' });
    }
  }
}
