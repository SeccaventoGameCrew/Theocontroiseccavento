# Gestione Condominio

Applicazione web per la **gestione completa di un condominio in Italia**, sviluppata con attenzione agli adempimenti normativi (Codice Civile artt. 1117‑1139, disposizioni di attuazione artt. 61‑72, L. 220/2012, GDPR, obblighi fiscali del condominio quale sostituto d'imposta).

Non è un semplice gestionale di dati: include **agenti di gestione** (motori automatici) che eseguono i calcoli normativamente rilevanti — ripartizione delle spese, quorum assembleari, rendiconto, morosità e scadenzario degli adempimenti.

---

## Funzionalità

| Modulo | Descrizione | Riferimenti normativi |
|---|---|---|
| **Cruscotto** | Sintesi: unità, millesimi, morosità, scadenze, prossima assemblea, incassi | — |
| **Anagrafe condominiale** | Soggetti, unità immobiliari, dati catastali, titolarità (proprietà, usufrutto, locazione) | art. 1130 n.6 c.c. |
| **Tabelle millesimali** | Tabelle multiple (proprietà, ascensore, scala…) con editor quote e controllo quadratura | artt. 1123‑1124, 68‑69 disp. att. |
| **Gestione economica** | Esercizi, spese, categorie, rate, pagamenti | artt. 1130, 1135 c.c. |
| → *Agente Ripartizione* | Riparto automatico delle spese per unità secondo le tabelle | art. 1123 c.c. |
| → *Agente Rendiconto* | Registro di contabilità + riepilogo finanziario (situazione patrimoniale) | art. 1130‑bis c.c. |
| → *Agente Morosità* | Posizioni dei condomini, solleciti generati automaticamente | art. 63 disp. att., art. 1129 c.9 |
| **Assemblee** | Convocazione, ordine del giorno, **simulatore quorum**, verbale | artt. 1135‑1136 c.c., 66‑67 disp. att. |
| → *Agente Assembleare* | Calcolo quorum costitutivo e deliberativo, generazione convocazione/verbale | art. 1136 c.c. |
| **Scadenzario** | Adempimenti gestionali, tecnici e fiscali aggregati | art. 1129 c.c., DPR 162/99, DPR 600/73 |
| **Fornitori e impianti** | Anagrafica, contratti con scadenze, verifiche periodiche di sicurezza | DPR 162/99, DPR 74/2013 |
| **Registri obbligatori** | I 4 registri dell'amministratore, generati dai dati | art. 1130 n.4, 6, 7 c.c. |
| **Privacy / GDPR** | Registro delle attività di trattamento | Reg. UE 2016/679 |
| **Condominio e amministratore** | Dati, polizza RC, storico mandati | art. 1129 c.c. |
| **Guida normativa** | Quadro di riferimento sintetico in app | — |

La documentazione normativa estesa è in [`docs/NORMATIVA.md`](docs/NORMATIVA.md).

---

## Stack tecnico

- **Next.js 14** (App Router, Server Components, Server Actions) + **TypeScript**
- **Prisma ORM** + **SQLite** (nessun server di database esterno richiesto)
- **Tailwind CSS**
- Autenticazione a cookie firmato (HMAC) — *dimostrativa*

## Avvio rapido

```bash
cd condominio
npm install
npm run setup     # prisma generate + db push + seed con dati dimostrativi
npm run dev       # http://localhost:3000
```

Accesso dimostrativo: **admin@condominio.it** / **condominio2026** (configurabili in `.env`).

### Comandi utili

```bash
npm run build       # build di produzione
npm run start       # avvio in produzione
npm run db:seed     # ricarica i dati dimostrativi
npm run db:reset    # azzera e ricarica il database
```

I dati dimostrativi creano un condominio realistico di 6 unità con amministratore, tabelle millesimali, un esercizio contabile con spese/rate/pagamenti (inclusi due condomini morosi), fornitori, contratti, impianti e un'assemblea con ordine del giorno.

---

## Architettura

```
condominio/
├── prisma/
│   ├── schema.prisma        # modello dati (annotato con i riferimenti normativi)
│   └── seed.ts              # dati dimostrativi
├── src/
│   ├── app/
│   │   ├── (app)/           # area autenticata: un modulo per cartella
│   │   ├── login/           # accesso
│   │   └── actions/         # server actions di sistema e autenticazione
│   ├── components/          # UI riutilizzabile (server + client)
│   └── lib/
│       ├── agenti/          # i motori: ripartizione, assembleare, morosità, rendiconto, scadenzario, documenti
│       ├── auth.ts          # sessione
│       ├── db.ts            # client Prisma
│       └── format.ts        # formattazione it-IT (euro, date, millesimi)
└── docs/NORMATIVA.md        # guida normativa estesa
```

I motori in `src/lib/agenti/` sono funzioni pure/isolate: contengono la logica normativa (es. le soglie dei quorum dell'art. 1136 c.c.) e sono testabili indipendentemente dall'interfaccia.

---

## Avvertenza

Applicazione a scopo gestionale e dimostrativo. I calcoli normativi (quorum, riparti, scadenze) sono strumenti di supporto e **non sostituiscono la consulenza di un amministratore professionista o di un legale**. Prima di un uso in produzione occorrono: autenticazione multi‑utente con password hashate e ruoli, gestione documentale con upload reale, backup, e verifica degli aggiornamenti normativi.
