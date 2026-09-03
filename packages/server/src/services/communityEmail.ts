// Community email (#481): an owner/admin broadcasts one message to every human
// member of a workspace, composed in the web Directory.
//
// Two rules shape this file. First, the *renderer is the single source of
// truth* — `previewBroadcast` and `sendBroadcast` both call
// renderBroadcastEmailHtml, so the composer's Preview tab is showing the
// literal output of the send path rather than a re-implementation of it.
// Second, a broadcast is a batch of independent sends: one address that
// bounces must not cost the other N-1 people their email, so each send is
// awaited inside its own try and only tallied.
import { and, eq, isNull } from 'drizzle-orm';
import type { WorkspaceEmailPreviewDTO, WorkspaceEmailResultDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { forbidden, notFound, ApiError } from '../lib/errors.js';
import { rateAllow } from '../lib/rateLimit.js';
import { emailSender } from '../email/index.js';
import { renderBroadcastEmailHtml, renderBroadcastEmailText } from '../email/render.js';
import { requireMembership } from './workspaces.js';

const { users, workspaces, workspaceMembers } = schema;

/** One broadcast per workspace per 10 minutes — stops a double-clicked confirm
 * from mailing everyone twice, and caps the blast radius of a compromised
 * admin session. */
const BROADCAST_LIMIT = 1;
const BROADCAST_WINDOW_MS = 10 * 60_000;

/** A test send goes to one consenting address — the author's own — so it needs
 * a limit only as an anti-abuse floor, not as a blast-radius cap. Deliberately
 * a *separate* window from the broadcast one: checking a draft's rendering
 * must never be the reason the real send is refused. */
const TEST_LIMIT = 1;
const TEST_WINDOW_MS = 60_000;

/** Subject prefix on a test send. The point of testing in a real mail client
 * is that the mail looks real, so the subject is the one place left that can
 * tell the author this copy is not the broadcast. */
export const TEST_SUBJECT_PREFIX = '[Test] ';

/** Owner/admin gate, following the `requireAdmin` pattern in services/apps.ts. */
async function requireAdmin(workspaceId: string, actorId: string) {
  const m = await requireMembership(workspaceId, actorId);
  if (m.role !== 'owner' && m.role !== 'admin') {
    throw forbidden('only owners and admins can email the workspace');
  }
  return m;
}

interface BroadcastContext {
  senderName: string;
  workspaceName: string;
  recipients: { userId: string; email: string; displayName: string }[];
}

/**
 * Who gets it, and whose name goes in the footer.
 *
 * Recipients are human members only: agents and app bots carry synthetic
 * addresses (`agent-<uuid>@agents.flow.local`, `bot-<uuid>@apps.flow.local`)
 * that no mail server will accept, and a tombstoned user has had their `email`
 * vacated on removal, so all three are excluded at the query.
 */
async function loadContext(workspaceId: string, actorId: string): Promise<BroadcastContext> {
  const wsRows = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const ws = wsRows[0];
  if (!ws) throw notFound('workspace not found');

  const actorRows = await db.select().from(users).where(eq(users.id, actorId)).limit(1);
  const actor = actorRows[0];
  if (!actor) throw notFound('user not found');

  const rows = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(users.isAgent, false),
        eq(users.isBot, false),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(workspaceMembers.joinedAt);

  return {
    senderName: actor.displayName,
    workspaceName: ws.name,
    recipients: rows.map((r) => ({ userId: r.id, email: r.email, displayName: r.displayName })),
  };
}

/** Admin-gated preview: the exact HTML `sendBroadcast` would mail, plus the
 * recipient count, so the composer never has to guess at either. */
export async function previewBroadcast(
  workspaceId: string,
  actorId: string,
  markdown: string,
): Promise<WorkspaceEmailPreviewDTO> {
  await requireAdmin(workspaceId, actorId);
  const ctx = await loadContext(workspaceId, actorId);
  return {
    html: renderBroadcastEmailHtml({
      markdown,
      senderName: ctx.senderName,
      workspaceName: ctx.workspaceName,
    }),
    recipientCount: ctx.recipients.length,
  };
}

/** How many people a broadcast would reach right now — the number the composer
 * puts in its To chip and its confirm step. */
export async function countBroadcastRecipients(workspaceId: string, actorId: string): Promise<number> {
  await requireAdmin(workspaceId, actorId);
  const ctx = await loadContext(workspaceId, actorId);
  return ctx.recipients.length;
}

/**
 * Send it. Returns `{sent, failed}` — a per-address tally, not a boolean, so
 * the admin learns that 41 of 42 landed instead of seeing one exception and
 * assuming nothing went out.
 */
export async function sendBroadcast(
  workspaceId: string,
  actorId: string,
  subject: string,
  markdown: string,
): Promise<WorkspaceEmailResultDTO> {
  await requireAdmin(workspaceId, actorId);
  // Rate-limited per workspace, not per admin: two admins hitting send on the
  // same announcement is exactly the double-send this prevents. Checked after
  // the role gate so a non-admin probe can't burn the workspace's window.
  if (!rateAllow(`ws-email:${workspaceId}`, BROADCAST_LIMIT, BROADCAST_WINDOW_MS)) {
    throw new ApiError(429, 'rate_limited', 'only one broadcast per workspace every 10 minutes');
  }

  const ctx = await loadContext(workspaceId, actorId);
  const html = renderBroadcastEmailHtml({
    markdown,
    senderName: ctx.senderName,
    workspaceName: ctx.workspaceName,
  });
  const text = renderBroadcastEmailText({
    markdown,
    senderName: ctx.senderName,
    workspaceName: ctx.workspaceName,
  });

  const sender = emailSender();
  let sent = 0;
  let failed = 0;
  for (const r of ctx.recipients) {
    try {
      await sender.send({ to: r.email, subject, text, html });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[ws-email] send failed workspace=${workspaceId} to=${r.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  console.log(`[ws-email] workspace=${workspaceId} by=${actorId} sent=${sent} failed=${failed}`);
  return { sent, failed };
}

/**
 * Mail the current draft to the author alone (#484).
 *
 * Same renderer, same footer, same plain-text alternative as `sendBroadcast` —
 * the whole value of the button is that what lands in the inbox is what the
 * workspace would get, so the only difference permitted here is the subject
 * prefix and the recipient list of one.
 */
export async function sendTestBroadcast(
  workspaceId: string,
  actorId: string,
  subject: string,
  markdown: string,
): Promise<WorkspaceEmailResultDTO> {
  await requireAdmin(workspaceId, actorId);
  // Per *user*, not per workspace, and on its own key: a test must not consume
  // the workspace's broadcast window (a composer that made you wait ten
  // minutes to send after checking your draft would just stop being used).
  if (!rateAllow(`ws-email-test:${actorId}`, TEST_LIMIT, TEST_WINDOW_MS)) {
    throw new ApiError(429, 'rate_limited', 'only one test email per minute');
  }

  const ctx = await loadContext(workspaceId, actorId);
  const to = ctx.recipients.find((r) => r.userId === actorId)?.email;
  // An admin whose address the broadcast would skip (tombstoned, synthetic)
  // has nowhere to send a test — better a 400 than a silent success.
  if (!to) throw new ApiError(400, 'no_address', 'your account has no address to send a test to');

  const args = { markdown, senderName: ctx.senderName, workspaceName: ctx.workspaceName };
  try {
    await emailSender().send({
      to,
      subject: `${TEST_SUBJECT_PREFIX}${subject}`,
      text: renderBroadcastEmailText(args),
      html: renderBroadcastEmailHtml(args),
    });
    console.log(`[ws-email] test workspace=${workspaceId} by=${actorId} to=${to}`);
    return { sent: 1, failed: 0 };
  } catch (err) {
    console.error(
      `[ws-email] test send failed workspace=${workspaceId} to=${to}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { sent: 0, failed: 1 };
  }
}
