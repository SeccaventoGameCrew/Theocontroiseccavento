'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';

export async function creaTrattamento(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  await prisma.trattamentoDati.create({
    data: {
      condominioId,
      finalita: String(formData.get('finalita') || ''),
      baseGiuridica: String(formData.get('baseGiuridica') || ''),
      categorieDati: String(formData.get('categorieDati') || ''),
      destinatari: String(formData.get('destinatari') || '') || null,
      conservazione: String(formData.get('conservazione') || '') || null,
    },
  });
  revalidatePath('/privacy');
}

export async function eliminaTrattamento(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.trattamentoDati.delete({ where: { id } });
  revalidatePath('/privacy');
}
