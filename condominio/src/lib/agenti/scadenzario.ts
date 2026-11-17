// =====================================================================
// AGENTE SCADENZARIO / ADEMPIMENTI
// Aggrega tutte le scadenze gestionali e normative del condominio:
// mandato dell'amministratore (annuale, art. 1129 c.c.), polizza RC
// professionale, revisioni periodiche degli impianti (ascensori DPR 162/99,
// impianto termico DPR 74/2013, antincendio), scadenze contrattuali,
// adempimenti fiscali del condominio quale sostituto d'imposta.
// =====================================================================

import { prisma } from '@/lib/db';
import { giorniAllaData } from '@/lib/format';

export type PrioritaScadenza = 'scaduta' | 'urgente' | 'prossima' | 'pianificata';

export interface Scadenza {
  titolo: string;
  categoria: string; // Amministratore | Impianti | Contratti | Fiscale | Assicurazione
  data: Date | null;
  giorni: number | null;
  priorita: PrioritaScadenza;
  riferimento?: string;
  dettaglio?: string;
}

function prioritaDaGiorni(giorni: number | null): PrioritaScadenza {
  if (giorni === null) return 'pianificata';
  if (giorni < 0) return 'scaduta';
  if (giorni <= 30) return 'urgente';
  if (giorni <= 90) return 'prossima';
  return 'pianificata';
}

// Adempimenti fiscali ricorrenti del condominio (date tipiche di ciascun anno).
function adempimentiFiscali(anno: number): Scadenza[] {
  const mk = (m: number, d: number, titolo: string, rif: string, dettaglio: string): Scadenza => {
    const data = new Date(anno, m - 1, d);
    const giorni = giorniAllaData(data);
    return { titolo, categoria: 'Fiscale', data, giorni, priorita: prioritaDaGiorni(giorni), riferimento: rif, dettaglio };
  };
  return [
    mk(3, 16, 'Versamento ritenute fatture fornitori (F24)', 'Art. 25-ter DPR 600/73', 'Il condominio è sostituto d\'imposta: ritenuta 4% su corrispettivi per contratti di appalto.'),
    mk(3, 16, 'Certificazione Unica (CU) ai percipienti', 'D.Lgs. 175/2014', 'Rilascio CU per ritenute operate nell\'anno precedente.'),
    mk(10, 31, 'Dichiarazione modello 770', 'DPR 600/73', 'Dichiarazione del sostituto d\'imposta sulle ritenute operate.'),
    mk(3, 16, 'Comunicazione dati interventi edilizi (bonus) all\'Agenzia delle Entrate', 'Provv. AE', 'Trasmissione dei dati delle spese per interventi che danno diritto a detrazione.'),
  ];
}

export async function calcolaScadenze(condominioId: string): Promise<Scadenza[]> {
  const scadenze: Scadenza[] = [];

  const [amministratori, mandati, impianti, contratti, condominio] = await Promise.all([
    prisma.amministratore.findMany({ where: { condominioId, attuale: true } }),
    prisma.mandatoAmministratore.findMany({ where: { condominioId, dataRevoca: null } }),
    prisma.impianto.findMany({ where: { condominioId } }),
    prisma.contratto.findMany({ where: { condominioId }, include: { fornitore: true } }),
    prisma.condominio.findUnique({ where: { id: condominioId } }),
  ]);

  // Polizza RC amministratore (art. 1129, comma 3, c.c.)
  for (const a of amministratori) {
    if (a.polizzaRcScadenza) {
      const g = giorniAllaData(a.polizzaRcScadenza);
      scadenze.push({
        titolo: `Rinnovo polizza RC amministratore (${a.cognome} ${a.nome})`,
        categoria: 'Assicurazione',
        data: a.polizzaRcScadenza,
        giorni: g,
        priorita: prioritaDaGiorni(g),
        riferimento: 'Art. 1129, comma 3, c.c.',
        dettaglio: 'Polizza di responsabilità civile professionale dell\'amministratore.',
      });
    }
  }

  // Scadenza mandato amministratore (annuale, rinnovo tacito)
  for (const m of mandati) {
    if (m.dataScadenza) {
      const g = giorniAllaData(m.dataScadenza);
      scadenze.push({
        titolo: `Scadenza mandato amministratore (${m.nominativo})`,
        categoria: 'Amministratore',
        data: m.dataScadenza,
        giorni: g,
        priorita: prioritaDaGiorni(g),
        riferimento: 'Art. 1129, commi 10-11, c.c.',
        dettaglio: 'Mandato annuale, rinnovato tacitamente per un altro anno salvo diversa delibera. Convocare l\'assemblea per rinnovo/sostituzione.',
      });
    }
  }

  // Verifiche impianti
  for (const imp of impianti) {
    if (imp.prossimaVerifica) {
      const g = giorniAllaData(imp.prossimaVerifica);
      scadenze.push({
        titolo: `Verifica ${imp.tipo.replace('_', ' ')}: ${imp.descrizione}`,
        categoria: 'Impianti',
        data: imp.prossimaVerifica,
        giorni: g,
        priorita: prioritaDaGiorni(g),
        riferimento: imp.enteVerificatore ?? undefined,
        dettaglio: 'Verifica periodica di sicurezza obbligatoria.',
      });
    }
  }

  // Scadenze contratti
  for (const c of contratti) {
    if (c.dataScadenza) {
      const g = giorniAllaData(c.dataScadenza);
      scadenze.push({
        titolo: `Scadenza contratto: ${c.oggetto}${c.fornitore ? ' - ' + c.fornitore.ragioneSociale : ''}`,
        categoria: 'Contratti',
        data: c.dataScadenza,
        giorni: g,
        priorita: prioritaDaGiorni(g),
        dettaglio: c.rinnovoTacito ? 'Rinnovo tacito: valutare disdetta nei termini.' : 'Da rinnovare o mettere a gara.',
      });
    }
  }

  // Adempimenti fiscali (anno corrente, se il condominio esiste)
  if (condominio) {
    const anno = new Date().getFullYear();
    scadenze.push(...adempimentiFiscali(anno));
    // Includi anche i prossimi dell'anno successivo se mancano pochi mesi a fine anno.
    scadenze.push(...adempimentiFiscali(anno + 1).filter((s) => s.giorni !== null && s.giorni <= 180));
  }

  // Ordina: prima le scadute/urgenti, poi per data.
  scadenze.sort((a, b) => {
    const ga = a.giorni ?? 99999;
    const gb = b.giorni ?? 99999;
    return ga - gb;
  });

  return scadenze;
}
