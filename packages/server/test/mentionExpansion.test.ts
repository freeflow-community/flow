// Server-side @-mention expansion for API-posted messages (issue #415).
// Pure function — no database.
import { describe, expect, it } from 'vitest';
import { expandMentions } from '../src/lib/mentionExpansion.js';

const PRISM = '11111111-1111-4111-8111-111111111111';
const SCOTT = '22222222-2222-4222-8222-222222222222';
const SCOTT_B = '33333333-3333-4333-8333-333333333333';
const ADA = '44444444-4444-4444-8444-444444444444';

const members = [
  { id: PRISM, displayName: 'Prism' },
  { id: SCOTT, displayName: 'Scott Persinger' },
  { id: ADA, displayName: 'Ada' },
];

describe('expandMentions', () => {
  it('rewrites a simple name to the canonical token', () => {
    const r = expandMentions('hey @Prism can you look?', members);
    expect(r.text).toBe(`hey <@${PRISM}> can you look?`);
    expect(r.userIds).toEqual([PRISM]);
  });

  it('matches a multi-word display name greedily, as one mention', () => {
    const r = expandMentions('ping @Scott Persinger about it', members);
    expect(r.text).toBe(`ping <@${SCOTT}> about it`);
    expect(r.userIds).toEqual([SCOTT]);
  });

  it('is case-insensitive', () => {
    expect(expandMentions('@prism @SCOTT PERSINGER', members).text).toBe(`<@${PRISM}> <@${SCOTT}>`);
  });

  it('leaves unknown names alone', () => {
    const r = expandMentions('@nobody here and @Prismatic too', members);
    expect(r.text).toBe('@nobody here and @Prismatic too');
    expect(r.userIds).toEqual([]);
  });

  it('leaves an ambiguous name alone rather than guessing', () => {
    const ambiguous = [...members, { id: SCOTT_B, displayName: 'scott persinger' }];
    const r = expandMentions('@Scott Persinger ping', ambiguous);
    expect(r.text).toBe('@Scott Persinger ping');
    expect(r.userIds).toEqual([]);
  });

  it('prefers the longer name when a shorter one also matches', () => {
    const overlapping = [...members, { id: SCOTT_B, displayName: 'Scott' }];
    expect(expandMentions('@Scott Persinger', overlapping).text).toBe(`<@${SCOTT}>`);
    expect(expandMentions('@Scott alone', overlapping).text).toBe(`<@${SCOTT_B}> alone`);
  });

  it('does not expand inside an inline code span', () => {
    const r = expandMentions('use `@Prism` literally, but ping @Ada', members);
    expect(r.text).toBe(`use \`@Prism\` literally, but ping <@${ADA}>`);
    expect(r.userIds).toEqual([ADA]);
  });

  it('does not expand inside a fenced code block', () => {
    const body = ['before @Ada', '```', 'send("@Prism")', '```', 'after @Prism'].join('\n');
    const r = expandMentions(body, members);
    expect(r.text).toBe(
      ['before <@' + ADA + '>', '```', 'send("@Prism")', '```', 'after <@' + PRISM + '>'].join('\n'),
    );
    expect(r.userIds).toEqual([ADA, PRISM]);
  });

  it('leaves existing <@userId> tokens untouched', () => {
    const r = expandMentions(`<@${PRISM}> and @Ada`, members);
    expect(r.text).toBe(`<@${PRISM}> and <@${ADA}>`);
    expect(r.userIds).toEqual([ADA]);
  });

  it('leaves group tokens and email addresses alone', () => {
    const r = expandMentions('<!here> mail scott@Ada.com', members);
    expect(r.text).toBe('<!here> mail scott@Ada.com');
    expect(r.userIds).toEqual([]);
  });

  it('reports each resolved user once', () => {
    const r = expandMentions('@Ada @ada @Ada', members);
    expect(r.userIds).toEqual([ADA]);
  });

  it('is a no-op with no members and on text without mentions', () => {
    expect(expandMentions('@Prism', []).text).toBe('@Prism');
    expect(expandMentions('nothing to see', members).text).toBe('nothing to see');
  });

  it('handles an unterminated backtick as ordinary text', () => {
    expect(expandMentions('` @Ada', members).text).toBe(`\` <@${ADA}>`);
  });
});
