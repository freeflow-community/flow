import { describe, expect, it } from 'vitest';
import type { WorkspaceMemberDTO } from '@flow/shared';
import { memberLine } from '../src/mcp-server.js';

const member = (over: Partial<WorkspaceMemberDTO> = {}): WorkspaceMemberDTO => ({
  userId: '019f7d15-4106-7c1a-9f8e-64bae430b447',
  displayName: 'Scott Persinger',
  email: 'scott@example.com',
  avatarUrl: null,
  statusEmoji: '',
  statusText: '',
  isAgent: false,
  sponsorId: null,
  role: 'member',
  joinedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('memberLine', () => {
  it('carries the email so agents can reach people outside Flow (#488)', () => {
    expect(memberLine(member())).toBe(
      '019f7d15-4106-7c1a-9f8e-64bae430b447  Scott Persinger  scott@example.com  [member]',
    );
  });

  it('keeps the agent marker, status and synthetic address as-is', () => {
    const line = memberLine(
      member({
        userId: '01a0308c-cd76-7b2a-8d3b-a3709d935575',
        displayName: 'Prism',
        email: 'agent-prism@agents.flow.local',
        isAgent: true,
        statusText: 'reviewing PRs',
        role: 'admin',
      }),
    );
    expect(line).toBe(
      '01a0308c-cd76-7b2a-8d3b-a3709d935575  Prism 🤖  agent-prism@agents.flow.local  [admin] — reviewing PRs',
    );
  });
});
