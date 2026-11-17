'use server';

import { redirect } from 'next/navigation';
import { creaSessione, verificaCredenziali } from '@/lib/auth';

export async function login(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  if (!verificaCredenziali(email, password)) {
    return 'Credenziali non valide. Controlla email e password.';
  }
  creaSessione(email);
  redirect('/');
}
