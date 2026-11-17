'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';

export async function creaTabella(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  await prisma.tabellaMillesimale.create({
    data: {
      condominioId,
      nome: String(formData.get('nome') || 'Nuova tabella'),
      tipo: String(formData.get('tipo') || 'altro'),
      descrizione: String(formData.get('descrizione') || '') || null,
      totale: formData.get('totale') ? Number(formData.get('totale')) : 1000,
    },
  });
  revalidatePath('/millesimi');
}

export async function eliminaTabella(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.tabellaMillesimale.delete({ where: { id } });
  revalidatePath('/millesimi');
}

// Salva in blocco le quote di una tabella (upsert per ogni unità).
export async function salvaQuote(formData: FormData) {
  const tabellaId = String(formData.get('tabellaId') || '');
  if (!tabellaId) return;
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  const unita = await prisma.unitaImmobiliare.findMany({ where: { condominioId } });

  for (const u of unita) {
    const raw = formData.get(`m_${u.id}`);
    const millesimi = raw !== null && raw !== '' ? Number(raw) : 0;
    await prisma.quotaMillesimale.upsert({
      where: { tabellaId_unitaId: { tabellaId, unitaId: u.id } },
      update: { millesimi },
      create: { tabellaId, unitaId: u.id, millesimi },
    });
  }
  revalidatePath('/millesimi');
}
