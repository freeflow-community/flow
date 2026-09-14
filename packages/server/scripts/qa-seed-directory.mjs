#!/usr/bin/env node
// QA fixtures for the Directory (#432 — macOS/iOS parity with web's #430).
//
// Builds a workspace whose roster exercises every case a Directory card has:
// an owner, an admin, plain members, people with and without a status, an
// email whose local part is nothing like the display name (so search-by-email
// is actually testable), and two real agents — joined the real way
// (agent-invite → /v1/agents/redeem), so they carry genuine synthetic
// `agent-<uuid>@agents.flow.local` addresses and a real sponsor, rather than
// rows hand-written to look like agents.
//
// Usage: API=http://127.0.0.1:8799 node scripts/qa-seed-directory.mjs

const API = process.env.API ?? 'http://127.0.0.1:8787';
const PASSWORD = 'qa-password-1';
const SLUG = process.env.SLUG ?? 'directory-432';

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

/** Register, or log back in if this seed has already run. */
async function account(email, displayName) {
  try {
    return await api('POST', '/v1/auth/register', null, {
      email,
      password: PASSWORD,
      displayName,
      autoVerify: true,
    });
  } catch {
    return api('POST', '/v1/auth/login', null, { email, password: PASSWORD });
  }
}

// Titles (#434) are deliberately not universal: half the roster has one, so a
// card with no title can be seen to draw no line at all rather than a blank
// one. One is at the 80-char limit, to show truncation on a real card.
const PEOPLE = [
  // [email, display name, status emoji, status text, role, title]
  ['ada@example.com', 'Ada Lovelace', '🎧', 'Heads down on the compiler', 'admin', 'Founder, Analytical Engines'],
  ['scottp@biztrip.ai', 'Scott Persinger', '', '', 'member', 'Founder, Biztrip AI'],
  ['alan@example.com', 'Alan Turing', '🍵', 'Back in 10', 'member', 'Principal Engineer, Cryptanalysis'],
  ['grace@example.com', 'Grace Hopper', '', '', 'admin', ''],
  ['katherine@example.com', 'Katherine Johnson', '🚀', 'Shipping', 'member',
    'Staff Research Mathematician, Orbital Mechanics and Flight Trajectory Group'],
  ['margaret@example.com', 'Margaret Hamilton', '', '', 'member', 'Director of Software Engineering'],
  ['barbara@example.com', 'Barbara Liskov', '📅', 'In a meeting', 'member', ''],
  ['radia@example.com', 'Radia Perlman', '', '', 'member', ''],
  ['zoe@example.com', 'zoe quinn', '🌴', 'On holiday until Monday', 'member', ''],
];

const AGENTS = [
  // An agent with a title keeps its "Sponsored by" line — the title adds a
  // line, it does not replace the attribution (#434).
  ['prism', 'Prism', 'Plans and dispatches the factory’s work', 'Planner'],
  ['builder', 'Builder', 'Writes the code and opens the PRs', ''],
];

const main = async () => {
  // The owner. Everyone else is invited in, so roles are real memberships.
  const owner = await account('qa-directory@example.com', 'Marie Curie');
  let workspace = (await api('GET', '/v1/me/workspaces', owner.token)).workspaces.find(
    (w) => w.slug === SLUG,
  );
  if (!workspace) {
    workspace = await api('POST', '/v1/workspaces', owner.token, { name: 'Directory QA', slug: SLUG });
  }
  await api('PATCH', '/v1/me', owner.token, { statusEmoji: '📝', statusText: 'Writing it up' });
  await api('PATCH', '/v1/me', owner.token, { title: 'Owner, Directory QA' });

  for (const [email, displayName, emoji, text, role, title] of PEOPLE) {
    const person = await account(email, displayName);
    // createInvite returns the raw token only as the tail of inviteUrl.
    const invite = await api('POST', `/v1/workspaces/${workspace.id}/invites`, owner.token, {
      email,
    }).catch(() => null); // 409 already_member on a re-run
    if (invite) {
      const token = invite.inviteUrl.split('/').pop();
      await api('POST', '/v1/invites/accept', person.token, { token });
    }
    if (emoji) await api('PATCH', '/v1/me', person.token, { statusEmoji: emoji, statusText: text });
    await api('PATCH', '/v1/me', person.token, { title });
    if (role !== 'member') {
      const members = (await api('GET', `/v1/workspaces/${workspace.id}/members`, owner.token)).members;
      const m = members.find((x) => x.email === email);
      if (m) {
        await api('PATCH', `/v1/workspaces/${workspace.id}/members/${m.userId}/role`, owner.token, {
          role,
        }).catch(() => {});
      }
    }
  }

  // Agents join the real way, so their synthetic address and sponsor are real.
  const roster = (await api('GET', `/v1/workspaces/${workspace.id}/members`, owner.token)).members;
  for (const [username, name, description, title] of AGENTS) {
    let agent = roster.find((m) => m.displayName === name);
    if (!agent) {
      const invite = await api('POST', `/v1/workspaces/${workspace.id}/agent-invites`, owner.token, {});
      const redeemed = await api('POST', '/v1/agents/redeem', null, {
        code: invite.code,
        username: `${username}-432`,
        key: `qa-directory-key-${username}-0000`,
        name,
        description,
      });
      agent = { userId: redeemed.user?.id, token: redeemed.token };
    }
    if (title && agent.token) await api('PATCH', '/v1/me', agent.token, { title });
  }

  const members = (await api('GET', `/v1/workspaces/${workspace.id}/members`, owner.token)).members;
  console.log(`workspace ${workspace.slug} (${workspace.id}) — ${members.length} members`);
  for (const m of members) {
    console.log(
      `  ${m.displayName.padEnd(20)} ${m.role.padEnd(7)} ${m.isAgent ? 'agent ' : '      '}` +
        `${m.email.padEnd(36)} ${m.title || '—'}`,
    );
  }
  console.log(`\nSign in as qa-directory@example.com / ${PASSWORD}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
