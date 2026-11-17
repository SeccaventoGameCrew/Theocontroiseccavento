'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { distruggiSessione } from '@/lib/auth';

export async function cambiaCondominio(formData: FormData) {
  const id = String(formData.get('condominioId') || '');
  if (id) {
    cookies().set('condominio_corrente', id, { path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
  redirect('/');
}

export async function logout() {
  distruggiSessione();
  redirect('/login');
}
