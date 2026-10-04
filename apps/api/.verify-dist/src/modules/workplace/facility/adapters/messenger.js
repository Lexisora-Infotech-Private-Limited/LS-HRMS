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
    get CloudApiMessenger () {
        return CloudApiMessenger;
    },
    get WaLinkMessenger () {
        return WaLinkMessenger;
    },
    get messengerFromEnv () {
        return messengerFromEnv;
    }
});
const _common = require("@nestjs/common");
const _env = require("../../../../config/env");
const _facilityrules = require("../facility.rules");
let CloudApiMessenger = class CloudApiMessenger {
    token;
    phoneId;
    name = 'cloud-api';
    log = new _common.Logger('WhatsApp');
    constructor(token, phoneId){
        this.token = token;
        this.phoneId = phoneId;
    }
    async sendPass(p) {
        const to = (0, _facilityrules.waNumber)(p.phone);
        const sentAt = new Date().toISOString();
        if (!to) return {
            channel: 'WHATSAPP',
            to: p.phone,
            status: 'FAILED',
            link: null,
            sentAt
        };
        try {
            const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneId}/messages`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to,
                    type: 'text',
                    text: {
                        preview_url: true,
                        body: p.text
                    }
                })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return {
                channel: 'WHATSAPP',
                to,
                status: 'SENT',
                link: (0, _facilityrules.waLink)(p.phone, p.text),
                sentAt
            };
        } catch (e) {
            this.log.warn(`send to ${to} failed: ${e.message}`);
            return {
                channel: 'WHATSAPP',
                to,
                status: 'FAILED',
                link: (0, _facilityrules.waLink)(p.phone, p.text),
                sentAt
            };
        }
    }
};
let WaLinkMessenger = class WaLinkMessenger {
    name = 'wa-link';
    log = new _common.Logger('WhatsApp');
    async sendPass(p) {
        const link = (0, _facilityrules.waLink)(p.phone, p.text);
        const sentAt = new Date().toISOString();
        if (!link) return {
            channel: 'WHATSAPP',
            to: p.phone,
            status: 'FAILED',
            link: null,
            sentAt
        };
        this.log.log(`e-pass for ${(0, _facilityrules.waNumber)(p.phone)} via ${link.slice(0, 40)}…`);
        return {
            channel: 'WHATSAPP',
            to: (0, _facilityrules.waNumber)(p.phone),
            status: 'LINK',
            link,
            sentAt
        };
    }
};
function messengerFromEnv() {
    if (_env.env.WHATSAPP_TOKEN && _env.env.WHATSAPP_PHONE_ID) return new CloudApiMessenger(_env.env.WHATSAPP_TOKEN, _env.env.WHATSAPP_PHONE_ID);
    return new WaLinkMessenger();
}

//# sourceMappingURL=messenger.js.map