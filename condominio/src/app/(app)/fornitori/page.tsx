import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState } from '@/components/ui';
import { Collapsible, SubmitButton, ConfirmSubmit } from '@/components/forms';
import { euro, dataIt, giorniAllaData } from '@/lib/format';
import { creaFornitore, eliminaFornitore, creaContratto, eliminaContratto, creaImpianto, eliminaImpianto } from './actions';

export const dynamic = 'force-dynamic';

export default async function FornitoriPage() {
  const condominioId = await getCondominioId();
  if (!condominioId) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const [fornitori, contratti, impianti] = await Promise.all([
    prisma.fornitore.findMany({ where: { condominioId }, orderBy: { ragioneSociale: 'asc' } }),
    prisma.contratto.findMany({ where: { condominioId }, orderBy: { dataScadenza: 'asc' }, include: { fornitore: true } }),
    prisma.impianto.findMany({ where: { condominioId }, orderBy: { prossimaVerifica: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader titolo="Fornitori, contratti e impianti" sottotitolo="Anagrafica fornitori, scadenze contrattuali e verifiche periodiche di sicurezza degli impianti." />

      {/* IMPIANTI */}
      <Card titolo={`Impianti e verifiche di sicurezza (${impianti.length})`}>
        {impianti.length === 0 ? (
          <EmptyState messaggio="Nessun impianto registrato." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Impianto</th><th>Ultima verifica</th><th>Prossima verifica</th><th>Periodicità</th><th>Ente</th><th></th></tr></thead>
              <tbody>
                {impianti.map((i) => {
                  const g = giorniAllaData(i.prossimaVerifica);
                  return (
                    <tr key={i.id}>
                      <td className="font-medium text-slate-700">{i.descrizione}<div className="text-xs text-slate-400">{i.tipo.replace('_', ' ')}</div></td>
                      <td className="text-xs">{dataIt(i.ultimaVerifica)}</td>
                      <td className="text-xs">{dataIt(i.prossimaVerifica)} {g !== null && <Badge tono={g < 0 ? 'rosso' : g <= 30 ? 'giallo' : 'verde'}>{g < 0 ? `scaduta ${-g}g` : `tra ${g}g`}</Badge>}</td>
                      <td className="text-xs">{i.periodicitaMesi ? `${i.periodicitaMesi} mesi` : '—'}</td>
                      <td className="text-xs">{i.enteVerificatore ?? '—'}</td>
                      <td><form action={eliminaImpianto}><input type="hidden" name="id" value={i.id} /><ConfirmSubmit /></form></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Collapsible titolo="Aggiungi impianto">
        <form action={creaImpianto} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input">
              <option value="ascensore">Ascensore</option><option value="centrale_termica">Centrale termica</option>
              <option value="antincendio">Antincendio</option><option value="elettrico">Elettrico</option>
              <option value="idrico">Idrico</option><option value="fotovoltaico">Fotovoltaico</option>
              <option value="cancello">Cancello automatico</option><option value="altro">Altro</option>
            </select>
          </div>
          <div className="col-span-2"><label className="label">Descrizione</label><input name="descrizione" className="input" required /></div>
          <div><label className="label">Periodicità (mesi)</label><input name="periodicitaMesi" type="number" className="input" /></div>
          <div><label className="label">Ultima verifica</label><input name="ultimaVerifica" type="date" className="input" /></div>
          <div><label className="label">Prossima verifica</label><input name="prossimaVerifica" type="date" className="input" /></div>
          <div className="col-span-2"><label className="label">Ente verificatore</label><input name="enteVerificatore" className="input" /></div>
          <div className="col-span-2 md:col-span-4"><SubmitButton>Aggiungi impianto</SubmitButton></div>
        </form>
      </Collapsible>

      {/* CONTRATTI */}
      <Card titolo={`Contratti (${contratti.length})`}>
        {contratti.length === 0 ? (
          <EmptyState messaggio="Nessun contratto registrato." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Oggetto</th><th>Fornitore</th><th>Tipo</th><th>Scadenza</th><th className="text-right">Importo annuo</th><th>Rinnovo</th><th></th></tr></thead>
              <tbody>
                {contratti.map((c) => {
                  const g = giorniAllaData(c.dataScadenza);
                  return (
                    <tr key={c.id}>
                      <td className="font-medium text-slate-700">{c.oggetto}</td>
                      <td className="text-xs">{c.fornitore?.ragioneSociale ?? '—'}</td>
                      <td><Badge tono="neutro">{c.tipo}</Badge></td>
                      <td className="text-xs">{dataIt(c.dataScadenza)} {g !== null && <Badge tono={g < 0 ? 'rosso' : g <= 60 ? 'giallo' : 'verde'}>{g < 0 ? 'scaduto' : `${g}g`}</Badge>}</td>
                      <td className="text-right">{c.importoAnnuo ? euro(c.importoAnnuo) : '—'}</td>
                      <td>{c.rinnovoTacito ? <Badge tono="giallo">tacito</Badge> : <Badge tono="neutro">no</Badge>}</td>
                      <td><form action={eliminaContratto}><input type="hidden" name="id" value={c.id} /><ConfirmSubmit /></form></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Collapsible titolo="Aggiungi contratto">
        <form action={creaContratto} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2"><label className="label">Oggetto</label><input name="oggetto" className="input" required /></div>
          <div>
            <label className="label">Fornitore</label>
            <select name="fornitoreId" className="input"><option value="">—</option>{fornitori.map((f) => <option key={f.id} value={f.id}>{f.ragioneSociale}</option>)}</select>
          </div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input"><option value="manutenzione">Manutenzione</option><option value="assicurazione">Assicurazione</option><option value="fornitura">Fornitura</option><option value="servizio">Servizio</option></select>
          </div>
          <div><label className="label">Data inizio</label><input name="dataInizio" type="date" className="input" /></div>
          <div><label className="label">Data scadenza</label><input name="dataScadenza" type="date" className="input" /></div>
          <div><label className="label">Importo annuo (€)</label><input name="importoAnnuo" type="number" step="0.01" className="input" /></div>
          <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="rinnovoTacito" /> rinnovo tacito</label></div>
          <div className="col-span-2 md:col-span-4"><SubmitButton>Aggiungi contratto</SubmitButton></div>
        </form>
      </Collapsible>

      {/* FORNITORI */}
      <Card titolo={`Fornitori (${fornitori.length})`}>
        {fornitori.length === 0 ? (
          <EmptyState messaggio="Nessun fornitore registrato." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Ragione sociale</th><th>Categoria</th><th>P.IVA</th><th>Contatti</th><th>IBAN</th><th></th></tr></thead>
              <tbody>
                {fornitori.map((f) => (
                  <tr key={f.id}>
                    <td className="font-medium text-slate-700">{f.ragioneSociale}</td>
                    <td className="text-xs">{f.categoria ?? '—'}</td>
                    <td className="text-xs">{f.partitaIva ?? '—'}</td>
                    <td className="text-xs">{[f.email, f.telefono].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="text-xs">{f.iban ?? '—'}</td>
                    <td><form action={eliminaFornitore}><input type="hidden" name="id" value={f.id} /><ConfirmSubmit /></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Collapsible titolo="Aggiungi fornitore">
        <form action={creaFornitore} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2"><label className="label">Ragione sociale</label><input name="ragioneSociale" className="input" required /></div>
          <div><label className="label">Categoria</label><input name="categoria" className="input" placeholder="Ascensori, Pulizie…" /></div>
          <div><label className="label">Partita IVA</label><input name="partitaIva" className="input" /></div>
          <div><label className="label">Referente</label><input name="referente" className="input" /></div>
          <div><label className="label">Telefono</label><input name="telefono" className="input" /></div>
          <div><label className="label">Email</label><input name="email" type="email" className="input" /></div>
          <div><label className="label">PEC</label><input name="pec" className="input" /></div>
          <div className="col-span-2"><label className="label">IBAN</label><input name="iban" className="input" /></div>
          <div className="col-span-2 md:col-span-4"><SubmitButton>Aggiungi fornitore</SubmitButton></div>
        </form>
      </Collapsible>
    </div>
  );
}
