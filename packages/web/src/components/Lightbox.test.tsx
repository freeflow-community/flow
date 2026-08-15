import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LightboxButton, LightboxShell } from './Lightbox';

// The shell is shared by the image, video and diagram overlays (#232). What it
// guarantees every caller is a close button and a stable root test id; what it
// leaves to the caller is every other action, because those depend on what is
// behind the overlay.
describe('LightboxShell', () => {
  const render = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

  it('always gives a close button, derived from the root test id', () => {
    const html = render(
      <LightboxShell testId="lightbox" onClose={() => {}}>
        <img alt="" />
      </LightboxShell>,
    );
    expect(html).toContain('data-testid="lightbox"');
    expect(html).toContain('data-testid="lightbox-close"');
  });

  it('renders caller actions alongside close', () => {
    const html = render(
      <LightboxShell
        testId="video-lightbox"
        onClose={() => {}}
        actions={
          <LightboxButton testId="video-lightbox-download" title="Download" onClick={() => {}}>
            ⤓
          </LightboxButton>
        }
      >
        <video />
      </LightboxShell>,
    );
    expect(html).toContain('data-testid="video-lightbox-download"');
    expect(html).toContain('data-testid="video-lightbox-close"');
  });

  it('omits the caption line when there is nothing to caption', () => {
    const withName = render(
      <LightboxShell testId="lightbox" onClose={() => {}} caption="graph.png">
        <img alt="" />
      </LightboxShell>,
    );
    const without = render(
      <LightboxShell testId="mermaid-lightbox" onClose={() => {}}>
        <iframe />
      </LightboxShell>,
    );
    expect(withName).toContain('graph.png');
    expect(without).not.toContain('mt-3 max-w-[80vw]');
  });
});
