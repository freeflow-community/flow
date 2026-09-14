// Mini apps on the web (issue #371): the mint-before-open decision the
// co-browsing mini-browser makes when it opens a link artifact, and how a
// minted token is attached to the app's url.
//
// The behaviour these cover — an app mints before anything loads, a plain link
// is untouched, a failed mint never reaches the app's tunnel, and the token
// never lands in the shared url — is the whole of the issue's acceptance list
// that can be checked without a browser. The rest was verified by hand against
// a real tunnelled guard (see the PR).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { framedAppsBlocked, mintErrorMessage, planFrame, withAppToken } from './ArtifactView';

describe('planFrame', () => {
  it('frames a plain link artifact directly — no mint', () => {
    expect(planFrame('https://example.com/', false, false)).toEqual({
      kind: 'ready',
      src: 'https://example.com/',
    });
  });

  it('mints before loading an app', () => {
    expect(planFrame('https://app.example.com/', true, false)).toEqual({ kind: 'mint' });
  });

  it('sends an app to a real tab where a framed cookie would be refused', () => {
    expect(planFrame('https://app.example.com/', true, true)).toEqual({ kind: 'needs-new-tab' });
  });

  it('leaves a plain link framed even where app cookies are blocked', () => {
    // The block only concerns the guard's session cookie, so an ordinary page
    // must not change behaviour on Safari.
    expect(planFrame('https://example.com/', false, true)).toEqual({
      kind: 'ready',
      src: 'https://example.com/',
    });
  });

  it('shows nothing for an artifact with no url', () => {
    expect(planFrame('', true, false)).toEqual({ kind: 'idle' });
  });
});

describe('withAppToken', () => {
  it('appends the token as a query parameter', () => {
    expect(withAppToken('https://app.example.com/', 'abc.def')).toBe(
      'https://app.example.com/?flow_token=abc.def',
    );
  });

  it('keeps an existing query and hash intact', () => {
    expect(withAppToken('https://app.example.com/board?view=week#today', 'tok')).toBe(
      'https://app.example.com/board?view=week&flow_token=tok#today',
    );
  });

  it('replaces a stale token rather than appending a second one', () => {
    const once = withAppToken('https://app.example.com/', 'old');
    expect(withAppToken(once, 'new')).toBe('https://app.example.com/?flow_token=new');
  });

  it('url-encodes a token into an unparseable url', () => {
    expect(withAppToken('not a url', 'a+b/c')).toBe('not a url?flow_token=a%2Bb%2Fc');
  });

  it('does not mutate the shared url it was given', () => {
    const shared = 'https://app.example.com/board';
    withAppToken(shared, 'tok');
    expect(shared).toBe('https://app.example.com/board');
  });
});

describe('framedAppsBlocked', () => {
  // Measured against Safari 26.4 and a real tunnelled guard: WebKit neither
  // stores the guard's SameSite=None cookie in a frame nor sends one already
  // established first-party, so the frame always lands on the guard's 401.
  it('is true on WebKit', () => {
    expect(framedAppsBlocked('Apple Computer, Inc.')).toBe(true);
  });

  it('is false elsewhere', () => {
    expect(framedAppsBlocked('Google Inc.')).toBe(false); // Chrome, Edge
    expect(framedAppsBlocked('')).toBe(false); // Firefox
  });
});

describe('mintErrorMessage', () => {
  it('explains a lost membership rather than echoing the server', () => {
    expect(mintErrorMessage(new ApiError(403, 'forbidden', 'not a member'))).toBe(
      'You no longer have access to this app.',
    );
    expect(mintErrorMessage(new ApiError(404, 'not_found', 'artifact not found'))).toBe(
      'You no longer have access to this app.',
    );
  });

  it('passes other server errors through', () => {
    expect(mintErrorMessage(new ApiError(400, 'not_an_app', 'artifact is not an app'))).toBe(
      'artifact is not an app',
    );
  });

  it('names the network as the problem when the request never landed', () => {
    expect(mintErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Couldn’t reach Flow to open this app.',
    );
  });
});
