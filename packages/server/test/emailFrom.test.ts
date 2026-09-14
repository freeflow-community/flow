// From header (#493). The community broadcast mails as "Free Flow
// <noreply@mail.freeflow.im>"; everything else keeps the naked address, which
// is what this file pins on both sides.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { formatFrom, emailSender, _setEmailSenderForTests } = await import('../src/email/index.js');
const { config } = await import('../src/config.js');

describe('formatFrom', () => {
  it('pairs a display name with the address', () => {
    expect(formatFrom('noreply@mail.freeflow.im', 'Free Flow')).toBe(
      'Free Flow <noreply@mail.freeflow.im>',
    );
  });

  it('leaves the address bare when there is no name', () => {
    expect(formatFrom('noreply@mail.freeflow.im')).toBe('noreply@mail.freeflow.im');
    expect(formatFrom('noreply@mail.freeflow.im', '')).toBe('noreply@mail.freeflow.im');
  });

  it('quotes a name that is not an unquoted atom', () => {
    // A dot or a comma outside quotes makes the header parse as a different
    // address list than the one intended.
    expect(formatFrom('a@b.test', 'Flow, Inc.')).toBe('"Flow, Inc." <a@b.test>');
    expect(formatFrom('a@b.test', 'Say "hi"')).toBe('"Say \\"hi\\"" <a@b.test>');
  });
});

describe('CloudflareMailer payload', () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.FLOW_EMAIL_DRIVER = 'cloudflare';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_KEY = 'token';
    delete process.env.FLOW_EMAIL_FROM;
    delete process.env.FLOW_EMAIL_FROM_NAME;
    _setEmailSenderForTests(null);
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: { message_id: 'mid' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _setEmailSenderForTests(null);
    process.env = { ...env };
  });

  /** The JSON body of the one call the driver made. */
  function sentBody(): Record<string, unknown> {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  }

  it('sends a community broadcast with the friendly From name', async () => {
    await emailSender().send({
      to: 'member@example.test',
      subject: 'Downtime Saturday',
      text: 'body',
      html: '<p>body</p>',
      fromName: 'Free Flow',
    });
    expect(sentBody().from).toBe('Free Flow <noreply@mail.freeflow.im>');
  });

  it('leaves other mail on the bare address', async () => {
    await emailSender().send({ to: 'member@example.test', subject: 'Verify', text: 'link' });
    expect(sentBody().from).toBe('noreply@mail.freeflow.im');
  });

  it('defaults the configured name to Free Flow, and honours the env overrides', async () => {
    expect(config.emailFromName).toBe('Free Flow');
    process.env.FLOW_EMAIL_FROM = 'hello@example.test';
    process.env.FLOW_EMAIL_FROM_NAME = 'Example';
    _setEmailSenderForTests(null); // the driver captures the address at construction
    await emailSender().send({ to: 'a@b.test', subject: 's', text: 't', fromName: config.emailFromName });
    expect(sentBody().from).toBe('Example <hello@example.test>');
  });
});
