import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function d(s: string): Date {
  return new Date(s + 'T00:00:00');
}

async function main() {
  console.log('Seed in corso…');

  // Pulizia (ordine rispettoso dei vincoli)
  await prisma.pagamento.deleteMany();
  await prisma.rata.deleteMany();
  await prisma.vocePreventivo.deleteMany();
  await prisma.spesa.deleteMany();
  await prisma.categoriaSpesa.deleteMany();
  await prisma.esercizio.deleteMany();
  await prisma.quotaMillesimale.deleteMany();
  await prisma.tabellaMillesimale.deleteMany();
  await prisma.titolarita.deleteMany();
  await prisma.unitaImmobiliare.deleteMany();
  await prisma.condomino.deleteMany();
  await prisma.partecipazione.deleteMany();
  await prisma.puntoOdg.deleteMany();
  await prisma.assemblea.deleteMany();
  await prisma.contratto.deleteMany();
  await prisma.impianto.deleteMany();
  await prisma.fornitore.deleteMany();
  await prisma.documento.deleteMany();
  await prisma.trattamentoDati.deleteMany();
  await prisma.mandatoAmministratore.deleteMany();
  await prisma.amministratore.deleteMany();
  await prisma.condominio.deleteMany();
  await prisma.user.deleteMany();

  // Utente amministratore (login tramite variabili d'ambiente; hash dimostrativo)
  await prisma.user.create({
    data: {
      email: process.env.ADMIN_EMAIL || 'admin@condominio.it',
      passwordHash: crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD || 'condominio2026').digest('hex'),
      nome: 'Amministratore Demo',
      ruolo: 'amministratore',
    },
  });

  // Condominio
  const cond = await prisma.condominio.create({
    data: {
      denominazione: 'Condominio Via Giuseppe Verdi 15',
      codiceFiscale: '97654321001',
      indirizzo: 'Via Giuseppe Verdi 15',
      cap: '20121',
      citta: 'Milano',
      provincia: 'MI',
      dataCostituzione: d('1998-05-10'),
      tipoRegolamento: 'contrattuale',
      note: 'Edificio di 6 unità, 5 piani, con ascensore.',
    },
  });

  // Amministratore + mandato
  await prisma.amministratore.create({
    data: {
      condominioId: cond.id,
      nome: 'Laura',
      cognome: 'Bianchi',
      codiceFiscale: 'BNCLRA75A41F205X',
      partitaIva: '09876543210',
      pec: 'laura.bianchi@pec.it',
      email: 'studio.bianchi@amministrazioni.it',
      telefono: '02 1234567',
      numeroIscrizione: 'ANACI-MI-2015-0421',
      polizzaRcNumero: 'POL-RC-998877',
      polizzaRcMassimale: 1000000,
      polizzaRcScadenza: d('2026-12-31'),
      attuale: true,
    },
  });
  await prisma.mandatoAmministratore.create({
    data: {
      condominioId: cond.id,
      nominativo: 'Laura Bianchi',
      dataNomina: d('2025-06-20'),
      dataScadenza: d('2026-06-20'),
      compensoAnnuo: 3600,
      deliberaRif: 'Verbale assemblea ordinaria del 20/06/2025, punto 4',
    },
  });

  // Condomini (persone) + unità + titolarità
  const persone = [
    { nome: 'Marco', cognome: 'Rossi', cf: 'RSSMRC70A01F205A', email: 'marco.rossi@email.it' },
    { nome: 'Giulia', cognome: 'Ferrari', cf: 'FRRGLI82C45F205B', email: 'giulia.ferrari@email.it' },
    { nome: 'Antonio', cognome: 'Esposito', cf: 'SPSNTN65M12F205C', email: 'antonio.esposito@email.it' },
    { nome: 'Francesca', cognome: 'Russo', cf: 'RSSFNC78E55F205D', email: 'francesca.russo@email.it' },
    { nome: 'Luca', cognome: 'Colombo', cf: 'CLMLCU69H20F205E', email: 'luca.colombo@email.it' },
    { ragioneSociale: 'Immobiliare Aurora S.r.l.', tipo: 'giuridica', piva: '03344556677', email: 'info@aurorasrl.it' },
  ];

  const unitaDef = [
    { den: 'Interno 1', piano: 'Terra', mProp: 180, mAsc: 120 },
    { den: 'Interno 2', piano: '1', mProp: 170, mAsc: 150 },
    { den: 'Interno 3', piano: '2', mProp: 160, mAsc: 170 },
    { den: 'Interno 4', piano: '3', mProp: 165, mAsc: 180 },
    { den: 'Interno 5', piano: '4', mProp: 150, mAsc: 190 },
    { den: 'Interno 6', piano: '5', mProp: 175, mAsc: 190 },
  ];

  const condomini = [];
  for (const p of persone) {
    const c = await prisma.condomino.create({
      data: {
        condominioId: cond.id,
        tipoPersona: p.tipo === 'giuridica' ? 'giuridica' : 'fisica',
        nome: p.nome,
        cognome: p.cognome,
        ragioneSociale: p.ragioneSociale,
        codiceFiscale: p.cf,
        partitaIva: p.piva,
        email: p.email,
        indirizzo: 'Via Giuseppe Verdi 15',
        cap: '20121',
        citta: 'Milano',
        provincia: 'MI',
      },
    });
    condomini.push(c);
  }

  const unita = [];
  for (let i = 0; i < unitaDef.length; i++) {
    const u = await prisma.unitaImmobiliare.create({
      data: {
        condominioId: cond.id,
        denominazione: unitaDef[i].den,
        tipo: 'appartamento',
        scala: 'A',
        piano: unitaDef[i].piano,
        superficie: 80 + i * 5,
        catastoFoglio: '12',
        catastoParticella: '340',
        catastoSub: String(i + 1),
      },
    });
    unita.push(u);
    await prisma.titolarita.create({
      data: { unitaId: u.id, condominoId: condomini[i].id, tipo: 'proprietario', quota: 100, dataInizio: d('2000-01-01') },
    });
  }

  // Tabelle millesimali
  const tabProp = await prisma.tabellaMillesimale.create({
    data: { condominioId: cond.id, nome: 'Proprietà generale', tipo: 'proprieta', descrizione: 'Spese generali ripartite per quota di proprietà (art. 1123 c.1 c.c.)', totale: 1000 },
  });
  const tabAsc = await prisma.tabellaMillesimale.create({
    data: { condominioId: cond.id, nome: 'Ascensore', tipo: 'ascensore', descrizione: 'Spese ascensore ripartite per metà in base ai millesimi e per metà in rapporto all\'altezza di piano (art. 1124 c.c.)', totale: 1000 },
  });

  for (let i = 0; i < unita.length; i++) {
    await prisma.quotaMillesimale.create({ data: { tabellaId: tabProp.id, unitaId: unita[i].id, millesimi: unitaDef[i].mProp } });
    await prisma.quotaMillesimale.create({ data: { tabellaId: tabAsc.id, unitaId: unita[i].id, millesimi: unitaDef[i].mAsc } });
  }

  // Categorie di spesa
  const catPulizie = await prisma.categoriaSpesa.create({ data: { condominioId: cond.id, nome: 'Pulizie parti comuni', tabellaId: tabProp.id, tipo: 'ordinaria' } });
  const catEnergia = await prisma.categoriaSpesa.create({ data: { condominioId: cond.id, nome: 'Energia elettrica parti comuni', tabellaId: tabProp.id, tipo: 'ordinaria' } });
  const catAscensore = await prisma.categoriaSpesa.create({ data: { condominioId: cond.id, nome: 'Ascensore - manutenzione', tabellaId: tabAsc.id, tipo: 'ordinaria' } });
  const catAssic = await prisma.categoriaSpesa.create({ data: { condominioId: cond.id, nome: 'Assicurazione globale fabbricati', tabellaId: tabProp.id, tipo: 'ordinaria' } });
  const catAmm = await prisma.categoriaSpesa.create({ data: { condominioId: cond.id, nome: 'Compenso amministratore', tabellaId: tabProp.id, tipo: 'ordinaria' } });

  // Fornitori
  const fAscensori = await prisma.fornitore.create({ data: { condominioId: cond.id, ragioneSociale: 'Ascensori Lombardi S.p.A.', categoria: 'Ascensori', partitaIva: '01112223334', email: 'assistenza@ascensorilombardi.it', pec: 'ascensorilombardi@pec.it' } });
  const fPulizie = await prisma.fornitore.create({ data: { condominioId: cond.id, ragioneSociale: 'Puliservice S.r.l.', categoria: 'Pulizie', partitaIva: '05556667778' } });
  const fAssic = await prisma.fornitore.create({ data: { condominioId: cond.id, ragioneSociale: 'Assicurazioni Sicure S.p.A.', categoria: 'Assicurazione', partitaIva: '08889990001' } });

  // Esercizio corrente
  const es = await prisma.esercizio.create({
    data: {
      condominioId: cond.id,
      denominazione: 'Esercizio 2025 - Gestione ordinaria',
      dataInizio: d('2025-01-01'),
      dataFine: d('2025-12-31'),
      tipo: 'ordinaria',
      stato: 'preventivo_approvato',
      fondoRiserva: 2000,
    },
  });

  const spese = [
    { data: '2025-02-10', descr: 'Pulizia scale febbraio-giugno', imp: 1800, cat: catPulizie.id, forn: fPulizie.id, pagata: true },
    { data: '2025-03-05', descr: 'Energia elettrica vani comuni 1° trimestre', imp: 620, cat: catEnergia.id, pagata: true },
    { data: '2025-04-18', descr: 'Manutenzione ordinaria ascensore 1° semestre', imp: 1400, cat: catAscensore.id, forn: fAscensori.id, pagata: true },
    { data: '2025-05-20', descr: 'Premio assicurazione globale fabbricati 2025', imp: 1900, cat: catAssic.id, forn: fAssic.id, pagata: true },
    { data: '2025-06-30', descr: 'Compenso amministratore (acconto)', imp: 1800, cat: catAmm.id, pagata: true },
    { data: '2025-09-12', descr: 'Energia elettrica vani comuni 2°-3° trimestre', imp: 740, cat: catEnergia.id, pagata: false },
    { data: '2025-10-15', descr: 'Manutenzione ordinaria ascensore 2° semestre', imp: 1400, cat: catAscensore.id, forn: fAscensori.id, pagata: false },
  ];
  for (const s of spese) {
    await prisma.spesa.create({
      data: { esercizioId: es.id, data: d(s.data), descrizione: s.descr, importo: s.imp, categoriaId: s.cat, fornitoreId: s.forn, pagata: s.pagata },
    });
  }

  // Rate: 2 rate per condomino, importo proporzionale ai millesimi (totale spese ~9660 → preventivo 10000)
  const totalePreventivo = 10000;
  for (let i = 0; i < unita.length; i++) {
    const quota = (totalePreventivo * unitaDef[i].mProp) / 1000;
    const condId = condomini[i].id;
    const r1 = await prisma.rata.create({ data: { esercizioId: es.id, condominoId: condId, numero: 1, descrizione: '1ª rata 2025 (scad. 31/03)', scadenza: d('2025-03-31'), importo: quota / 2 } });
    const r2 = await prisma.rata.create({ data: { esercizioId: es.id, condominoId: condId, numero: 2, descrizione: '2ª rata 2025 (scad. 30/09)', scadenza: d('2025-09-30'), importo: quota / 2 } });
    // Pagamenti: tutti pagano la 1ª; i condomini 3 e 6 non pagano la 2ª (morosi)
    await prisma.pagamento.create({ data: { rataId: r1.id, data: d('2025-03-20'), importo: quota / 2, metodo: 'bonifico' } });
    if (i !== 2 && i !== 5) {
      await prisma.pagamento.create({ data: { rataId: r2.id, data: d('2025-09-25'), importo: quota / 2, metodo: 'bonifico' } });
    }
  }

  // Contratti e impianti
  await prisma.contratto.create({ data: { condominioId: cond.id, fornitoreId: fAscensori.id, oggetto: 'Manutenzione ordinaria ascensore', tipo: 'manutenzione', dataInizio: d('2024-01-01'), dataScadenza: d('2026-12-31'), importoAnnuo: 2800, rinnovoTacito: true } });
  await prisma.contratto.create({ data: { condominioId: cond.id, fornitoreId: fAssic.id, oggetto: 'Polizza globale fabbricati', tipo: 'assicurazione', dataInizio: d('2025-01-01'), dataScadenza: d('2026-01-31'), importoAnnuo: 1900, rinnovoTacito: true } });
  await prisma.contratto.create({ data: { condominioId: cond.id, fornitoreId: fPulizie.id, oggetto: 'Servizio pulizia parti comuni', tipo: 'servizio', dataInizio: d('2024-07-01'), dataScadenza: d('2025-12-31'), importoAnnuo: 3600, rinnovoTacito: false } });

  await prisma.impianto.create({ data: { condominioId: cond.id, tipo: 'ascensore', descrizione: 'Ascensore scala A (6 fermate)', ultimaVerifica: d('2025-05-15'), prossimaVerifica: d('2026-05-15'), periodicitaMesi: 12, enteVerificatore: 'Organismo notificato (DPR 162/99)' } });
  await prisma.impianto.create({ data: { condominioId: cond.id, tipo: 'antincendio', descrizione: 'Estintori e segnaletica parti comuni', ultimaVerifica: d('2025-09-01'), prossimaVerifica: d('2026-03-01'), periodicitaMesi: 6, enteVerificatore: 'Ditta manutentrice abilitata' } });
  await prisma.impianto.create({ data: { condominioId: cond.id, tipo: 'elettrico', descrizione: 'Impianto elettrico parti comuni', ultimaVerifica: d('2024-11-10'), prossimaVerifica: d('2026-11-10'), periodicitaMesi: 24 } });

  // Assemblea
  const ass = await prisma.assemblea.create({
    data: {
      condominioId: cond.id,
      tipo: 'ordinaria',
      oggettoSintesi: 'Approvazione rendiconto 2025 e preventivo 2026',
      luogo: 'Sala riunioni, Via Verdi 15 - Milano',
      dataPrimaConvocazione: d('2026-06-10'),
      oraPrimaConvocazione: '08:00',
      dataSecondaConvocazione: d('2026-06-11'),
      oraSecondaConvocazione: '18:30',
      convocazioneInviata: true,
      dataInvioConvocazione: d('2026-05-25'),
      stato: 'convocata',
    },
  });
  const punti = [
    { n: 1, o: 'Nomina del presidente e del segretario dell\'assemblea', m: 'ordinaria' },
    { n: 2, o: 'Approvazione del rendiconto consuntivo dell\'esercizio 2025', m: 'ordinaria' },
    { n: 3, o: 'Approvazione del bilancio preventivo 2026 e relativo riparto', m: 'ordinaria' },
    { n: 4, o: 'Conferma/rinnovo dell\'incarico all\'amministratore e determinazione del compenso', m: 'qualificata_500' },
    { n: 5, o: 'Lavori di efficientamento energetico facciata (intervento agevolato)', m: 'qualificata_500' },
    { n: 6, o: 'Varie ed eventuali', m: 'ordinaria' },
  ];
  for (const p of punti) {
    await prisma.puntoOdg.create({ data: { assembleaId: ass.id, numero: p.n, oggetto: p.o, tipoMaggioranza: p.m } });
  }
  // Partecipazioni (precompilate con i millesimi di proprietà)
  for (let i = 0; i < condomini.length; i++) {
    await prisma.partecipazione.create({
      data: { assembleaId: ass.id, condominoId: condomini[i].id, presente: i < 5, millesimiRappresentati: unitaDef[i].mProp },
    });
  }

  // Registro trattamenti (GDPR)
  await prisma.trattamentoDati.createMany({
    data: [
      { condominioId: cond.id, finalita: 'Tenuta dell\'anagrafe condominiale', baseGiuridica: 'Obbligo legale (art. 1130 n.6 c.c.)', categorieDati: 'Dati anagrafici, dati di contatto, dati catastali, titoli di proprietà', destinatari: 'Amministratore, condomini (per le finalità di legge)', conservazione: 'Per la durata della gestione e termini di legge' },
      { condominioId: cond.id, finalita: 'Riscossione delle quote condominiali', baseGiuridica: 'Esecuzione di obbligo derivante dalla partecipazione al condominio', categorieDati: 'Dati anagrafici, dati di contatto, dati di pagamento', destinatari: 'Istituto di credito, eventuale legale per recupero crediti', conservazione: '10 anni (prescrizione ordinaria)' },
      { condominioId: cond.id, finalita: 'Gestione dei rapporti con i fornitori', baseGiuridica: 'Esecuzione del contratto', categorieDati: 'Dati identificativi e fiscali dei fornitori', destinatari: 'Amministratore, consulenti fiscali', conservazione: '10 anni (obblighi fiscali)' },
    ],
  });

  // Documenti (metadati)
  await prisma.documento.createMany({
    data: [
      { condominioId: cond.id, categoria: 'contabilita', nome: 'Rendiconto consuntivo 2024', riferimentoAnno: 2024 },
      { condominioId: cond.id, categoria: 'verbali', nome: 'Verbale assemblea ordinaria 20/06/2025', riferimentoAnno: 2025 },
      { condominioId: cond.id, categoria: 'assicurazioni', nome: 'Polizza globale fabbricati 2025', riferimentoAnno: 2025 },
      { condominioId: cond.id, categoria: 'tecnici', nome: 'Verbale verifica periodica ascensore 2025', riferimentoAnno: 2025 },
    ],
  });

  console.log('Seed completato.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
