import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { log } from '../logger';
import { serviceClient } from './supabase';

export interface VerifiedUser {
  userId: string;
  email: string | null;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
  iat?: number;
  aud?: string | string[];
  role?: string;
  iss?: string;
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

/**
 * Verify an HS256 Supabase access token locally. Avoids a network round trip on
 * every join. Returns null when the token is not HS256, is malformed, expired,
 * or the signature does not match.
 */
function verifyLocally(token: string): VerifiedUser | null {
  if (!config.supabase.jwtSecret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  let payload: JwtPayload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  if (header.alg !== 'HS256') return null;

  const expected = createHmac('sha256', config.supabase.jwtSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = base64UrlDecode(signatureB64);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp <= now) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 60) return null;
  if (!payload.sub) return null;
  // Anonymous/service tokens must not be accepted as player identities.
  if (payload.role && payload.role !== 'authenticated') return null;

  return { userId: payload.sub, email: payload.email ?? null };
}

/**
 * Verify a client-supplied Supabase access token. Tries local HS256
 * verification first, then falls back to asking Supabase (which also covers
 * projects using asymmetric signing keys).
 */
export async function verifyAccessToken(token: string): Promise<VerifiedUser | null> {
  if (!token || token.length > 4096) return null;

  const local = verifyLocally(token);
  if (local) return local;

  const client = serviceClient();
  if (!client) return null;

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? null };
  } catch (err) {
    log.warn('Token verification via Supabase failed', { message: (err as Error).message });
    return null;
  }
}
