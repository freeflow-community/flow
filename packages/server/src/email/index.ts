// Email seam (mirrors the blob-store seam in ../storage): a minimal send()
// interface so deploy can swap the local dev driver for Cloudflare's Email
// Service without touching auth flows. The dev driver logs each message and
// drops it as a JSON file in .emails/ so a human (or QA script) can grab the
// verify/reset link.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

class DevMailer implements EmailSender {
  constructor(private readonly dir: string) {}

  async send(msg: EmailMessage): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = msg.to.replace(/[^a-zA-Z0-9@._-]/g, '_');
    const file = path.join(this.dir, `${stamp}-${slug}.json`);
    await fs.writeFile(file, JSON.stringify({ ...msg, sentAt: new Date().toISOString() }, null, 2));
    const link = msg.text.match(/https?:\/\/\S+/)?.[0];
    console.log(`[email:dev] to=${msg.to} subject="${msg.subject}"${link ? ` link=${link}` : ''} (${file})`);
  }
}

class CloudflareMailer implements EmailSender {
  async send(_msg: EmailMessage): Promise<void> {
    // Wired up in the deploy phase (Cloudflare Email Service). Failing loudly
    // beats silently dropping verification emails in a misconfigured deploy.
    throw new Error('FLOW_EMAIL_DRIVER=cloudflare is not wired up yet');
  }
}

let sender: EmailSender | null = null;

export function emailSender(): EmailSender {
  if (!sender) {
    sender = config.emailDriver === 'cloudflare' ? new CloudflareMailer() : new DevMailer(config.emailOutboxDir);
  }
  return sender;
}

/** Tests only: inject a fake or reset the singleton. */
export function _setEmailSenderForTests(s: EmailSender | null): void {
  sender = s;
}
