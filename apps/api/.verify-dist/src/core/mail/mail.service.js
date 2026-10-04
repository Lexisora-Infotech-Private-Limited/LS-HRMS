"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "MailService", {
    enumerable: true,
    get: function() {
        return MailService;
    }
});
const _common = require("@nestjs/common");
const _nodemailer = /*#__PURE__*/ _interop_require_default(require("nodemailer"));
const _env = require("../../config/env");
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
let MailService = class MailService {
    log = new _common.Logger('Mail');
    transport = _nodemailer.default.createTransport({
        host: _env.env.SMTP_HOST,
        port: _env.env.SMTP_PORT,
        secure: _env.env.SMTP_PORT === 465,
        auth: _env.env.SMTP_USER ? {
            user: _env.env.SMTP_USER,
            pass: _env.env.SMTP_PASS
        } : undefined
    });
    async send(m) {
        try {
            await this.transport.sendMail({
                from: _env.env.MAIL_FROM,
                ...m
            });
            return true;
        } catch (e) {
            this.log.error(`Mail to ${m.to} failed: ${e.message}`);
            return false;
        }
    }
};
MailService = _ts_decorate([
    (0, _common.Injectable)()
], MailService);

//# sourceMappingURL=mail.service.js.map