/**
 * LoginPage.tsx
 *
 * Full-screen password gate shown when auth is enabled and the stored token
 * is missing or expired. On success the token is written to localStorage and
 * the page reloads so the WS hook picks up the new token.
 */

import React, { useState } from 'react';
import { T } from '../theme.js';
import { Btn, Input, Label } from '../ui.js';

interface Props {
  onLogin: (token: string) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        const { token } = await res.json() as { token: string };
        localStorage.setItem('lites_token', token);
        onLogin(token);
      } else {
        setError('Incorrect password.');
        setPassword('');
      }
    } catch {
      setError('Could not reach server. Is it running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: T.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: T.font,
      }}
    >
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: T.radius,
          padding: '36px 40px',
          width: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
        }}
      >
        {/* Logo / title */}
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: T.accent, letterSpacing: '-0.03em' }}>
            lites
          </div>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 4 }}>
            DMX Controller — Admin Access
          </div>
        </div>

        {/* Password field */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label as="label">Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hasError={!!error}
            autoFocus
            style={{ fontSize: 14, padding: '9px 12px', width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{ fontSize: 12, color: T.danger, textAlign: 'center' }}>{error}</div>
        )}

        {/* Submit */}
        <Btn
          type="submit"
          variant="primary"
          disabled={loading}
          style={{ width: '100%', padding: '10px', fontSize: 13, opacity: loading ? 0.6 : 1, marginTop: 4 }}
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </Btn>
      </form>
    </div>
  );
}
