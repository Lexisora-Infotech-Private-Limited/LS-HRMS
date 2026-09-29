import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';

export type MailAttachment = { filename: string; content: Buffer | string; contentType?: string };
export type MailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  cc?: string | string[];
  attachments?: MailAttachment[];
  /** Calendar invite (interviews, room bookings). */
  icalEvent?: { filename?: string; method?: 'REQUEST' | 'CANCEL'; content: string };
};

/** SMTP mail (Mailpit in dev at http://localhost:8025). Failures are logged, never thrown to callers. */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly transport: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });

  async send(m: MailInput): Promise<boolean> {
    try {
      await this.transport.sendMail({ from: env.MAIL_FROM, ...m });
      return true;
    } catch (e) {
      this.log.error(`Mail to ${m.to} failed: ${(e as Error).message}`);
      return false;
    }
  }
}
