/**
 * auth.ts — Lightweight token-based authentication for the admin interface.
 *
 * Usage:
 *   - Set ADMIN_PASSWORD in .env to enable auth. Leave unset for open access (dev).
 *   - POST /api/auth/login with { password } → { token } on success, 401 on failure.
 *   - Include ?token=<token> in the WebSocket URL for admin connections.
 *   - Simple-page connections use ?role=simple and are always allowed.
 *
 * Tokens are random 32-byte hex strings, stored in memory with a 24-hour TTL.
 * The server must be restarted to invalidate all active sessions.
 */

import crypto from 'crypto';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class Auth {
  /** Map from token hex string → expiry epoch ms */
  private readonly tokens = new Map<string, number>();
  /** Plaintext password; null means auth is disabled */
  private readonly password: string | null;

  constructor(password: string | null) {
    this.password = password ?? null;
  }

  /** Whether auth is enabled (ADMIN_PASSWORD was set) */
  get enabled(): boolean {
    return this.password !== null && this.password.length > 0;
  }

  /**
   * Attempt a login. Returns a fresh token on success, null on wrong password.
   * If auth is disabled, always succeeds.
   */
  login(attempt: string): string | null {
    if (!this.enabled || attempt === this.password) {
      const token = crypto.randomBytes(32).toString('hex');
      this.tokens.set(token, Date.now() + TOKEN_TTL_MS);
      this.pruneExpired();
      return token;
    }
    return null;
  }

  /**
   * Check whether a token is valid and unexpired.
   * Returns true if auth is disabled (no password set).
   */
  isValid(token: string): boolean {
    if (!this.enabled) return true;
    const exp = this.tokens.get(token);
    if (!exp) return false;
    if (Date.now() >= exp) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  /** Remove expired tokens to avoid unbounded memory growth */
  private pruneExpired(): void {
    const now = Date.now();
    for (const [t, exp] of this.tokens) {
      if (now >= exp) this.tokens.delete(t);
    }
  }
}
