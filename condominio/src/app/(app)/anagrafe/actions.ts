'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';

export async function creaCondomino(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  const tipoPersona = String(formData.get('tipoPersona') || 'fisica');
  await prisma.condomino.create({
    data: {
      condominioId,
      tipoPersona,
      nome: tipoPersona === 'fisica' ? String(formData.get('nome') || '') || null : null,
      cognome: tipoPersona === 'fisica' ? String(formData.get('cognome') || '') || null : null,
      ragioneSociale: tipoPersona === 'giuridica' ? String(formData.get('ragioneSociale') || '') || null : null,
      codiceFiscale: String(formData.get('codiceFiscale') || '') || null,
      partitaIva: String(formData.get('partitaIva') || '') || null,
      indirizzo: String(formData.get('indirizzo') || '') || null,
      citta: String(formData.get('citta') || '') || null,
      email: String(formData.get('email') || '') || null,
      pec: String(formData.get('pec') || '') || null,
      telefono: String(formData.get('telefono') || '') || null,
    },
  });
  revalidatePath('/anagrafe');
}

export async function eliminaCondomino(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.condomino.delete({ where: { id } });
  revalidatePath('/anagrafe');
}

export async function creaUnita(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  await prisma.unitaImmobiliare.create({
    data: {
      condominioId,
      denominazione: String(formData.get('denominazione') || 'Nuova unità'),
      tipo: String(formData.get('tipo') || 'appartamento'),
      scala: String(formData.get('scala') || '') || null,
      piano: String(formData.get('piano') || '') || null,
      superficie: formData.get('superficie') ? Number(formData.get('superficie')) : null,
      catastoFoglio: String(formData.get('catastoFoglio') || '') || null,
      catastoParticella: String(formData.get('catastoParticella') || '') || null,
      catastoSub: String(formData.get('catastoSub') || '') || null,
    },
  });
  revalidatePath('/anagrafe');
}

export async function eliminaUnita(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.unitaImmobiliare.delete({ where: { id } });
  revalidatePath('/anagrafe');
}

export async function assegnaTitolarita(formData: FormData) {
  const unitaId = String(formData.get('unitaId') || '');
  const condominoId = String(formData.get('condominoId') || '');
  if (!unitaId || !condominoId) return;
  await prisma.titolarita.create({
    data: {
      unitaId,
      condominoId,
      tipo: String(formData.get('tipo') || 'proprietario'),
      quota: formData.get('quota') ? Number(formData.get('quota')) : 100,
    },
  });
  revalidatePath('/anagrafe');
}

export async function rimuoviTitolarita(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.titolarita.delete({ where: { id } });
  revalidatePath('/anagrafe');
}
