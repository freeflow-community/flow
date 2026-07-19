import { useState } from 'react';
import type { AuthResponse, RegisterResponse } from '@flow/shared';
import { api, ApiError } from '../lib/api';

type Mode = 'signin' | 'register' | 'forgot' | 'verify-sent' | 'reset-sent' | 'reset';

const inputCls = 'mb-2 w-full rounded border border-hairline2 px-3 py-2 text-sm';
const submitCls =
  'w-full rounded bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50';

export default function AuthScreen({
  onSignedIn,
  notice,
  resetToken,
}: {
  onSignedIn: (r: AuthResponse) => void;
  notice?: string | null;
  resetToken?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'signin');
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
        try {
          onSignedIn(await api<AuthResponse>('POST', '/v1/auth/login', { email, password }));
        } catch (err) {
          if (err instanceof ApiError && err.code === 'email_not_verified') {
            setMode('verify-sent');
            return;
          }
          throw err;
        }
      } else {
        const resp = await api<RegisterResponse>('POST', '/v1/auth/register', { email, password, displayName });
        if ('requiresVerification' in resp) setMode('verify-sent');
        else onSignedIn(resp);
      }
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

  const resendVerify = () =>
    void run(async () => {
      await api('POST', '/v1/auth/verify-email/resend', { email });
      setInfo('Verification email sent.');
    });

  const backToSignIn = (
    <button type="button" className="mt-3 w-full text-center text-sm text-muted hover:text-ink" onClick={() => setMode('signin')}>
      Back to sign in
    </button>
  );

  let body: React.ReactNode;
  if (mode === 'verify-sent') {
    body = (
      <div data-testid="auth-verify-sent">
        <h2 className="mb-2 text-center text-lg font-semibold text-ink">Check your email</h2>
        <p className="mb-3 text-center text-sm text-muted">
          We sent a verification link to <span className="font-semibold text-ink">{email}</span>. Click it to finish
          signing in.
        </p>
        {info && <p className="mb-2 text-center text-sm text-accent-soft">{info}</p>}
        {error && <p className="mb-2 text-center text-sm text-red-600">{error}</p>}
        <button type="button" data-testid="auth-resend" className={submitCls} disabled={busy || !email} onClick={resendVerify}>
          Resend email
        </button>
        {backToSignIn}
      </div>
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
  } else {
    body = (
      <form onSubmit={submitAuth}>
        <div className="mb-4 flex justify-center gap-2 text-sm" data-testid="auth-mode">
          <button
            type="button"
            className={mode === 'signin' ? 'font-semibold text-accent-soft' : 'text-muted'}
            onClick={() => setMode('signin')}
          >
            Sign In
          </button>
          <span className="text-faint">·</span>
          <button
            type="button"
            className={mode === 'register' ? 'font-semibold text-accent-soft' : 'text-muted'}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>
        {mode === 'register' && (
          <input
            data-testid="auth-displayName"
            className={inputCls}
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}
        <input
          data-testid="auth-email"
          className={inputCls}
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          data-testid="auth-password"
          className="mb-1 w-full rounded border border-hairline2 px-3 py-2 text-sm"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'signin' && (
          <button
            type="button"
            data-testid="auth-forgot-link"
            className="mb-2 text-xs text-muted hover:text-ink"
            onClick={() => setMode('forgot')}
          >
            Forgot password?
          </button>
        )}
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          data-testid="auth-submit"
          className={submitCls}
          disabled={busy || !email || !password || (mode === 'register' && !displayName)}
        >
          {mode === 'signin' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-base">
      <div className="w-80 rounded-xl border border-hairline bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-ink">Flow</h1>
        {notice && mode === 'signin' && <p className="mb-3 text-center text-sm text-red-600">{notice}</p>}
        {body}
      </div>
    </div>
  );
}
