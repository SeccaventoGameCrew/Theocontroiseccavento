import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState, InfoBox } from '@/components/ui';
import { Collapsible, SubmitButton, ConfirmSubmit } from '@/components/forms';
import { euro, dataIt } from '@/lib/format';
import {
  aggiornaCondominio,
  creaNuovoCondominio,
  salvaAmministratore,
  creaMandato,
  eliminaMandato,
} from './actions';

export const dynamic = 'force-dynamic';

function inputDate(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

export default async function ImpostazioniPage() {
  const condominioId = await getCondominioId();
  if (!condominioId) {
    return (
      <div className="space-y-6">
        <PageHeader titolo="Impostazioni" />
        <Card titolo="Crea il primo condominio">
          <NuovoCondominioForm />
        </Card>
      </div>
    );
  }

  const [condominio, amministratore, mandati] = await Promise.all([
    prisma.condominio.findUnique({ where: { id: condominioId } }),
    prisma.amministratore.findFirst({ where: { condominioId, attuale: true } }),
    prisma.mandatoAmministratore.findMany({ where: { condominioId }, orderBy: { dataNomina: 'desc' } }),
  ]);

  if (!condominio) return <EmptyState messaggio="Condominio non trovato." />;

  return (
    <div className="space-y-6">
      <PageHeader titolo="Condominio e amministratore" sottotitolo="Dati del condominio, dell'amministratore e storico dei mandati." />

      {/* Dati condominio */}
      <Card titolo="Dati del condominio">
        <form action={aggiornaCondominio} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="col-span-2"><label className="label">Denominazione</label><input name="denominazione" className="input" defaultValue={condominio.denominazione} required /></div>
          <div><label className="label">Codice fiscale</label><input name="codiceFiscale" className="input" defaultValue={condominio.codiceFiscale ?? ''} /></div>
          <div className="col-span-2"><label className="label">Indirizzo</label><input name="indirizzo" className="input" defaultValue={condominio.indirizzo} required /></div>
          <div><label className="label">CAP</label><input name="cap" className="input" defaultValue={condominio.cap ?? ''} /></div>
          <div><label className="label">Città</label><input name="citta" className="input" defaultValue={condominio.citta ?? ''} /></div>
          <div><label className="label">Provincia</label><input name="provincia" className="input" defaultValue={condominio.provincia ?? ''} /></div>
          <div><label className="label">Data costituzione</label><input name="dataCostituzione" type="date" className="input" defaultValue={inputDate(condominio.dataCostituzione)} /></div>
          <div>
            <label className="label">Tipo regolamento</label>
            <select name="tipoRegolamento" className="input" defaultValue={condominio.tipoRegolamento}>
              <option value="assembleare">Assembleare</option>
              <option value="contrattuale">Contrattuale</option>
              <option value="nessuno">Nessuno (&lt; 11 condomini)</option>
            </select>
          </div>
          <div className="col-span-2 md:col-span-3"><label className="label">Note</label><input name="note" className="input" defaultValue={condominio.note ?? ''} /></div>
          <div className="col-span-2 md:col-span-3"><SubmitButton>Salva dati condominio</SubmitButton></div>
        </form>
      </Card>

      <InfoBox titolo="Obbligo di nomina dell'amministratore — art. 1129 c.c.">
        La nomina dell'amministratore è <strong>obbligatoria quando i condomini sono più di otto</strong>. L'amministratore dura
        in carica <strong>un anno</strong> e si intende rinnovato per uguale durata. Deve comunicare i propri dati, i locali dove
        si trovano i registri e, su richiesta dell'assemblea, stipulare <strong>polizza di responsabilità civile</strong>
        professionale. È tenuto ad aprire uno specifico <strong>conto corrente intestato al condominio</strong>.
      </InfoBox>

      {/* Amministratore */}
      <Card titolo="Amministratore in carica">
        <form action={salvaAmministratore} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <input type="hidden" name="id" value={amministratore?.id ?? ''} />
          <div><label className="label">Nome</label><input name="nome" className="input" defaultValue={amministratore?.nome ?? ''} required /></div>
          <div><label className="label">Cognome</label><input name="cognome" className="input" defaultValue={amministratore?.cognome ?? ''} required /></div>
          <div><label className="label">Codice fiscale</label><input name="codiceFiscale" className="input" defaultValue={amministratore?.codiceFiscale ?? ''} /></div>
          <div><label className="label">Partita IVA</label><input name="partitaIva" className="input" defaultValue={amministratore?.partitaIva ?? ''} /></div>
          <div><label className="label">PEC</label><input name="pec" className="input" defaultValue={amministratore?.pec ?? ''} /></div>
          <div><label className="label">Email</label><input name="email" className="input" defaultValue={amministratore?.email ?? ''} /></div>
          <div><label className="label">Telefono</label><input name="telefono" className="input" defaultValue={amministratore?.telefono ?? ''} /></div>
          <div><label className="label">N. iscrizione / formazione</label><input name="numeroIscrizione" className="input" defaultValue={amministratore?.numeroIscrizione ?? ''} /></div>
          <div><label className="label">Polizza RC n.</label><input name="polizzaRcNumero" className="input" defaultValue={amministratore?.polizzaRcNumero ?? ''} /></div>
          <div><label className="label">Massimale polizza (€)</label><input name="polizzaRcMassimale" type="number" step="0.01" className="input" defaultValue={amministratore?.polizzaRcMassimale ?? ''} /></div>
          <div><label className="label">Scadenza polizza</label><input name="polizzaRcScadenza" type="date" className="input" defaultValue={inputDate(amministratore?.polizzaRcScadenza)} /></div>
          <div className="col-span-2 md:col-span-3"><SubmitButton>Salva amministratore</SubmitButton></div>
        </form>
      </Card>

      {/* Mandati */}
      <Card titolo="Storico mandati (registro nomina/revoca)">
        {mandati.length === 0 ? <EmptyState messaggio="Nessun mandato registrato." /> : (
          <table className="table-base">
            <thead><tr><th>Nominativo</th><th>Nomina</th><th>Scadenza</th><th>Revoca</th><th className="text-right">Compenso</th><th></th></tr></thead>
            <tbody>
              {mandati.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium text-slate-700">{m.nominativo}</td>
                  <td className="text-xs">{dataIt(m.dataNomina)}</td>
                  <td className="text-xs">{dataIt(m.dataScadenza)}</td>
                  <td className="text-xs">{m.dataRevoca ? <Badge tono="rosso">{dataIt(m.dataRevoca)}</Badge> : <Badge tono="verde">in corso</Badge>}</td>
                  <td className="text-right text-xs">{m.compensoAnnuo ? euro(m.compensoAnnuo) : '—'}</td>
                  <td><form action={eliminaMandato}><input type="hidden" name="id" value={m.id} /><ConfirmSubmit /></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-3">
          <Collapsible titolo="Registra mandato">
            <form action={creaMandato} className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="col-span-2"><label className="label">Nominativo</label><input name="nominativo" className="input" required /></div>
              <div><label className="label">Compenso annuo (€)</label><input name="compensoAnnuo" type="number" step="0.01" className="input" /></div>
              <div><label className="label">Data nomina</label><input name="dataNomina" type="date" className="input" required /></div>
              <div><label className="label">Data scadenza</label><input name="dataScadenza" type="date" className="input" /></div>
              <div><label className="label">Data revoca</label><input name="dataRevoca" type="date" className="input" /></div>
              <div className="col-span-2 md:col-span-3"><label className="label">Riferimento delibera</label><input name="deliberaRif" className="input" placeholder="Verbale assemblea del …, punto …" /></div>
              <div className="col-span-2 md:col-span-3"><SubmitButton>Registra mandato</SubmitButton></div>
            </form>
          </Collapsible>
        </div>
      </Card>

      {/* Nuovo condominio */}
      <Card titolo="Gestisci un altro condominio">
        <NuovoCondominioForm />
      </Card>
    </div>
  );
}

function NuovoCondominioForm() {
  return (
    <form action={creaNuovoCondominio} className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <div className="col-span-2"><label className="label">Denominazione</label><input name="denominazione" className="input" required /></div>
      <div><label className="label">Codice fiscale</label><input name="codiceFiscale" className="input" /></div>
      <div className="col-span-2"><label className="label">Indirizzo</label><input name="indirizzo" className="input" required /></div>
      <div><label className="label">Città</label><input name="citta" className="input" /></div>
      <div><label className="label">Provincia</label><input name="provincia" className="input" /></div>
      <div className="col-span-2 md:col-span-3"><SubmitButton>Crea condominio</SubmitButton></div>
    </form>
  );
}
