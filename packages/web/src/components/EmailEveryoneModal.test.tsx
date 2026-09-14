// Community email composer (#481): the wording rules the modal owns. The
// rendering and sending halves are network-bound (recipient count, preview
// HTML, the send itself all come from the server), so what is worth pinning
// here is the copy that has to stay right — a "1 person" that reads "1 people"
// in front of the whole community is exactly the kind of thing nobody catches
// until it has already been mailed.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import {
  ComposeActions,
  ConfirmStep,
  imagePasteErrorText,
  peopleLabel,
  resultToastText,
  testResultText,
} from './EmailEveryoneModal';

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

describe('ComposeActions (#486)', () => {
  const render = (ready = true) =>
    renderToStaticMarkup(<ComposeActions ready={ready} onCancel={() => {}} onReview={() => {}} />);

  it('promises the review step rather than a send', () => {
    const html = render();
    expect(html).toContain('Review &amp; send');
    // the wording that scared admins off clicking: it described the next step's button
    expect(html).not.toMatch(/Send to \d/);
    expect(html).not.toContain('Send now');
  });

  it('stays the accent primary, and stays disabled until there is something to send', () => {
    expect(render()).toMatch(/data-testid="email-everyone-send"[^>]*class="[^"]*bg-accent/);
    expect(render(false)).toMatch(/data-testid="email-everyone-send"[^>]*disabled/);
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

describe('imagePasteErrorText (#492)', () => {
  it('turns the server cap into a number a person can act on', () => {
    const err = new ApiError(400, 'image_too_large', 'email images are limited to 5242880 bytes');
    // Not the server's wording: "5242880 bytes" is a fact about the API, not
    // advice to someone holding a screenshot.
    expect(imagePasteErrorText(err)).toBe('That image is too large to email — the limit is 5 MB.');
  });

  it('says what to do about an unsupported type', () => {
    const err = new ApiError(400, 'unsupported_image', "image/svg+xml can't be embedded in an email");
    expect(imagePasteErrorText(err)).toContain('PNG or JPEG');
  });

  it('never goes silent on an unexpected failure', () => {
    // A dropped connection mid-upload still has to say something: the
    // placeholder has just been pulled out of the body, and a body that
    // silently lost an image is the failure mode worth ruling out.
    expect(imagePasteErrorText(new Error('network'))).toBe('Couldn’t upload that image. Try again.');
    expect(imagePasteErrorText(undefined)).toBe('Couldn’t upload that image. Try again.');
  });
});

describe('ConfirmStep shows the mail (#492)', () => {
  const render = (over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ConfirmStep
        count={48}
        workspaceName="Locked In"
        sending={false}
        testing={false}
        onBack={() => {}}
        onSend={() => {}}
        onSendTest={() => {}}
        {...over}
      />,
    );

  it('renders the server HTML, images and all, so the last look is at the real thing', () => {
    const html = render({ previewHtml: '<p>Hi</p><img src="https://flow.test/v1/email-images/abc" alt="Pasted image"/>' });
    expect(html).toContain('src="https://flow.test/v1/email-images/abc"');
  });

  it('says it is still rendering rather than showing a stale document', () => {
    // A previous render sitting under a "Send now" button would be a lie about
    // what is going to be mailed.
    expect(render({ previewHtml: null })).toContain('Rendering…');
    expect(render()).toContain('Rendering…');
  });
});
