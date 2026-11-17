// Generatore di documenti assembleari: avviso di convocazione (art. 66 disp.
// att. c.c.) e bozza di verbale (art. 1136, ultimo comma, c.c.).

import { dataIt } from '@/lib/format';
import { REGOLE_MAGGIORANZA, TipoMaggioranza } from '@/lib/agenti/assembleare';

interface DatiConvocazione {
  condominio: string;
  indirizzo: string;
  tipo: string;
  luogo: string | null;
  dataPrima: Date | null;
  oraPrima: string | null;
  dataSeconda: Date | null;
  oraSeconda: string | null;
  punti: { numero: number; oggetto: string }[];
  dataInvio?: Date | null;
}

export function generaConvocazione(d: DatiConvocazione): string {
  const odg = d.punti
    .sort((a, b) => a.numero - b.numero)
    .map((p) => `   ${p.numero}. ${p.oggetto}`)
    .join('\n');

  return `AVVISO DI CONVOCAZIONE DELL'ASSEMBLEA ${d.tipo.toUpperCase()}
Condominio ${d.condominio} — ${d.indirizzo}

Ai sensi degli artt. 66 e 67 disp. att. c.c., si comunica che è convocata l'assemblea ${d.tipo} dei condomini che si terrà:

- in PRIMA convocazione il giorno ${dataIt(d.dataPrima)} alle ore ${d.oraPrima ?? '____'}${
    d.dataSeconda
      ? `\n- in SECONDA convocazione il giorno ${dataIt(d.dataSeconda)} alle ore ${d.oraSeconda ?? '____'}`
      : ''
  }
presso ${d.luogo ?? '______________________'}, per discutere e deliberare sul seguente

ORDINE DEL GIORNO:
${odg}

Si ricorda che:
- ogni condomino può intervenire personalmente o a mezzo delegato (art. 67 disp. att. c.c.);
- se i condomini sono più di venti, il delegato non può rappresentare più di un quinto dei condomini e del valore proporzionale;
- l'avviso deve pervenire almeno 5 giorni prima della data fissata per la prima convocazione (art. 66, c.3, disp. att. c.c.), a mezzo raccomandata, PEC, fax o consegna a mani.

${d.dataInvio ? `Data di invio: ${dataIt(d.dataInvio)}\n` : ''}L'Amministratore
________________________`;
}

interface DatiVerbale {
  condominio: string;
  tipo: string;
  convocazione: 1 | 2;
  data: Date | null;
  ora: string | null;
  luogo: string | null;
  presidente?: string;
  segretario?: string;
  partecipantiTotali: number;
  presentiTeste: number;
  presentiMillesimi: number;
  costituita: boolean;
  punti: {
    numero: number;
    oggetto: string;
    tipoMaggioranza: TipoMaggioranza;
    favorevoliTeste: number;
    favorevoliMillesimi: number;
    contrariTeste: number;
    contrariMillesimi: number;
    astenutiTeste: number;
    astenutiMillesimi: number;
    esito: string | null;
  }[];
}

export function generaVerbale(d: DatiVerbale): string {
  const intestazione = `VERBALE DELL'ASSEMBLEA ${d.tipo.toUpperCase()}
Condominio ${d.condominio}

L'anno ${d.data ? d.data.getFullYear() : '____'}, il giorno ${dataIt(d.data)} alle ore ${d.ora ?? '____'}, in ${
    d.luogo ?? '____________'
  }, in ${d.convocazione === 1 ? 'prima' : 'seconda'} convocazione, si è riunita l'assemblea ${d.tipo} dei condomini.

Assume la presidenza il/la Sig./ra ${d.presidente ?? '____________________'}, che nomina segretario il/la Sig./ra ${
    d.segretario ?? '____________________'
  }.

Il Presidente, constatato che sono presenti/rappresentati n. ${d.presentiTeste} condomini su ${d.partecipantiTotali}, per complessivi ${d.presentiMillesimi.toFixed(
    2,
  )} millesimi, dichiara l'assemblea ${d.costituita ? 'VALIDAMENTE COSTITUITA' : 'NON validamente costituita'} e ${
    d.costituita ? 'atta a deliberare' : 'rinvia la trattazione'
  }.`;

  const corpo = d.punti
    .sort((a, b) => a.numero - b.numero)
    .map((p) => {
      const regola = REGOLE_MAGGIORANZA[p.tipoMaggioranza];
      return `
PUNTO ${p.numero} — ${p.oggetto}
(Maggioranza richiesta: ${regola.etichetta} — ${regola.riferimento})
Posta in votazione la proposta, l'assemblea esprime:
   - favorevoli:   n. ${p.favorevoliTeste} teste, ${p.favorevoliMillesimi.toFixed(2)} millesimi
   - contrari:     n. ${p.contrariTeste} teste, ${p.contrariMillesimi.toFixed(2)} millesimi
   - astenuti:     n. ${p.astenutiTeste} teste, ${p.astenutiMillesimi.toFixed(2)} millesimi
L'assemblea pertanto DELIBERA: ${p.esito ? p.esito.toUpperCase() : '____________'}.`;
    })
    .join('\n');

  const chiusura = `

Null'altro essendovi da deliberare, e nessun altro chiedendo la parola, l'assemblea è sciolta alle ore ______.

Il Segretario                              Il Presidente
_____________________                      _____________________`;

  return intestazione + '\n' + corpo + chiusura;
}
