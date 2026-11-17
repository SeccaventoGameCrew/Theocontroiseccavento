'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';

function toDateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = String(v || '');
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function aggiornaCondominio(formData: FormData) {
  const id = await getCondominioId();
  if (!id) return;
  await prisma.condominio.update({
    where: { id },
    data: {
      denominazione: String(formData.get('denominazione') || ''),
      codiceFiscale: String(formData.get('codiceFiscale') || '') || null,
      indirizzo: String(formData.get('indirizzo') || ''),
      cap: String(formData.get('cap') || '') || null,
      citta: String(formData.get('citta') || '') || null,
      provincia: String(formData.get('provincia') || '') || null,
      dataCostituzione: toDateOrNull(formData.get('dataCostituzione')),
      tipoRegolamento: String(formData.get('tipoRegolamento') || 'assembleare'),
      note: String(formData.get('note') || '') || null,
    },
  });
  revalidatePath('/impostazioni');
}

export async function creaNuovoCondominio(formData: FormData) {
  const c = await prisma.condominio.create({
    data: {
      denominazione: String(formData.get('denominazione') || 'Nuovo condominio'),
      indirizzo: String(formData.get('indirizzo') || ''),
      citta: String(formData.get('citta') || '') || null,
      provincia: String(formData.get('provincia') || '') || null,
      codiceFiscale: String(formData.get('codiceFiscale') || '') || null,
    },
  });
  cookies().set('condominio_corrente', c.id, { path: '/', maxAge: 60 * 60 * 24 * 365 });
  redirect('/impostazioni');
}

export async function salvaAmministratore(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  const id = String(formData.get('id') || '');
  const data = {
    nome: String(formData.get('nome') || ''),
    cognome: String(formData.get('cognome') || ''),
    codiceFiscale: String(formData.get('codiceFiscale') || '') || null,
    partitaIva: String(formData.get('partitaIva') || '') || null,
    pec: String(formData.get('pec') || '') || null,
    email: String(formData.get('email') || '') || null,
    telefono: String(formData.get('telefono') || '') || null,
    numeroIscrizione: String(formData.get('numeroIscrizione') || '') || null,
    polizzaRcNumero: String(formData.get('polizzaRcNumero') || '') || null,
    polizzaRcMassimale: formData.get('polizzaRcMassimale') ? Number(formData.get('polizzaRcMassimale')) : null,
    polizzaRcScadenza: toDateOrNull(formData.get('polizzaRcScadenza')),
  };
  if (id) {
    await prisma.amministratore.update({ where: { id }, data });
  } else {
    await prisma.amministratore.create({ data: { ...data, condominioId, attuale: true } });
  }
  revalidatePath('/impostazioni');
}

export async function creaMandato(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  await prisma.mandatoAmministratore.create({
    data: {
      condominioId,
      nominativo: String(formData.get('nominativo') || ''),
      dataNomina: toDateOrNull(formData.get('dataNomina')) ?? new Date(),
      dataScadenza: toDateOrNull(formData.get('dataScadenza')),
      dataRevoca: toDateOrNull(formData.get('dataRevoca')),
      compensoAnnuo: formData.get('compensoAnnuo') ? Number(formData.get('compensoAnnuo')) : null,
      deliberaRif: String(formData.get('deliberaRif') || '') || null,
    },
  });
  revalidatePath('/impostazioni');
}

export async function eliminaMandato(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.mandatoAmministratore.delete({ where: { id } });
  revalidatePath('/impostazioni');
}
