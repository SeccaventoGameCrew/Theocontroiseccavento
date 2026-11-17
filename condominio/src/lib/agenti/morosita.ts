// =====================================================================
// AGENTE MOROSITÀ
// Calcola la situazione dei pagamenti per condomino e individua le
// posizioni morose. Rilevante per la riscossione forzosa: l'amministratore
// è tenuto ad agire per la riscossione entro sei mesi dalla chiusura
// dell'esercizio (art. 1129, comma 9, c.c.) e può ottenere decreto
// ingiuntivo immediatamente esecutivo (art. 63 disp. att. c.c.).
// =====================================================================

import { prisma } from '@/lib/db';
import { nomeCompleto } from '@/lib/format';

export interface RataStato {
  rataId: string;
  descrizione: string;
  scadenza: Date;
  importo: number;
  pagato: number;
  residuo: number;
  scaduta: boolean;
}

export interface PosizioneCondomino {
  condominoId: string;
  nome: string;
  totaleDovuto: number;
  totalePagato: number;
  saldo: number; // positivo = a debito (moroso)
  rateScaduteNonPagate: number;
  importoScaduto: number;
  moroso: boolean;
  rate: RataStato[];
}

export interface RisultatoMorosita {
  posizioni: PosizioneCondomino[];
  totaleDovuto: number;
  totaleIncassato: number;
  totaleMorosita: number;
  numeroMorosi: number;
}

export async function calcolaMorosita(condominioId: string, esercizioId?: string): Promise<RisultatoMorosita> {
  const esercizi = await prisma.esercizio.findMany({
    where: { condominioId, ...(esercizioId ? { id: esercizioId } : {}) },
    include: {
      rate: { include: { pagamenti: true } },
    },
  });

  const condomini = await prisma.condomino.findMany({ where: { condominioId } });
  const nomeById = new Map(condomini.map((c) => [c.id, nomeCompleto(c)]));

  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);

  const mappa = new Map<string, PosizioneCondomino>();

  for (const es of esercizi) {
    for (const rata of es.rate) {
      const pagato = rata.pagamenti.reduce((s, p) => s + p.importo, 0);
      const residuo = Math.max(0, rata.importo - pagato);
      const scaduta = rata.scadenza < oggi && residuo > 0.009;

      let pos = mappa.get(rata.condominoId);
      if (!pos) {
        pos = {
          condominoId: rata.condominoId,
          nome: nomeById.get(rata.condominoId) ?? '— sconosciuto —',
          totaleDovuto: 0,
          totalePagato: 0,
          saldo: 0,
          rateScaduteNonPagate: 0,
          importoScaduto: 0,
          moroso: false,
          rate: [],
        };
        mappa.set(rata.condominoId, pos);
      }

      pos.totaleDovuto += rata.importo;
      pos.totalePagato += pagato;
      if (scaduta) {
        pos.rateScaduteNonPagate += 1;
        pos.importoScaduto += residuo;
      }
      pos.rate.push({
        rataId: rata.id,
        descrizione: rata.descrizione ?? `Rata ${rata.numero}`,
        scadenza: rata.scadenza,
        importo: rata.importo,
        pagato,
        residuo,
        scaduta,
      });
    }
  }

  const posizioni = Array.from(mappa.values()).map((p) => {
    p.saldo = p.totaleDovuto - p.totalePagato;
    p.moroso = p.importoScaduto > 0.009;
    p.rate.sort((a, b) => a.scadenza.getTime() - b.scadenza.getTime());
    return p;
  });

  posizioni.sort((a, b) => b.importoScaduto - a.importoScaduto || a.nome.localeCompare(b.nome, 'it'));

  return {
    posizioni,
    totaleDovuto: posizioni.reduce((s, p) => s + p.totaleDovuto, 0),
    totaleIncassato: posizioni.reduce((s, p) => s + p.totalePagato, 0),
    totaleMorosita: posizioni.reduce((s, p) => s + p.importoScaduto, 0),
    numeroMorosi: posizioni.filter((p) => p.moroso).length,
  };
}

// Genera il testo di una lettera di sollecito per un condomino moroso.
export function generaSollecito(pos: PosizioneCondomino, condominio: string): string {
  const oggi = new Date().toLocaleDateString('it-IT');
  return `OGGETTO: Sollecito di pagamento quote condominiali - ${condominio}

${oggi}

Spett.le ${pos.nome},

dalle scritture contabili del condominio risulta a Suo carico un importo scaduto e non pagato pari a € ${pos.importoScaduto.toFixed(2)}, relativo a n. ${pos.rateScaduteNonPagate} rata/e di seguito dettagliata/e:

${pos.rate
  .filter((r) => r.scaduta)
  .map((r) => `  - ${r.descrizione}: scadenza ${r.scadenza.toLocaleDateString('it-IT')}, residuo € ${r.residuo.toFixed(2)}`)
  .join('\n')}

La invitiamo a provvedere al versamento di quanto dovuto entro 15 giorni dal ricevimento della presente, mediante bonifico sul conto corrente intestato al condominio.

In difetto, questa amministrazione sarà costretta ad agire per la riscossione coattiva ai sensi dell'art. 63 disp. att. c.c., con richiesta di decreto ingiuntivo immediatamente esecutivo, con aggravio a Suo carico delle relative spese legali.

Distinti saluti,
L'Amministratore del Condominio ${condominio}`;
}
