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
  const password = params.p;

  if (!username) {
    return { ok: false, error: 'Missing required parameter: u (username)' };
  }

  if (!token && !password) {
    return { ok: false, error: 'Missing authentication parameters (t+s or p)' };
  }

  const user = await db.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first<UserRow>();

  if (!user) {
    return { ok: false, error: 'Wrong username or password' };
  }

  // Method 1: Token auth — token = md5(password + salt)
  if (token && salt) {
    const expectedToken = await md5(user.password_hash + salt);
    if (expectedToken !== token) {
      return { ok: false, error: 'Wrong username or password' };
    }
    return { ok: true, user };
  }

  // Method 2: Password auth — plaintext or enc: hex-encoded
  if (password) {
    let plainPassword = password;

    // Handle hex-encoded password: enc:hexstring
    if (plainPassword.startsWith('enc:')) {
      plainPassword = hexDecode(plainPassword.slice(4));
    }

    if (plainPassword !== user.password_hash) {
      return { ok: false, error: 'Wrong username or password' };
    }
    return { ok: true, user };
  }

  return { ok: false, error: 'Missing authentication parameters' };
}

async function md5(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('MD5', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexDecode(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return str;
}
