import { PageHeader, Card, Badge, InfoBox } from '@/components/ui';
import { REGOLE_MAGGIORANZA } from '@/lib/agenti/assembleare';

export const dynamic = 'force-dynamic';

function Art({ rif, children }: { rif: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <div className="mb-1"><Badge tono="blu">{rif}</Badge></div>
      <div className="text-sm text-slate-600">{children}</div>
    </div>
  );
}

export default function NormativaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        titolo="Guida normativa"
        sottotitolo="Quadro di riferimento per la gestione del condominio in Italia. Sintesi a fini operativi, non sostitutiva della consulenza professionale."
      />

      <InfoBox titolo="Fonti principali">
        Codice Civile, Libro III, Titolo VII, Capo II (<strong>artt. 1117-1139</strong>) · Disposizioni di attuazione del
        Codice Civile (<strong>artt. 61-72</strong>) · <strong>L. 220/2012</strong> (Riforma del condominio) · Reg. UE 2016/679
        (GDPR) · DPR 600/1973 (sostituto d'imposta) · DPR 162/1999 (ascensori) · DPR 74/2013 (impianti termici).
      </InfoBox>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card titolo="Parti comuni e condominio">
          <Art rif="Art. 1117 c.c.">Sono oggetto di proprietà comune (salvo titolo contrario) suolo, fondazioni, muri maestri, tetti, scale, portoni, cortili, impianti e servizi comuni fino al punto di diramazione verso le singole unità.</Art>
          <Art rif="Art. 1117-bis c.c.">Il supercondominio: le norme si applicano quando più condominii condividono parti comuni.</Art>
          <Art rif="Art. 1118 c.c.">Il condomino non può rinunciare al diritto sulle parti comuni né sottrarsi alle spese per la loro conservazione; è prevista la facoltà di distacco dall'impianto centralizzato di riscaldamento a determinate condizioni.</Art>
        </Card>

        <Card titolo="Amministratore">
          <Art rif="Art. 1129 c.c.">Nomina obbligatoria se i condomini sono più di otto. Durata annuale con rinnovo tacito. Obblighi: comunicazione dati, conto corrente intestato al condominio, rendiconto, polizza RC su richiesta dell'assemblea, azione di riscossione entro 6 mesi dalla chiusura dell'esercizio.</Art>
          <Art rif="Art. 1130 c.c.">Attribuzioni: esecuzione delibere, riscossione contributi, erogazione spese, tenuta dei quattro registri (anagrafe, verbali, nomina/revoca, contabilità), rendiconto annuale.</Art>
          <Art rif="D.M. 140/2014">Requisiti di onorabilità e professionalità; obbligo di formazione iniziale e periodica dell'amministratore.</Art>
        </Card>

        <Card titolo="Assemblea: costituzione e deliberazione">
          <Art rif="Art. 1135 c.c.">Competenze dell'assemblea: conferma amministratore e compenso, approvazione preventivo e rendiconto, opere di manutenzione straordinaria (con costituzione di fondo speciale di importo pari alla spesa).</Art>
          <Art rif="Art. 1136 c.1-3 c.c.">Quorum costitutivo — 1ª convocazione: 2/3 del valore (667 mill.) e maggioranza dei partecipanti; 2ª convocazione: 1/3 del valore (334 mill.) e 1/3 dei partecipanti.</Art>
          <Art rif="Art. 66-67 disp. att. c.c.">Convocazione almeno 5 giorni prima (racc./PEC/fax/mani); disciplina delle deleghe (limite di 1/5 oltre i 20 condomini).</Art>
        </Card>

        <Card titolo="Le maggioranze deliberative">
          {Object.values(REGOLE_MAGGIORANZA).map((r) => (
            <Art key={r.codice} rif={r.riferimento}>
              <strong>{r.etichetta}.</strong> {r.descrizione}
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">
                {r.esempi.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </Art>
          ))}
        </Card>

        <Card titolo="Ripartizione delle spese">
          <Art rif="Art. 1123 c.c.">Le spese sono ripartite in proporzione al valore della proprietà (c.1); per cose destinate a servire in misura diversa, in proporzione all'uso (c.2); se un edificio ha più scale/cortili/impianti destinati a servire una parte, le spese sono a carico del gruppo che ne trae utilità (c.3).</Art>
          <Art rif="Art. 1124 c.c.">Scale e ascensori: spese di manutenzione e sostituzione ripartite per metà in base al valore (millesimi) e per metà in rapporto all'altezza di piano.</Art>
          <Art rif="Art. 1126 c.c.">Lastrici solari di uso esclusivo: 1/3 a chi ne ha l'uso, 2/3 ai condomini dell'edificio/parte coperta.</Art>
          <Art rif="Artt. 68-69 disp. att. c.c.">Tabelle millesimali: la revisione/modifica richiede l'unanimità, salvo errore o mutata consistenza &gt; 1/5 (maggioranza art. 1136 c.2).</Art>
        </Card>

        <Card titolo="Rendiconto e contabilità">
          <Art rif="Art. 1130-bis c.c.">Il rendiconto comprende registro di contabilità, riepilogo finanziario e nota sintetica esplicativa. I condomini e i titolari di diritti possono prenderne visione ed estrarne copia.</Art>
          <Art rif="Art. 1130 n.10 c.c.">Redazione del rendiconto annuale e convocazione dell'assemblea per la relativa approvazione entro 180 giorni.</Art>
          <Art rif="Art. 63 disp. att. c.c.">Riscossione: l'amministratore può ottenere decreto ingiuntivo immediatamente esecutivo; i creditori possono agire sui morosi prima che sui condomini in regola.</Art>
        </Card>

        <Card titolo="Adempimenti fiscali">
          <Art rif="Art. 25-ter DPR 600/1973">Il condominio è sostituto d'imposta: ritenuta del 4% sui corrispettivi per prestazioni relative a contratti di appalto/opera.</Art>
          <Art rif="Modello 770 / CU">Dichiarazione del sostituto d'imposta e rilascio della Certificazione Unica ai percipienti.</Art>
          <Art rif="Bonus edilizi">Comunicazione all'Agenzia delle Entrate dei dati degli interventi che danno diritto a detrazione fiscale sulle parti comuni.</Art>
        </Card>

        <Card titolo="Sicurezza impianti e privacy">
          <Art rif="DPR 162/1999">Ascensori: verifiche periodiche biennali da organismo notificato e manutenzione da ditta abilitata.</Art>
          <Art rif="DPR 74/2013">Impianti termici: libretto di impianto, controlli di efficienza energetica e rapporti di controllo.</Art>
          <Art rif="Reg. UE 2016/679">GDPR: il condominio è titolare del trattamento dei dati dei condomini; principi di minimizzazione, limitazione delle finalità e della conservazione; divieto di diffusione a terzi estranei.</Art>
        </Card>
      </div>

      <p className="text-center text-xs text-slate-400">
        Le informazioni hanno finalità operativa e divulgativa e possono non riflettere aggiornamenti normativi successivi.
        Per decisioni con effetti giuridici rivolgersi a un amministratore professionista o a un legale.
      </p>
    </div>
  );
}
