// Autenticazione minimale basata su cookie firmato (HMAC).
// NOTA DI SICUREZZA: implementazione dimostrativa con credenziale singola da
// variabile d'ambiente. In produzione: utenti multipli con password hashate
// (bcrypt/argon2), 2FA, gestione ruoli e segreti in un vault.

import crypto from 'crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'cond_session';
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

function sign(value: string): string {
  const h = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}

function verify(token: string | undefined): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const value = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  try {
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

export function verificaCredenziali(email: string, password: string): boolean {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@condominio.it';
  const adminPassword = process.env.ADMIN_PASSWORD || 'condominio2026';
  return email.trim().toLowerCase() === adminEmail.toLowerCase() && password === adminPassword;
}

export function creaSessione(email: string) {
  const token = sign(`${email}|${Date.now()}`);
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8, // 8 ore
  });
}

export function distruggiSessione() {
  cookies().delete(COOKIE_NAME);
}

export function getSessione(): { email: string } | null {
  const token = cookies().get(COOKIE_NAME)?.value;
  const value = verify(token);
  if (!value) return null;
  const email = value.split('|')[0];
  return { email };
}

export function isAutenticato(): boolean {
  return getSessione() !== null;
}
