"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get FacilityController () {
        return FacilityController;
    },
    get FacilityPassController () {
        return FacilityPassController;
    }
});
const _common = require("@nestjs/common");
const _qrcode = /*#__PURE__*/ _interop_require_default(require("qrcode"));
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _errors = require("../../../core/http/errors");
const _http = require("../common/http");
const _facilityservice = require("./facility.service");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
const roomsQuery = _zod.z.object({
    all: _zod.z.enum([
        '0',
        '1',
        'true',
        'false'
    ]).optional().transform((v)=>v === '1' || v === 'true')
});
const passLimit = (0, _http.rateLimiter)(30, 60_000);
let FacilityController = class FacilityController {
    facility;
    constructor(facility){
        this.facility = facility;
    }
    list(q) {
        return this.facility.list(q);
    }
    rooms(q) {
        return this.facility.rooms(q.all);
    }
    createRoom(dto) {
        return this.facility.upsertRoom(null, dto);
    }
    updateRoom(id, dto) {
        return this.facility.upsertRoom(id, dto);
    }
    availability(q) {
        return this.facility.availability(q.date);
    }
    check(q) {
        return this.facility.check(q);
    }
    book(dto) {
        return this.facility.book(dto);
    }
    updateBooking(id, dto) {
        return this.facility.updateBooking(id, dto);
    }
    cancelBooking(id, dto) {
        return this.facility.cancelBooking(id, dto.reason);
    }
    register(dto) {
        return this.facility.registerVisitor(dto);
    }
    resend(id) {
        return this.facility.resendPass(id);
    }
    cancelVisitor(id, dto) {
        return this.facility.cancelVisitor(id, dto.reason);
    }
    // ── Front desk (facility.manage) ────────────────────────────────────────
    frontDesk() {
        return this.facility.frontDesk();
    }
    lookup(dto) {
        return this.facility.lookup(dto.code);
    }
    checkIn(id) {
        return this.facility.checkIn(id);
    }
    checkOut(id) {
        return this.facility.checkOut(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.facilityListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('rooms'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(roomsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "rooms", null);
_ts_decorate([
    (0, _common.Post)('rooms'),
    (0, _decorators.RequirePerm)('facility.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.roomUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "createRoom", null);
_ts_decorate([
    (0, _common.Patch)('rooms/:id'),
    (0, _decorators.RequirePerm)('facility.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.roomUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "updateRoom", null);
_ts_decorate([
    (0, _common.Get)('rooms/availability'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.availabilityQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "availability", null);
_ts_decorate([
    (0, _common.Get)('bookings/check'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.bookingCheckQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "check", null);
_ts_decorate([
    (0, _common.Post)('bookings'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.bookingCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof BookingCreateInput === "undefined" ? Object : BookingCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "book", null);
_ts_decorate([
    (0, _common.Patch)('bookings/:id'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.bookingUpdateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "updateBooking", null);
_ts_decorate([
    (0, _common.Post)('bookings/:id/cancel'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.wpCancelSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "cancelBooking", null);
_ts_decorate([
    (0, _common.Post)('visitors'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.visitorCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof VisitorCreateInput === "undefined" ? Object : VisitorCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "register", null);
_ts_decorate([
    (0, _common.Post)('visitors/:id/resend-pass'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "resend", null);
_ts_decorate([
    (0, _common.Post)('visitors/:id/cancel'),
    (0, _decorators.RequirePerm)('facility.use', 'facility.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.wpCancelSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "cancelVisitor", null);
_ts_decorate([
    (0, _common.Get)('frontdesk'),
    (0, _decorators.RequirePerm)('facility.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "frontDesk", null);
_ts_decorate([
    (0, _common.Post)('visitors/lookup'),
    (0, _decorators.RequirePerm)('facility.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.visitorLookupSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "lookup", null);
_ts_decorate([
    (0, _common.Post)('visitors/:id/check-in'),
    (0, _decorators.RequirePerm)('facility.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "checkIn", null);
_ts_decorate([
    (0, _common.Post)('visitors/:id/check-out'),
    (0, _decorators.RequirePerm)('facility.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FacilityController.prototype, "checkOut", null);
FacilityController = _ts_decorate([
    (0, _common.Controller)('facility'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _facilityservice.FacilityService === "undefined" ? Object : _facilityservice.FacilityService
    ])
], FacilityController);
let FacilityPassController = class FacilityPassController {
    facility;
    constructor(facility){
        this.facility = facility;
    }
    async pass(token, ip, res, accept) {
        if (!passLimit(ip ?? 'unknown')) throw new _errors.AppError(429, 'RATE_LIMITED', 'Too many requests — try again in a minute');
        const p = await this.facility.publicPass(token);
        if (!p) throw (0, _errors.notFound)('Pass');
        res.setHeader('Cache-Control', 'no-store');
        if ((accept ?? '').includes('application/json')) res.json(p.json);
        else res.type('html').send(p.html);
    }
    async qr(token, ip, res) {
        if (!passLimit(ip ?? 'unknown')) throw new _errors.AppError(429, 'RATE_LIMITED', 'Too many requests — try again in a minute');
        const p = await this.facility.publicPass(token);
        if (!p || !p.json.valid) throw (0, _errors.notFound)('Pass');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.send(await _qrcode.default.toBuffer((0, _facilityservice.passUrlFor)(token), {
            type: 'png',
            margin: 1,
            width: 360
        }));
    }
};
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Get)(':token'),
    _ts_param(0, (0, _common.Param)('token')),
    _ts_param(1, (0, _common.Ip)()),
    _ts_param(2, (0, _common.Res)()),
    _ts_param(3, (0, _common.Headers)('accept')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Response === "undefined" ? Object : Response,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], FacilityPassController.prototype, "pass", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Get)(':token/qr.png'),
    _ts_param(0, (0, _common.Param)('token')),
    _ts_param(1, (0, _common.Ip)()),
    _ts_param(2, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], FacilityPassController.prototype, "qr", null);
FacilityPassController = _ts_decorate([
    (0, _common.Controller)('facility/pass'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _facilityservice.FacilityService === "undefined" ? Object : _facilityservice.FacilityService
    ])
], FacilityPassController);

//# sourceMappingURL=facility.controller.js.map