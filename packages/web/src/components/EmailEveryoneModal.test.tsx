// Community email composer (#481): the wording rules the modal owns. The
// rendering and sending halves are network-bound (recipient count, preview
// HTML, the send itself all come from the server), so what is worth pinning
// here is the copy that has to stay right — a "1 person" that reads "1 people"
// in front of the whole community is exactly the kind of thing nobody catches
// until it has already been mailed.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmStep, peopleLabel, resultToastText, testResultText } from './EmailEveryoneModal';

describe('peopleLabel', () => {
  it('singularizes one and pluralizes everything else', () => {
    expect(peopleLabel(1)).toBe('1 person');
    expect(peopleLabel(0)).toBe('0 people');
    expect(peopleLabel(42)).toBe('42 people');
  });
});

describe('resultToastText', () => {
  it('stays quiet about failures when there were none', () => {
    expect(resultToastText({ sent: 42, failed: 0 })).toBe('Sent to 42 people');
    expect(resultToastText({ sent: 1, failed: 0 })).toBe('Sent to 1 person');
  });

  it('names the failures when there were any', () => {
    expect(resultToastText({ sent: 41, failed: 1 })).toBe('Sent to 41, failed for 1');
    expect(resultToastText({ sent: 0, failed: 3 })).toBe('Sent to 0, failed for 3');
  });
});

describe('testResultText (#484)', () => {
  it('names the inbox to go and look in', () => {
    expect(testResultText({ sent: 1, failed: 0 }, 'olivia@example.com')).toBe('Test sent to olivia@example.com');
  });

  it('falls back to "you" when the address is not loaded yet', () => {
    expect(testResultText({ sent: 1, failed: 0 }, undefined)).toBe('Test sent to you');
  });

  it('reports a bounce rather than claiming a send', () => {
    expect(testResultText({ sent: 0, failed: 1 }, 'olivia@example.com')).toBe(
      'Test send failed — the address bounced.',
    );
  });
});

describe('ConfirmStep (#484)', () => {
  const render = (over: Partial<Parameters<typeof ConfirmStep>[0]> = {}) =>
    renderToStaticMarkup(
      <ConfirmStep
        count={42}
        workspaceName="Locked In"
        sending={false}
        testing={false}
        onBack={() => {}}
        onSend={() => {}}
        onSendTest={() => {}}
        {...over}
      />,
    );

  it('offers a test send alongside the real one', () => {
    const html = render();
    expect(html).toContain('Send test to me');
    expect(html).toContain('Send now');
    // the real send stays the primary action; the test is secondary
    expect(html).toMatch(/data-testid="email-everyone-send-test"[^>]*class="[^"]*border-hairline2/);
    expect(html).toMatch(/data-testid="email-everyone-confirm-send"[^>]*class="[^"]*bg-accent/);
  });

  it('shows progress on the test button and locks the real send while it runs', () => {
    const html = render({ testing: true });
    expect(html).toContain('Sending test…');
    expect(html).toMatch(/data-testid="email-everyone-confirm-send"[^>]*disabled/);
  });
});
