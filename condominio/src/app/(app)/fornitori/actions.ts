'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';

function toDateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = String(v || '');
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function creaFornitore(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  await prisma.fornitore.create({
    data: {
      condominioId,
      ragioneSociale: String(formData.get('ragioneSociale') || 'Fornitore'),
      categoria: String(formData.get('categoria') || '') || null,
      partitaIva: String(formData.get('partitaIva') || '') || null,
      referente: String(formData.get('referente') || '') || null,
      telefono: String(formData.get('telefono') || '') || null,
      email: String(formData.get('email') || '') || null,
      pec: String(formData.get('pec') || '') || null,
      iban: String(formData.get('iban') || '') || null,
    },
  });
  revalidatePath('/fornitori');
}

export async function eliminaFornitore(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.fornitore.delete({ where: { id } });
  revalidatePath('/fornitori');
}

export async function creaContratto(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  await prisma.contratto.create({
    data: {
      condominioId,
      fornitoreId: String(formData.get('fornitoreId') || '') || null,
      oggetto: String(formData.get('oggetto') || 'Contratto'),
      tipo: String(formData.get('tipo') || 'manutenzione'),
      dataInizio: toDateOrNull(formData.get('dataInizio')),
      dataScadenza: toDateOrNull(formData.get('dataScadenza')),
      importoAnnuo: formData.get('importoAnnuo') ? Number(formData.get('importoAnnuo')) : null,
      rinnovoTacito: formData.get('rinnovoTacito') === 'on',
    },
  });
  revalidatePath('/fornitori');
}

export async function eliminaContratto(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.contratto.delete({ where: { id } });
  revalidatePath('/fornitori');
}

export async function creaImpianto(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  await prisma.impianto.create({
    data: {
      condominioId,
      tipo: String(formData.get('tipo') || 'altro'),
      descrizione: String(formData.get('descrizione') || 'Impianto'),
      ultimaVerifica: toDateOrNull(formData.get('ultimaVerifica')),
      prossimaVerifica: toDateOrNull(formData.get('prossimaVerifica')),
      periodicitaMesi: formData.get('periodicitaMesi') ? Number(formData.get('periodicitaMesi')) : null,
      enteVerificatore: String(formData.get('enteVerificatore') || '') || null,
    },
  });
  revalidatePath('/fornitori');
}

export async function eliminaImpianto(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.impianto.delete({ where: { id } });
  revalidatePath('/fornitori');
}
