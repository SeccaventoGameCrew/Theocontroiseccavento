// =====================================================================
// AGENTE RIPARTIZIONE SPESE
// Ripartisce le spese dell'esercizio tra le unità immobiliari in base alle
// tabelle millesimali (art. 1123 c.c.: le spese sono ripartite in misura
// proporzionale al valore della proprietà di ciascuno, salvo diverso
// criterio per cose destinate a servire in misura diversa - commi 2 e 3).
// =====================================================================

import { prisma } from '@/lib/db';
import { nomeCompleto } from '@/lib/format';

export interface RigaRiparto {
  unitaId: string;
  unitaDenominazione: string;
  condominoId: string | null;
  condominoNome: string;
  totale: number;
  // Dettaglio per voce di spesa / categoria
  perCategoria: { categoria: string; importo: number }[];
}

export interface DettaglioSpesaRiparto {
  spesaId: string;
  descrizione: string;
  importo: number;
  tabella: string;
  importoRipartito: number;
  nonRipartibile: boolean; // true se manca la tabella o i millesimi
}

export interface RisultatoRiparto {
  righe: RigaRiparto[];
  totaleSpese: number;
  totaleRipartito: number;
  nonRipartito: number;
  dettaglioSpese: DettaglioSpesaRiparto[];
  avvisi: string[];
}

export async function calcolaRiparto(esercizioId: string): Promise<RisultatoRiparto> {
  const esercizio = await prisma.esercizio.findUnique({
    where: { id: esercizioId },
    include: {
      spese: { include: { categoria: true } },
      condominio: {
        include: {
          unita: {
            include: {
              titolarita: { include: { condomino: true } },
            },
          },
          tabelle: { include: { quote: true } },
        },
      },
    },
  });

  if (!esercizio) {
    return {
      righe: [],
      totaleSpese: 0,
      totaleRipartito: 0,
      nonRipartito: 0,
      dettaglioSpese: [],
      avvisi: ['Esercizio non trovato.'],
    };
  }

  const unita = esercizio.condominio.unita;
  const tabelleById = new Map(esercizio.condominio.tabelle.map((t) => [t.id, t]));
  const avvisi: string[] = [];

  // Inizializza accumulatore per unità.
  const acc = new Map<string, RigaRiparto>();
  for (const u of unita) {
    // Proprietario prevalente (prima titolarità di tipo proprietario).
    const titolare =
      u.titolarita.find((t) => t.tipo === 'proprietario') ?? u.titolarita[0];
    acc.set(u.id, {
      unitaId: u.id,
      unitaDenominazione: u.denominazione,
      condominoId: titolare?.condomino.id ?? null,
      condominoNome: titolare ? nomeCompleto(titolare.condomino) : '— (unità senza titolare)',
      totale: 0,
      perCategoria: [],
    });
  }

  const dettaglioSpese: DettaglioSpesaRiparto[] = [];
  let totaleSpese = 0;
  let totaleRipartito = 0;

  for (const spesa of esercizio.spese) {
    totaleSpese += spesa.importo;
    const tabellaId = spesa.tabellaOverrideId ?? spesa.categoria?.tabellaId ?? null;
    const tabella = tabellaId ? tabelleById.get(tabellaId) : undefined;
    const nomeCategoria = spesa.categoria?.nome ?? 'Senza categoria';

    if (!tabella) {
      dettaglioSpese.push({
        spesaId: spesa.id,
        descrizione: spesa.descrizione,
        importo: spesa.importo,
        tabella: '— nessuna tabella —',
        importoRipartito: 0,
        nonRipartibile: true,
      });
      avvisi.push(
        `La spesa "${spesa.descrizione}" (${spesa.importo.toFixed(2)} €) non ha una tabella di ripartizione associata e non è stata ripartita.`,
      );
      continue;
    }

    const totaleMillesimiTabella = tabella.quote.reduce((s, q) => s + q.millesimi, 0);
    if (totaleMillesimiTabella <= 0) {
      dettaglioSpese.push({
        spesaId: spesa.id,
        descrizione: spesa.descrizione,
        importo: spesa.importo,
        tabella: tabella.nome,
        importoRipartito: 0,
        nonRipartibile: true,
      });
      avvisi.push(
        `La tabella "${tabella.nome}" non ha millesimi assegnati: la spesa "${spesa.descrizione}" non è stata ripartita.`,
      );
      continue;
    }

    let ripartitoSpesa = 0;
    for (const q of tabella.quote) {
      const riga = acc.get(q.unitaId);
      if (!riga) continue;
      const quota = (spesa.importo * q.millesimi) / totaleMillesimiTabella;
      riga.totale += quota;
      ripartitoSpesa += quota;
      const cat = riga.perCategoria.find((c) => c.categoria === nomeCategoria);
      if (cat) cat.importo += quota;
      else riga.perCategoria.push({ categoria: nomeCategoria, importo: quota });
    }

    totaleRipartito += ripartitoSpesa;
    dettaglioSpese.push({
      spesaId: spesa.id,
      descrizione: spesa.descrizione,
      importo: spesa.importo,
      tabella: tabella.nome,
      importoRipartito: ripartitoSpesa,
      nonRipartibile: false,
    });
  }

  const righe = Array.from(acc.values()).sort((a, b) =>
    a.unitaDenominazione.localeCompare(b.unitaDenominazione, 'it'),
  );

  return {
    righe,
    totaleSpese,
    totaleRipartito,
    nonRipartito: totaleSpese - totaleRipartito,
    dettaglioSpese,
    avvisi,
  };
}
