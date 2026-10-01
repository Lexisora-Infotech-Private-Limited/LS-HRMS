import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  callRecordingSchema,
  callStartSchema,
  channelCreateSchema,
  channelMembersSchema,
  channelMeSchema,
  channelReadSchema,
  chatSearchQuery,
  dmCreateSchema,
  messageEditSchema,
  messageSendSchema,
  messagesQuery,
  type ChannelCreateInput,
  type MessageSendInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { ChatService } from './chat.service';

const restSendSchema = messageSendSchema.innerType().omit({ channelId: true });
const archiveSchema = z.object({ archived: z.boolean() });

/** Comms hub — /chat (spec §5.4). Realtime events are in ChatRealtime. */
@Controller('chat')
@RequirePerm('chat.use')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('channels')
  channels() {
    return this.chat.listChannels();
  }

  @Get('channels/browse')
  browse() {
    return this.chat.browse();
  }

  @Post('channels')
  create(@Body(new ZodPipe(channelCreateSchema)) dto: ChannelCreateInput) {
    return this.chat.createChannel(dto);
  }

  @Get('channels/:id')
  channel(@Param('id') id: string) {
    return this.chat.channelRow(id);
  }

  @Post('channels/:id/join')
  join(@Param('id') id: string) {
    return this.chat.join(id);
  }

  @Post('channels/:id/leave')
  leave(@Param('id') id: string) {
    return this.chat.leave(id);
  }

  @Patch('channels/:id/me')
  me(@Param('id') id: string, @Body(new ZodPipe(channelMeSchema)) dto: z.infer<typeof channelMeSchema>) {
    return this.chat.setMuted(id, dto.muted);
  }

  @Post('channels/:id/archive')
  archive(@Param('id') id: string, @Body(new ZodPipe(archiveSchema)) dto: z.infer<typeof archiveSchema>) {
    return this.chat.archive(id, dto.archived);
  }

  @Get('channels/:id/members')
  members(@Param('id') id: string) {
    return this.chat.members(id);
  }

  @Post('channels/:id/members')
  addMembers(@Param('id') id: string, @Body(new ZodPipe(channelMembersSchema)) dto: z.infer<typeof channelMembersSchema>) {
    return this.chat.addMembers(id, dto.userIds);
  }

  @Delete('channels/:id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.chat.removeMember(id, userId);
  }

  @Get('channels/:id/messages')
  messages(@Param('id') id: string, @Query(new ZodPipe(messagesQuery)) q: z.infer<typeof messagesQuery>) {
    return this.chat.messages(id, q);
  }

  /** REST fallback for the socket `chat:send`. */
  @Post('channels/:id/messages')
  send(@Param('id') id: string, @Body(new ZodPipe(restSendSchema)) dto: Omit<MessageSendInput, 'channelId'>) {
    return this.chat.send(messageSendSchema.parse({ ...dto, channelId: id }));
  }

  @Post('channels/:id/read')
  read(@Param('id') id: string, @Body(new ZodPipe(channelReadSchema)) dto: z.infer<typeof channelReadSchema>) {
    return this.chat.markRead(id, dto.seq);
  }

  @Patch('messages/:id')
  edit(@Param('id') id: string, @Body(new ZodPipe(messageEditSchema)) dto: z.infer<typeof messageEditSchema>) {
    return this.chat.edit(id, dto.body);
  }

  @Delete('messages/:id')
  remove(@Param('id') id: string) {
    return this.chat.remove(id);
  }

  @Post('dms')
  dm(@Body(new ZodPipe(dmCreateSchema)) dto: z.infer<typeof dmCreateSchema>) {
    return this.chat.openDm(dto.userIds);
  }

  @Get('people')
  people() {
    return this.chat.people();
  }

  @Get('search')
  search(@Query(new ZodPipe(chatSearchQuery)) q: z.infer<typeof chatSearchQuery>) {
    return this.chat.search(q.q, q.channelId);
  }

  // ── Calls (LiveKit when configured; otherwise a local preview) ─────────
  @Get('channels/:id/call')
  activeCall(@Param('id') id: string) {
    return this.chat.activeCall(id);
  }

  @Post('channels/:id/calls')
  startCall(@Param('id') id: string, @Body(new ZodPipe(callStartSchema)) dto: z.infer<typeof callStartSchema>) {
    return this.chat.startCall(id, dto.kind);
  }

  @Post('calls/:id/join')
  joinCall(@Param('id') id: string) {
    return this.chat.joinCall(id);
  }

  @Post('calls/:id/leave')
  leaveCall(@Param('id') id: string) {
    return this.chat.leaveCall(id);
  }

  @Post('calls/:id/recording')
  recording(@Param('id') id: string, @Body(new ZodPipe(callRecordingSchema)) dto: z.infer<typeof callRecordingSchema>) {
    return this.chat.setRecording(id, dto.on);
  }
}
