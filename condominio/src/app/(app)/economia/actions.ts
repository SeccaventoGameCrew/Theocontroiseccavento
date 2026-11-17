'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';

function toDate(v: FormDataEntryValue | null): Date {
  const s = String(v || '');
  const d = s ? new Date(s) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

export async function creaEsercizio(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  const es = await prisma.esercizio.create({
    data: {
      condominioId,
      denominazione: String(formData.get('denominazione') || 'Nuovo esercizio'),
      dataInizio: toDate(formData.get('dataInizio')),
      dataFine: toDate(formData.get('dataFine')),
      tipo: String(formData.get('tipo') || 'ordinaria'),
      fondoRiserva: formData.get('fondoRiserva') ? Number(formData.get('fondoRiserva')) : 0,
    },
  });
  redirect(`/economia/${es.id}`);
}

export async function aggiornaStatoEsercizio(formData: FormData) {
  const id = String(formData.get('id') || '');
  const stato = String(formData.get('stato') || 'aperto');
  if (id) await prisma.esercizio.update({ where: { id }, data: { stato } });
  revalidatePath(`/economia/${id}`);
}

export async function eliminaEsercizio(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.esercizio.delete({ where: { id } });
  revalidatePath('/economia');
  redirect('/economia');
}

export async function creaCategoria(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;
  await prisma.categoriaSpesa.create({
    data: {
      condominioId,
      nome: String(formData.get('nome') || 'Categoria'),
      tabellaId: String(formData.get('tabellaId') || '') || null,
      tipo: String(formData.get('tipo') || 'ordinaria'),
    },
  });
  revalidatePath(String(formData.get('ritorno') || '/economia'));
}

export async function creaSpesa(formData: FormData) {
  const esercizioId = String(formData.get('esercizioId') || '');
  if (!esercizioId) return;
  await prisma.spesa.create({
    data: {
      esercizioId,
      data: toDate(formData.get('data')),
      descrizione: String(formData.get('descrizione') || 'Spesa'),
      importo: Number(formData.get('importo') || 0),
      categoriaId: String(formData.get('categoriaId') || '') || null,
      fornitoreId: String(formData.get('fornitoreId') || '') || null,
      tabellaOverrideId: String(formData.get('tabellaOverrideId') || '') || null,
      numeroDocumento: String(formData.get('numeroDocumento') || '') || null,
      pagata: formData.get('pagata') === 'on',
    },
  });
  revalidatePath(`/economia/${esercizioId}`);
}

export async function eliminaSpesa(formData: FormData) {
  const id = String(formData.get('id') || '');
  const esercizioId = String(formData.get('esercizioId') || '');
  if (id) await prisma.spesa.delete({ where: { id } });
  revalidatePath(`/economia/${esercizioId}`);
}

export async function togglePagataSpesa(formData: FormData) {
  const id = String(formData.get('id') || '');
  const esercizioId = String(formData.get('esercizioId') || '');
  const spesa = await prisma.spesa.findUnique({ where: { id } });
  if (spesa) await prisma.spesa.update({ where: { id }, data: { pagata: !spesa.pagata } });
  revalidatePath(`/economia/${esercizioId}`);
}

export async function creaRataManuale(formData: FormData) {
  const esercizioId = String(formData.get('esercizioId') || '');
  const condominoId = String(formData.get('condominoId') || '');
  if (!esercizioId || !condominoId) return;
  const count = await prisma.rata.count({ where: { esercizioId, condominoId } });
  await prisma.rata.create({
    data: {
      esercizioId,
      condominoId,
      numero: count + 1,
      descrizione: String(formData.get('descrizione') || '') || null,
      scadenza: toDate(formData.get('scadenza')),
      importo: Number(formData.get('importo') || 0),
    },
  });
  revalidatePath(`/economia/${esercizioId}`);
}

// Genera automaticamente le rate per tutti i condomini, ripartendo un importo
// complessivo in base ai millesimi della tabella di proprietà.
export async function generaRate(formData: FormData) {
  const esercizioId = String(formData.get('esercizioId') || '');
  const importoTotale = Number(formData.get('importoTotale') || 0);
  const numeroRate = Math.max(1, Number(formData.get('numeroRate') || 1));
  const scadenza = toDate(formData.get('primaScadenza'));
  if (!esercizioId || importoTotale <= 0) return;

  const condominioId = await getCondominioId();
  if (!condominioId) return;

  const tabella = await prisma.tabellaMillesimale.findFirst({
    where: { condominioId, tipo: 'proprieta' },
    include: { quote: { include: { unita: { include: { titolarita: { include: { condomino: true } } } } } } },
  });
  if (!tabella) return;

  const totMill = tabella.quote.reduce((s, q) => s + q.millesimi, 0) || 1000;

  // Somma i millesimi per condomino (proprietario prevalente di ciascuna unità).
  const perCondomino = new Map<string, number>();
  for (const q of tabella.quote) {
    const tit = q.unita.titolarita.find((t) => t.tipo === 'proprietario') ?? q.unita.titolarita[0];
    if (!tit) continue;
    perCondomino.set(tit.condominoId, (perCondomino.get(tit.condominoId) ?? 0) + q.millesimi);
  }

  for (const [condominoId, mill] of perCondomino) {
    const quotaCondomino = (importoTotale * mill) / totMill;
    const base = await prisma.rata.count({ where: { esercizioId, condominoId } });
    for (let i = 0; i < numeroRate; i++) {
      const dataRata = new Date(scadenza);
      dataRata.setMonth(dataRata.getMonth() + i * Math.floor(12 / numeroRate));
      await prisma.rata.create({
        data: {
          esercizioId,
          condominoId,
          numero: base + i + 1,
          descrizione: `Rata ${i + 1}/${numeroRate} (riparto millesimale)`,
          scadenza: dataRata,
          importo: Math.round((quotaCondomino / numeroRate) * 100) / 100,
        },
      });
    }
  }
  revalidatePath(`/economia/${esercizioId}`);
}

export async function eliminaRata(formData: FormData) {
  const id = String(formData.get('id') || '');
  const esercizioId = String(formData.get('esercizioId') || '');
  if (id) await prisma.rata.delete({ where: { id } });
  revalidatePath(`/economia/${esercizioId}`);
}

export async function registraPagamento(formData: FormData) {
  const rataId = String(formData.get('rataId') || '');
  const esercizioId = String(formData.get('esercizioId') || '');
  if (!rataId) return;
  await prisma.pagamento.create({
    data: {
      rataId,
      data: toDate(formData.get('data')),
      importo: Number(formData.get('importo') || 0),
      metodo: String(formData.get('metodo') || 'bonifico'),
      riferimento: String(formData.get('riferimento') || '') || null,
    },
  });
  revalidatePath(`/economia/${esercizioId}`);
  revalidatePath('/economia/morosita');
}
