import { useEffect, useState } from 'react';
import type { AuthResponse, RegisterPendingResponse } from '@flow/shared';
import { api } from '../lib/api';

type Mode =
  | 'signin'
  | 'register'
  | 'forgot'
  | 'signup-sent'
  | 'reset-sent'
  | 'complete'
  | 'reset'
  | 'link-sent'
  | 'signin-link';

const inputCls = 'mb-2 w-full rounded border border-hairline2 px-3 py-2 text-sm';
const submitCls =
  'w-full rounded bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50';

export default function AuthScreen({
  onSignedIn,
  signupToken,
  resetToken,
  signinToken,
}: {
  onSignedIn: (r: AuthResponse) => void;
  signupToken?: string | null;
  resetToken?: string | null;
  signinToken?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(
    signinToken ? 'signin-link' : signupToken ? 'complete' : resetToken ? 'reset' : 'signin',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const submitAuth = (e: React.FormEvent) =>
    void run(async () => {
      e.preventDefault();
      if (mode === 'signin') {
        onSignedIn(await api<AuthResponse>('POST', '/v1/auth/login', { email, password }));
      } else {
        // Email-first: the account (name + password) is created from the
        // emailed link, never from this form.
        await api<RegisterPendingResponse>('POST', '/v1/auth/register', { email });
        setMode('signup-sent');
      }
    });

  const resendSignup = () =>
    void run(async () => {
      await api('POST', '/v1/auth/register', { email });
      setInfo('Email sent.');
    });

  const submitComplete = (e: React.FormEvent) =>
    void run(async () => {
      e.preventDefault();
      onSignedIn(
        await api<AuthResponse>('POST', '/v1/auth/register/complete', {
          token: signupToken,
          displayName,
          password,
        }),
      );
    });

  const submitForgot = (e: React.FormEvent) =>
    void run(async () => {
      e.preventDefault();
      await api('POST', '/v1/auth/password/forgot', { email });
      setMode('reset-sent');
    });

  const submitReset = (e: React.FormEvent) =>
    void run(async () => {
      e.preventDefault();
      onSignedIn(await api<AuthResponse>('POST', '/v1/auth/password/reset', { token: resetToken, password }));
    });

  const sendSigninLink = () =>
    void run(async () => {
      await api('POST', '/v1/auth/signin-link', { email });
      setMode('link-sent');
    });

  // A ?signin= link redeems automatically on mount, then signs the user in.
  useEffect(() => {
    if (!signinToken) return;
    void run(async () => {
      onSignedIn(await api<AuthResponse>('POST', '/v1/auth/signin-link/consume', { token: signinToken }));
    });
    // onSignedIn is stable (useCallback); signinToken never changes after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signinToken]);

  const backToSignIn = (
    <button type="button" className="mt-3 w-full text-center text-sm text-muted hover:text-ink" onClick={() => setMode('signin')}>
      Back to sign in
    </button>
  );

  let body: React.ReactNode;
  if (mode === 'signup-sent') {
    body = (
      <div data-testid="auth-signup-sent">
        <h2 className="mb-2 text-center text-lg font-semibold text-ink">Check your email</h2>
        <p className="mb-3 text-center text-sm text-muted">
          We sent a link to <span className="font-semibold text-ink">{email}</span>. Click it to finish creating your
          account.
        </p>
        {info && <p className="mb-2 text-center text-sm text-accent-soft">{info}</p>}
        {error && <p className="mb-2 text-center text-sm text-red-600">{error}</p>}
        <button type="button" data-testid="auth-resend" className={submitCls} disabled={busy || !email} onClick={resendSignup}>
          Resend email
        </button>
        {backToSignIn}
      </div>
    );
  } else if (mode === 'complete') {
    body = (
      <form onSubmit={submitComplete} data-testid="auth-complete">
        <h2 className="mb-1 text-center text-lg font-semibold text-ink">Finish your account</h2>
        <p className="mb-3 text-center text-sm text-muted">Your email is confirmed — choose a name and password.</p>
        <input
          data-testid="auth-displayName"
          className={inputCls}
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          data-testid="auth-password"
          className="mb-3 w-full rounded border border-hairline2 px-3 py-2 text-sm"
          placeholder="Password (min 8 characters)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="mb-2 text-sm text-red-600">
            {error}{' '}
            <button type="button" className="underline" onClick={() => setMode('register')}>
              Register again
            </button>
          </p>
        )}
        <button data-testid="auth-submit" className={submitCls} disabled={busy || !displayName || password.length < 8}>
          Create account
        </button>
      </form>
    );
  } else if (mode === 'reset-sent') {
    body = (
      <div data-testid="auth-reset-sent">
        <h2 className="mb-2 text-center text-lg font-semibold text-ink">Check your email</h2>
        <p className="mb-3 text-center text-sm text-muted">
          If <span className="font-semibold text-ink">{email}</span> has an account, we sent it a password-reset link.
        </p>
        {backToSignIn}
      </div>
    );
  } else if (mode === 'forgot') {
    body = (
      <form onSubmit={submitForgot} data-testid="auth-forgot">
        <h2 className="mb-2 text-center text-lg font-semibold text-ink">Reset your password</h2>
        <input
          data-testid="auth-email"
          className={inputCls}
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button data-testid="auth-submit" className={submitCls} disabled={busy || !email}>
          Send reset link
        </button>
        {backToSignIn}
      </form>
    );
  } else if (mode === 'reset') {
    body = (
      <form onSubmit={submitReset} data-testid="auth-reset">
        <h2 className="mb-2 text-center text-lg font-semibold text-ink">Choose a new password</h2>
        <input
          data-testid="auth-password"
          className="mb-3 w-full rounded border border-hairline2 px-3 py-2 text-sm"
          placeholder="New password (min 8 characters)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="mb-2 text-sm text-red-600">
            {error}{' '}
            <button type="button" className="underline" onClick={() => setMode('forgot')}>
              Request a new link
            </button>
          </p>
        )}
        <button data-testid="auth-submit" className={submitCls} disabled={busy || password.length < 8}>
          Set password &amp; sign in
        </button>
      </form>
    );
  } else if (mode === 'link-sent') {
    body = (
      <div data-testid="auth-link-sent">
        <h2 className="mb-2 text-center text-lg font-semibold text-ink">Check your email</h2>
        <p className="mb-3 text-center text-sm text-muted">
          If <span className="font-semibold text-ink">{email}</span> has an account, we sent it a sign-in link. Click it
          to sign in — no password needed.
        </p>
        {backToSignIn}
      </div>
    );
  } else if (mode === 'signin-link') {
    body = (
      <div data-testid="auth-signin-link">
        <h2 className="mb-2 text-center text-lg font-semibold text-ink">
          {error ? 'Sign-in link problem' : 'Signing you in…'}
        </h2>
        {error ? (
          <>
            <p className="mb-3 text-center text-sm text-red-600">{error}</p>
            {backToSignIn}
          </>
        ) : (
          <p className="text-center text-sm text-muted">One moment while we verify your link.</p>
        )}
      </div>
    );
  } else {
    const isRegister = mode === 'register';
    body = (
      <form onSubmit={submitAuth}>
        <div className="mb-4 flex justify-center gap-2 text-sm" data-testid="auth-mode">
          <button
            type="button"
            className={!isRegister ? 'font-semibold text-accent-soft' : 'text-muted'}
            onClick={() => setMode('signin')}
          >
            Sign In
          </button>
          <span className="text-faint">·</span>
          <button
            type="button"
            className={isRegister ? 'font-semibold text-accent-soft' : 'text-muted'}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>
        {isRegister && (
          <p className="mb-3 text-center text-sm text-muted">
            Enter your email and we&apos;ll send you a link to set up your account.
          </p>
        )}
        <input
          data-testid="auth-email"
          className={inputCls}
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {!isRegister && (
          <>
            <input
              data-testid="auth-password"
              className="mb-1 w-full rounded border border-hairline2 px-3 py-2 text-sm"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              data-testid="auth-forgot-link"
              className="mb-2 text-xs text-muted hover:text-ink"
              onClick={() => setMode('forgot')}
            >
              Forgot password?
            </button>
          </>
        )}
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          data-testid="auth-submit"
          className={submitCls}
          disabled={busy || !email || (!isRegister && !password)}
        >
          {isRegister ? 'Send me a link' : 'Sign In'}
        </button>
        {!isRegister && (
          <>
            <div className="my-3 flex items-center gap-2 text-xs text-faint">
              <span className="h-px flex-1 bg-hairline2" />
              or
              <span className="h-px flex-1 bg-hairline2" />
            </div>
            <button
              type="button"
              data-testid="auth-signin-link-btn"
              className="w-full rounded border border-hairline2 py-2 text-sm font-semibold text-ink hover:bg-base disabled:opacity-50"
              disabled={busy || !email}
              onClick={sendSigninLink}
            >
              Email me a sign-in link
            </button>
          </>
        )}
      </form>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-base">
      <div className="w-80 rounded-xl border border-hairline bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-ink">Flow</h1>
        {body}
      </div>
    </div>
  );
}
