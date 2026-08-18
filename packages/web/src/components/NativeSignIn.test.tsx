import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NativeSignIn from './NativeSignIn';

// #279: arriving with a live web session hands off silently, so the only way
// to sign in as somebody else is an explicit escape on every later phase.
describe('NativeSignIn', () => {
  it('offers a way out when it is handing off an existing session', () => {
    const html = renderToStaticMarkup(<NativeSignIn signedIn />);
    expect(html).toContain('Not you? Use a different account');
  });

  it('does not offer it on the sign-in screen itself', () => {
    const html = renderToStaticMarkup(<NativeSignIn signedIn={false} />);
    expect(html).not.toContain('Not you?');
    expect(html).toContain('Sign in with Google');
  });
});
