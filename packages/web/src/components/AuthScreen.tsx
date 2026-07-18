import { useState } from 'react';
import type { AuthResponse } from '@mychat/shared';
import { api } from '../lib/api';

export default function AuthScreen({ onSignedIn }: { onSignedIn: (r: AuthResponse) => void }) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const resp =
        mode === 'signin'
          ? await api<AuthResponse>('POST', '/v1/auth/login', { email, password })
          : await api<AuthResponse>('POST', '/v1/auth/register', { email, password, displayName });
      onSignedIn(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-gray-50">
      <form onSubmit={submit} className="w-80 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-900">MyChat</h1>
        <div className="mb-4 flex justify-center gap-2 text-sm" data-testid="auth-mode">
          <button
            type="button"
            className={mode === 'signin' ? 'font-semibold text-blue-600' : 'text-gray-500'}
            onClick={() => setMode('signin')}
          >
            Sign In
          </button>
          <span className="text-gray-300">·</span>
          <button
            type="button"
            className={mode === 'register' ? 'font-semibold text-blue-600' : 'text-gray-500'}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>
        {mode === 'register' && (
          <input
            data-testid="auth-displayName"
            className="mb-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}
        <input
          data-testid="auth-email"
          className="mb-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          data-testid="auth-password"
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          data-testid="auth-submit"
          className="w-full rounded bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={busy || !email || !password || (mode === 'register' && !displayName)}
        >
          {mode === 'signin' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
    </div>
  );
}
