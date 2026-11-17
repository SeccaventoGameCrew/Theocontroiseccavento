// =====================================================================
// AGENTE ASSEMBLEARE
// Motore di calcolo dei quorum costitutivi e deliberativi dell'assemblea
// condominiale, secondo l'art. 1136 c.c. (come modif. dalla L. 220/2012),
// in combinato con gli artt. 1120, 1117-ter, 1122-ter, 1135 c.c. e
// artt. 67, 69 disp. att. c.c.
// =====================================================================

export const TOTALE_MILLESIMI = 1000;

export type TipoMaggioranza =
  | 'ordinaria'
  | 'qualificata_500'
  | 'innovazioni'
  | 'unanimita';

export interface RegolaMaggioranza {
  codice: TipoMaggioranza;
  etichetta: string;
  descrizione: string;
  riferimento: string;
  esempi: string[];
  // Soglia di millesimi favorevoli richiesta, per convocazione.
  millesimiPrima: number;
  millesimiSeconda: number;
  // Richiede l'unanimità dei partecipanti (totalità teste e millesimi)?
  richiedeUnanimita: boolean;
}

// Soglie espresse in millesimi su base 1000.
export const REGOLE_MAGGIORANZA: Record<TipoMaggioranza, RegolaMaggioranza> = {
  ordinaria: {
    codice: 'ordinaria',
    etichetta: 'Maggioranza ordinaria (art. 1136 c.2/c.3)',
    descrizione:
      'Maggioranza degli intervenuti che rappresenti almeno la metà del valore dell\'edificio in prima convocazione, almeno un terzo in seconda.',
    riferimento: 'Art. 1136, commi 2 e 3, c.c.',
    esempi: [
      'Approvazione rendiconto consuntivo e preventivo',
      'Ripartizione delle spese ordinarie',
      'Manutenzione ordinaria delle parti comuni',
      'Revisione tabelle millesimali per errore (art. 69 disp. att.)',
    ],
    millesimiPrima: 500,
    millesimiSeconda: 333.34,
    richiedeUnanimita: false,
  },
  qualificata_500: {
    codice: 'qualificata_500',
    etichetta: 'Maggioranza qualificata (art. 1136 c.4)',
    descrizione:
      'Maggioranza degli intervenuti e almeno la metà del valore dell\'edificio (500 millesimi), sia in prima sia in seconda convocazione.',
    riferimento: 'Art. 1136, comma 4, c.c. (e art. 1120 c.2)',
    esempi: [
      'Nomina e revoca dell\'amministratore',
      'Liti attive e passive relative a materie che esorbitano dalle attribuzioni dell\'amministratore',
      'Riparazioni straordinarie di notevole entità e ricostruzioni',
      'Innovazioni agevolate: barriere architettoniche, risparmio energetico, impianti centralizzati TV/satellitari, mobilità elettrica',
    ],
    millesimiPrima: 500,
    millesimiSeconda: 500,
    richiedeUnanimita: false,
  },
  innovazioni: {
    codice: 'innovazioni',
    etichetta: 'Innovazioni (art. 1136 c.5)',
    descrizione:
      'Maggioranza degli intervenuti e almeno i due terzi del valore dell\'edificio (667 millesimi).',
    riferimento: 'Art. 1136, comma 5, c.c. (art. 1120, comma 1)',
    esempi: [
      'Innovazioni dirette al miglioramento o all\'uso più comodo o al maggior rendimento delle cose comuni',
      'Installazione di nuovi impianti non agevolati',
    ],
    millesimiPrima: 666.67,
    millesimiSeconda: 666.67,
    richiedeUnanimita: false,
  },
  unanimita: {
    codice: 'unanimita',
    etichetta: 'Unanimità',
    descrizione:
      'Consenso di tutti i condomini (totalità delle teste e dei 1000 millesimi). Necessaria quando la delibera incide sui diritti individuali.',
    riferimento: 'Artt. 1123-1138 c.c., art. 69 disp. att. c.c.',
    esempi: [
      'Modifica dei criteri legali di ripartizione / tabelle millesimali convenzionali',
      'Approvazione o modifica del regolamento contrattuale',
      'Atti che incidono sui diritti individuali dei condomini (es. vendita parti comuni)',
    ],
    millesimiPrima: 1000,
    millesimiSeconda: 1000,
    richiedeUnanimita: true,
  },
};

export interface InputCostituzione {
  convocazione: 1 | 2;
  partecipantiTotali: number; // numero totale di condomini (teste)
  millesimiTotali: number; // di norma 1000
  presentiTeste: number;
  presentiMillesimi: number;
}

export interface EsitoCostituzione {
  valida: boolean;
  tesateRichieste: number;
  millesimiRichiesti: number;
  dettaglio: string;
  regola: string;
}

