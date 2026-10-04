import { Logger } from '@nestjs/common';
import { env } from '../../../../config/env';
import { waLink, waNumber } from '../facility.rules';

export type PassDelivery = { channel: 'WHATSAPP' | 'EMAIL'; to: string; status: 'SENT' | 'LINK' | 'FAILED'; link: string | null; sentAt: string };

/** Sends a visitor e-pass on WhatsApp (spec §8.7). */
export interface WhatsAppMessenger {
  readonly name: 'cloud-api' | 'wa-link';
  sendPass(p: { phone: string; text: string }): Promise<PassDelivery>;
}

/**
 * WhatsApp Cloud API — used when WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set. Sends a plain
 * text message with the pass link (a production tenant would use an approved template).
 */
export class CloudApiMessenger implements WhatsAppMessenger {
  readonly name = 'cloud-api' as const;
  private readonly log = new Logger('WhatsApp');
  constructor(
    private readonly token: string,
    private readonly phoneId: string,
  ) {}

  async sendPass(p: { phone: string; text: string }): Promise<PassDelivery> {
    const to = waNumber(p.phone);
    const sentAt = new Date().toISOString();
    if (!to) return { channel: 'WHATSAPP', to: p.phone, status: 'FAILED', link: null, sentAt };
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: true, body: p.text } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { channel: 'WHATSAPP', to, status: 'SENT', link: waLink(p.phone, p.text), sentAt };
    } catch (e) {
      this.log.warn(`send to ${to} failed: ${(e as Error).message}`);
      return { channel: 'WHATSAPP', to, status: 'FAILED', link: waLink(p.phone, p.text), sentAt };
    }
  }
}

/**
 * Without WhatsApp credentials the pass goes out through a wa.me deep link: the web app opens
 * it right after registration so the host's WhatsApp sends the prefilled message.
 */
export class WaLinkMessenger implements WhatsAppMessenger {
  readonly name = 'wa-link' as const;
  private readonly log = new Logger('WhatsApp');

  async sendPass(p: { phone: string; text: string }): Promise<PassDelivery> {
    const link = waLink(p.phone, p.text);
    const sentAt = new Date().toISOString();
    if (!link) return { channel: 'WHATSAPP', to: p.phone, status: 'FAILED', link: null, sentAt };
    this.log.log(`e-pass for ${waNumber(p.phone)} via ${link.slice(0, 40)}…`);
    return { channel: 'WHATSAPP', to: waNumber(p.phone)!, status: 'LINK', link, sentAt };
  }
}

export function messengerFromEnv(): WhatsAppMessenger {
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) return new CloudApiMessenger(env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_ID);
  return new WaLinkMessenger();
}
