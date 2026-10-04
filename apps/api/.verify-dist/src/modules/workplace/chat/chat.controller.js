"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ChatController", {
    enumerable: true,
    get: function() {
        return ChatController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _chatservice = require("./chat.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") {
        r = Reflect.decorate(decorators, target, key, desc);
    } else {
        for(var i = decorators.length - 1; i >= 0; i--){
            if (d = decorators[i]) {
                r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
            }
        }
    }
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(metadataKey, metadataValue) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") {
        return Reflect.metadata(metadataKey, metadataValue);
    }
}
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
const restSendSchema = _shared.messageSendSchema.innerType().omit({
    channelId: true
});
const archiveSchema = _zod.z.object({
    archived: _zod.z.boolean()
});
let ChatController = class ChatController {
    chat;
    constructor(chat){
        this.chat = chat;
    }
    channels() {
        return this.chat.listChannels();
    }
    browse() {
        return this.chat.browse();
    }
    create(dto) {
        return this.chat.createChannel(dto);
    }
    channel(id) {
        return this.chat.channelRow(id);
    }
    join(id) {
        return this.chat.join(id);
    }
    leave(id) {
        return this.chat.leave(id);
    }
    me(id, dto) {
        return this.chat.setMuted(id, dto.muted);
    }
    archive(id, dto) {
        return this.chat.archive(id, dto.archived);
    }
    members(id) {
        return this.chat.members(id);
    }
    addMembers(id, dto) {
        return this.chat.addMembers(id, dto.userIds);
    }
    removeMember(id, userId) {
        return this.chat.removeMember(id, userId);
    }
    messages(id, q) {
        return this.chat.messages(id, q);
    }
    /** REST fallback for the socket `chat:send`. */ send(id, dto) {
        return this.chat.send(_shared.messageSendSchema.parse({
            ...dto,
            channelId: id
        }));
    }
    read(id, dto) {
        return this.chat.markRead(id, dto.seq);
    }
    edit(id, dto) {
        return this.chat.edit(id, dto.body);
    }
    remove(id) {
        return this.chat.remove(id);
    }
    dm(dto) {
        return this.chat.openDm(dto.userIds);
    }
    people() {
        return this.chat.people();
    }
    search(q) {
        return this.chat.search(q.q, q.channelId);
    }
    // ── Calls (LiveKit when configured; otherwise a local preview) ─────────
    activeCall(id) {
        return this.chat.activeCall(id);
    }
    startCall(id, dto) {
        return this.chat.startCall(id, dto.kind);
    }
    joinCall(id) {
        return this.chat.joinCall(id);
    }
    leaveCall(id) {
        return this.chat.leaveCall(id);
    }
    recording(id, dto) {
        return this.chat.setRecording(id, dto.on);
    }
};
_ts_decorate([
    (0, _common.Get)('channels'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "channels", null);
_ts_decorate([
    (0, _common.Get)('channels/browse'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "browse", null);
_ts_decorate([
    (0, _common.Post)('channels'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.channelCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ChannelCreateInput === "undefined" ? Object : ChannelCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)('channels/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "channel", null);
_ts_decorate([
    (0, _common.Post)('channels/:id/join'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "join", null);
_ts_decorate([
    (0, _common.Post)('channels/:id/leave'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "leave", null);
_ts_decorate([
    (0, _common.Patch)('channels/:id/me'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.channelMeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "me", null);
_ts_decorate([
    (0, _common.Post)('channels/:id/archive'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(archiveSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "archive", null);
_ts_decorate([
    (0, _common.Get)('channels/:id/members'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "members", null);
_ts_decorate([
    (0, _common.Post)('channels/:id/members'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.channelMembersSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "addMembers", null);
_ts_decorate([
    (0, _common.Delete)('channels/:id/members/:userId'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('userId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "removeMember", null);
_ts_decorate([
    (0, _common.Get)('channels/:id/messages'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.messagesQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "messages", null);
_ts_decorate([
    (0, _common.Post)('channels/:id/messages'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(restSendSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Omit === "undefined" ? Object : Omit
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "send", null);
_ts_decorate([
    (0, _common.Post)('channels/:id/read'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.channelReadSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "read", null);
_ts_decorate([
    (0, _common.Patch)('messages/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.messageEditSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "edit", null);
_ts_decorate([
    (0, _common.Delete)('messages/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Post)('dms'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.dmCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "dm", null);
_ts_decorate([
    (0, _common.Get)('people'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "people", null);
_ts_decorate([
    (0, _common.Get)('search'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.chatSearchQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "search", null);
_ts_decorate([
    (0, _common.Get)('channels/:id/call'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "activeCall", null);
_ts_decorate([
    (0, _common.Post)('channels/:id/calls'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.callStartSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "startCall", null);
_ts_decorate([
    (0, _common.Post)('calls/:id/join'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "joinCall", null);
_ts_decorate([
    (0, _common.Post)('calls/:id/leave'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "leaveCall", null);
_ts_decorate([
    (0, _common.Post)('calls/:id/recording'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.callRecordingSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ChatController.prototype, "recording", null);
ChatController = _ts_decorate([
    (0, _common.Controller)('chat'),
    (0, _decorators.RequirePerm)('chat.use'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _chatservice.ChatService === "undefined" ? Object : _chatservice.ChatService
    ])
], ChatController);

//# sourceMappingURL=chat.controller.js.map