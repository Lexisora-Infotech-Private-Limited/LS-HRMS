import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';

export type SocketUser = { userId: string; tenantId: string; employeeId: string | null; deviceId?: string };

/**
 * Single Socket.IO namespace. Rooms:
 *   t:<tenantId>          — tenant-wide broadcasts (policy changes, notices)
 *   u:<userId>            — per-user (notifications, approvals, chat DMs)
 *   d:<deviceId>          — a paired tracker device
 *   ch:<channelId>        — chat channel members (joined by the chat module)
 * Handlers in domain gateways read `socket.data.user`.
 */
@WebSocketGateway({ path: '/socket.io', cors: { origin: env.WEB_ORIGIN, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: Socket) {
    const token = (socket.handshake.auth?.token as string) || (socket.handshake.query?.token as string);
    const p = token ? this.tokens.verify(token) : null;
    if (!p) {
      socket.disconnect(true);
      return;
    }
    const user = await this.prisma.raw.user.findUnique({ where: { id: p.sub }, include: { employee: { select: { id: true } } } });
    if (!user || user.tenantId !== p.tid || user.status === 'DISABLED') {
      socket.disconnect(true);
      return;
    }
    const su: SocketUser = { userId: user.id, tenantId: user.tenantId, employeeId: user.employee?.id ?? null };
    if (p.typ === 'device') su.deviceId = p.did;
    socket.data.user = su;
    socket.join([`t:${su.tenantId}`, `u:${su.userId}`]);
    if (su.deviceId) socket.join(`d:${su.deviceId}`);
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`u:${userId}`).emit(event, payload);
  }

  toUsers(userIds: string[], event: string, payload: unknown) {
    if (userIds.length) this.server?.to(userIds.map((u) => `u:${u}`)).emit(event, payload);
  }

  toTenant(tenantId: string, event: string, payload: unknown) {
    this.server?.to(`t:${tenantId}`).emit(event, payload);
  }

  toRoom(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }
}