// Quorum costitutivo (art. 1136, commi 1 e 3, c.c.)
export function verificaCostituzione(i: InputCostituzione): EsitoCostituzione {
  if (i.convocazione === 1) {
    // Prima convocazione: 2/3 del valore (667) E maggioranza dei partecipanti (> metà teste)
    const millesimiRichiesti = (i.millesimiTotali * 2) / 3;
    const tesateRichieste = i.partecipantiTotali / 2; // serve la maggioranza: strettamente > metà
    const okMillesimi = i.presentiMillesimi >= millesimiRichiesti - 0.01;
    const okTeste = i.presentiTeste > tesateRichieste;
    return {
      valida: okMillesimi && okTeste,
      tesateRichieste: Math.floor(tesateRichieste) + 1,
      millesimiRichiesti,
      regola: 'Prima convocazione (art. 1136 c.1): 2/3 del valore (667 mill.) e maggioranza dei partecipanti.',
      dettaglio: `Presenti ${i.presentiTeste}/${i.partecipantiTotali} teste e ${i.presentiMillesimi.toFixed(2)}/${i.millesimiTotali} millesimi.`,
    };
  }
  // Seconda convocazione (art. 1136 c.3): 1/3 dei partecipanti E 1/3 del valore
  const millesimiRichiesti = i.millesimiTotali / 3;
  const tesateRichieste = i.partecipantiTotali / 3;
  const okMillesimi = i.presentiMillesimi >= millesimiRichiesti - 0.01;
  const okTeste = i.presentiTeste >= tesateRichieste;
  return {
    valida: okMillesimi && okTeste,
    tesateRichieste: Math.ceil(tesateRichieste),
    millesimiRichiesti,
    regola: 'Seconda convocazione (art. 1136 c.3): 1/3 del valore (334 mill.) e 1/3 dei partecipanti.',
    dettaglio: `Presenti ${i.presentiTeste}/${i.partecipantiTotali} teste e ${i.presentiMillesimi.toFixed(2)}/${i.millesimiTotali} millesimi.`,
  };
}

export interface InputDelibera {
  convocazione: 1 | 2;
  tipoMaggioranza: TipoMaggioranza;
  partecipantiTotali: number;
  presentiTeste: number;
  favorevoliTeste: number;
  favorevoliMillesimi: number;
}

export interface EsitoDelibera {
  approvata: boolean;
  millesimiRichiesti: number;
  tesateRichieste: number;
  regola: RegolaMaggioranza;
  dettaglio: string;
  motivazione: string;
}

// Quorum deliberativo
export function verificaDelibera(i: InputDelibera): EsitoDelibera {
  const regola = REGOLE_MAGGIORANZA[i.tipoMaggioranza];

  if (regola.richiedeUnanimita) {
    const approvata =
      i.favorevoliTeste >= i.partecipantiTotali &&
      i.favorevoliMillesimi >= TOTALE_MILLESIMI - 0.01;
    return {
      approvata,
      millesimiRichiesti: TOTALE_MILLESIMI,
      tesateRichieste: i.partecipantiTotali,
      regola,
      dettaglio: `Favorevoli ${i.favorevoliTeste}/${i.partecipantiTotali} teste e ${i.favorevoliMillesimi.toFixed(2)}/1000 millesimi.`,
      motivazione: approvata
        ? 'Raggiunta l\'unanimità richiesta.'
        : 'Non raggiunta l\'unanimità: tutti i condomini devono esprimere voto favorevole.',
    };
  }

  const millesimiRichiesti =
    i.convocazione === 1 ? regola.millesimiPrima : regola.millesimiSeconda;

  // "Maggioranza degli intervenuti": numero di voti favorevoli > metà dei presenti.
  const tesateRichieste = Math.floor(i.presentiTeste / 2) + 1;
  const okTeste = i.favorevoliTeste >= tesateRichieste;
  const okMillesimi = i.favorevoliMillesimi >= millesimiRichiesti - 0.01;
  const approvata = okTeste && okMillesimi;

  let motivazione: string;
  if (approvata) {
    motivazione = 'Delibera approvata: raggiunta la maggioranza degli intervenuti e la soglia di millesimi richiesta.';
  } else if (!okTeste && !okMillesimi) {
    motivazione = 'Delibera respinta: non raggiunte né la maggioranza degli intervenuti né la soglia di millesimi.';
  } else if (!okTeste) {
    motivazione = 'Delibera respinta: non raggiunta la maggioranza degli intervenuti (numero di voti favorevoli insufficiente).';
  } else {
    motivazione = 'Delibera respinta: non raggiunta la soglia di millesimi richiesta.';
  }

  return {
    approvata,
    millesimiRichiesti,
    tesateRichieste,
    regola,
    dettaglio: `Favorevoli ${i.favorevoliTeste}/${i.presentiTeste} teste presenti e ${i.favorevoliMillesimi.toFixed(2)} millesimi (richiesti: ${tesateRichieste} teste e ${millesimiRichiesti.toFixed(2)} millesimi).`,
    motivazione,
  };
}
