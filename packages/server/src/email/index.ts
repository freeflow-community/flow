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
  /** Optional HTML alternative (#481 community broadcasts). When present the
   * message is multipart: `text` stays the fallback for clients that refuse
   * HTML, and the two must say the same thing. Auth flows send text only. */
  html?: string;
  /** Optional display name for the From header (#493) — the address itself is
   * still the driver's, so a caller can label its mail but never impersonate a
   * different sender. Omitted means the bare address, which is what auth mail
   * still sends. */
  fromName?: string;
}

/** RFC 5322 `Display Name <addr>`. Anything outside the unquoted-atom set —
 * dots, commas, quotes, brackets — has to go inside a quoted-string, or the
 * header parses as a different address than the one we meant. */
export function formatFrom(address: string, name?: string): string {
  if (!name) return address;
  const safe = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/.test(name);
  const display = safe ? name : `"${name.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  return `${display} <${address}>`;
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
    await fs.writeFile(
      file,
      JSON.stringify(
        { ...msg, from: formatFrom(config.emailFrom, msg.fromName), sentAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    const link = msg.text.match(/https?:\/\/\S+/)?.[0];
    console.log(
      `[email:dev] from=${formatFrom(config.emailFrom, msg.fromName)} to=${msg.to} subject="${msg.subject}"${link ? ` link=${link}` : ''}${msg.html ? ' +html' : ''} (${file})`,
    );
  }
}

/**
 * Cloudflare Email Service REST API. Note the flat request shape: `from`/`to`
 * are plain address strings, not {email} objects.
 * https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
 */
class CloudflareMailer implements EmailSender {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
    private readonly from: string,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/email/sending/send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: formatFrom(this.from, msg.fromName),
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          // Cloudflare's flat send API names the HTML alternative `html`,
          // alongside `text` rather than instead of it.
          ...(msg.html ? { html: msg.html } : {}),
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { code: number; message: string }[];
      result?: { message_id?: string; permanent_bounces?: string[] };
    };
    if (!res.ok || !json.success) {
      const detail = json.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
      throw new Error(`cloudflare email send failed (${detail})`);
    }
    if (json.result?.permanent_bounces?.includes(msg.to)) {
      throw new Error(`cloudflare email send: permanent bounce for ${msg.to}`);
    }
    console.log(`[email:cloudflare] to=${msg.to} subject="${msg.subject}" id=${json.result?.message_id ?? '?'}`);
  }
}

let sender: EmailSender | null = null;

export function emailSender(): EmailSender {
  if (!sender) {
    if (config.emailDriver === 'cloudflare') {
      const { cloudflareAccountId: accountId, cloudflareApiToken: apiToken } = config;
      if (!accountId || !apiToken) {
        // Failing loudly beats silently dropping verification emails.
        throw new Error('FLOW_EMAIL_DRIVER=cloudflare requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_KEY');
      }
      sender = new CloudflareMailer(accountId, apiToken, config.emailFrom);
    } else {
      sender = new DevMailer(config.emailOutboxDir);
    }
  }
  return sender;
}

/** Tests only: inject a fake or reset the singleton. */
export function _setEmailSenderForTests(s: EmailSender | null): void {
  sender = s;
}
