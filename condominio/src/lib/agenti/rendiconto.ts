// =====================================================================
// AGENTE RENDICONTO
// Costruisce il rendiconto condominiale secondo l'art. 1130-bis c.c.,
// composto da: registro di contabilità, riepilogo finanziario (situazione
// patrimoniale) e nota sintetica esplicativa. Il rendiconto è approvato
// dall'assemblea (art. 1130 n.10 e 1135 c.c.).
// =====================================================================

import { prisma } from '@/lib/db';
import { calcolaRiparto, RisultatoRiparto } from '@/lib/agenti/ripartizione';

export interface MovimentoContabile {
  data: Date;
  descrizione: string;
  categoria: string;
  entrata: number;
  uscita: number;
}

export interface Rendiconto {
  esercizioId: string;
  denominazione: string;
  // Registro di contabilità (art. 1130 n.7 - cronologico)
  movimenti: MovimentoContabile[];
  // Riepilogo finanziario / situazione patrimoniale
  totaleUscite: number; // spese dell'esercizio
  totaleEntrate: number; // versamenti incassati
  fondoRiserva: number;
  saldoCassa: number; // entrate - uscite pagate
  creditiVersoCondomini: number; // morosità (quote dovute non versate)
  debitiVersoFornitori: number; // spese non ancora pagate
  riparto: RisultatoRiparto;
}

export async function calcolaRendiconto(esercizioId: string): Promise<Rendiconto | null> {
  const esercizio = await prisma.esercizio.findUnique({
    where: { id: esercizioId },
    include: {
      spese: { include: { categoria: true, fornitore: true } },
      rate: { include: { pagamenti: true } },
    },
  });
  if (!esercizio) return null;

  const movimenti: MovimentoContabile[] = [];

  // Uscite: spese
  let totaleUscite = 0;
  let debitiVersoFornitori = 0;
  for (const s of esercizio.spese) {
    totaleUscite += s.importo;
    if (!s.pagata) debitiVersoFornitori += s.importo;
    movimenti.push({
      data: s.data,
      descrizione: s.descrizione + (s.fornitore ? ` (${s.fornitore.ragioneSociale})` : ''),
      categoria: s.categoria?.nome ?? 'Senza categoria',
      entrata: 0,
      uscita: s.importo,
    });
  }

  // Entrate: pagamenti rate
  let totaleEntrate = 0;
  let totaleDovuto = 0;
  for (const r of esercizio.rate) {
    totaleDovuto += r.importo;
    for (const p of r.pagamenti) {
      totaleEntrate += p.importo;
      movimenti.push({
        data: p.data,
        descrizione: `Versamento quota - ${r.descrizione ?? 'Rata ' + r.numero}`,
        categoria: 'Versamenti condomini',
        entrata: p.importo,
        uscita: 0,
      });
    }
  }

  movimenti.sort((a, b) => a.data.getTime() - b.data.getTime());

  const creditiVersoCondomini = Math.max(0, totaleDovuto - totaleEntrate);
  const spesePagate = esercizio.spese.filter((s) => s.pagata).reduce((s, x) => s + x.importo, 0);

  const riparto = await calcolaRiparto(esercizioId);

  return {
    esercizioId,
    denominazione: esercizio.denominazione,
    movimenti,
    totaleUscite,
    totaleEntrate,
    fondoRiserva: esercizio.fondoRiserva,
    saldoCassa: totaleEntrate - spesePagate,
    creditiVersoCondomini,
    debitiVersoFornitori,
    riparto,
  };
}
