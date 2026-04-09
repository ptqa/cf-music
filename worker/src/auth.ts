import { type UserRow } from './types';

interface AuthResult {
  ok: boolean;
  user?: UserRow;
  error?: string;
}

export async function authenticate(db: D1Database, params: Record<string, string>): Promise<AuthResult> {
  const username = params.u;
  const token = params.t;
  const salt = params.s;

  if (!username || !token || !salt) {
    return { ok: false, error: 'Missing authentication parameters (u, t, s)' };
  }

  const user = await db.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first<UserRow>();

  if (!user) {
    return { ok: false, error: 'Wrong username or password' };
  }

  // Subsonic auth: token = md5(password + salt)
  // password_hash stores the plaintext password (encrypted) since Subsonic protocol requires it
  const expectedToken = await md5(user.password_hash + salt);

  if (expectedToken !== token) {
    return { ok: false, error: 'Wrong username or password' };
  }

  return { ok: true, user };
}

async function md5(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('MD5', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
