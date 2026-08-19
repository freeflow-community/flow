import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UserDTO } from '@flow/shared';

import NativeSignIn from './NativeSignIn';

const user = { id: 'u1', email: 'someone@example.com', displayName: 'Someone' } as UserDTO;

// #279: arriving with a live web session used to hand off silently, signing the
// app in as whoever the browser held. The session may now only be offered.
describe('NativeSignIn', () => {
  it('offers the existing session instead of handing off automatically', () => {
    const html = renderToStaticMarkup(<NativeSignIn user={user} />);
    expect(html).toContain('Continue as someone@example.com');
    expect(html).toContain('or pick another account');
    expect(html).not.toContain('Signing you in');
  });

  it('asks Google when there is no session', () => {
    const html = renderToStaticMarkup(<NativeSignIn user={null} />);
    expect(html).not.toContain('Continue as');
    expect(html).toContain('Sign in with Google');
  });

  it('keeps the escape hatch off the sign-in screen', () => {
    expect(renderToStaticMarkup(<NativeSignIn user={null} />)).not.toContain('Not you?');
  });
});
