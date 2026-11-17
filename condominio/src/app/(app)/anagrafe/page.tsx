import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState, InfoBox } from '@/components/ui';
import { Collapsible, SubmitButton, ConfirmSubmit } from '@/components/forms';
import { nomeCompleto } from '@/lib/format';
import {
  creaCondomino,
  eliminaCondomino,
  creaUnita,
  eliminaUnita,
  assegnaTitolarita,
  rimuoviTitolarita,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function AnagrafePage() {
  const condominioId = await getCondominioId();
  if (!condominioId) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const [condomini, unita] = await Promise.all([
    prisma.condomino.findMany({ where: { condominioId }, orderBy: [{ cognome: 'asc' }, { ragioneSociale: 'asc' }] }),
    prisma.unitaImmobiliare.findMany({
      where: { condominioId },
      orderBy: { denominazione: 'asc' },
      include: { titolarita: { include: { condomino: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        titolo="Anagrafe condominiale"
        sottotitolo="Registro anagrafico ai sensi dell'art. 1130 n.6 c.c.: dati dei singoli proprietari, unità immobiliari e dati catastali."
      />

      <InfoBox titolo="Obbligo di legge — art. 1130 n.6 c.c.">
        L'amministratore deve curare la tenuta del <strong>registro di anagrafe condominiale</strong> contenente le generalità
        dei singoli proprietari e dei titolari di diritti reali/personali di godimento, i dati catastali di ciascuna unità e
        ogni dato relativo alle condizioni di sicurezza delle parti comuni. Ogni variazione va comunicata entro 60 giorni.
      </InfoBox>

      {/* UNITÀ IMMOBILIARI */}
      <Card titolo={`Unità immobiliari (${unita.length})`}>
        {unita.length === 0 ? (
          <EmptyState messaggio="Nessuna unità registrata." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Unità</th>
                  <th>Piano / Scala</th>
                  <th>Dati catastali</th>
                  <th>Superficie</th>
                  <th>Titolari</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unita.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium text-slate-800">{u.denominazione}<div className="text-xs text-slate-400">{u.tipo}</div></td>
                    <td>{u.piano ?? '—'}{u.scala ? ` / Scala ${u.scala}` : ''}</td>
                    <td className="text-xs">Fg. {u.catastoFoglio ?? '—'} · Part. {u.catastoParticella ?? '—'} · Sub {u.catastoSub ?? '—'}</td>
                    <td>{u.superficie ? `${u.superficie} m²` : '—'}</td>
                    <td>
                      <div className="space-y-1">
                        {u.titolarita.length === 0 && <span className="text-xs text-amber-600">Nessun titolare</span>}
                        {u.titolarita.map((t) => (
                          <div key={t.id} className="flex items-center gap-2">
                            <Badge tono="blu">{t.tipo}</Badge>
                            <span className="text-xs">{nomeCompleto(t.condomino)} ({t.quota}%)</span>
                            <form action={rimuoviTitolarita}>
                              <input type="hidden" name="id" value={t.id} />
                              <button className="text-xs text-red-500 hover:underline" type="submit">rimuovi</button>
                            </form>
                          </div>
                        ))}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-brand-600">+ assegna titolare</summary>
                          <form action={assegnaTitolarita} className="mt-2 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="unitaId" value={u.id} />
                            <select name="condominoId" className="input max-w-[180px]" required>
                              <option value="">Seleziona…</option>
                              {condomini.map((c) => (
                                <option key={c.id} value={c.id}>{nomeCompleto(c)}</option>
                              ))}
                            </select>
                            <select name="tipo" className="input max-w-[150px]">
                              <option value="proprietario">Proprietario</option>
                              <option value="nudo_proprietario">Nudo proprietario</option>
                              <option value="usufruttuario">Usufruttuario</option>
                              <option value="conduttore">Conduttore</option>
                              <option value="comodatario">Comodatario</option>
                            </select>
                            <input name="quota" type="number" step="0.01" defaultValue="100" className="input max-w-[90px]" title="Quota %" />
                            <SubmitButton className="btn-primary btn-sm">Assegna</SubmitButton>
                          </form>
                        </details>
                      </div>
                    </td>
                    <td>
                      <form action={eliminaUnita}>
                        <input type="hidden" name="id" value={u.id} />
                        <ConfirmSubmit />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Collapsible titolo="Aggiungi unità immobiliare">
        <form action={creaUnita} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className="label">Denominazione</label><input name="denominazione" className="input" placeholder="Interno 7" required /></div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input">
              <option value="appartamento">Appartamento</option>
              <option value="box">Box / Garage</option>
              <option value="cantina">Cantina</option>
              <option value="negozio">Negozio</option>
              <option value="ufficio">Ufficio</option>
              <option value="magazzino">Magazzino</option>
              <option value="altro">Altro</option>
            </select>
          </div>
          <div><label className="label">Piano</label><input name="piano" className="input" /></div>
          <div><label className="label">Scala</label><input name="scala" className="input" /></div>
          <div><label className="label">Superficie (m²)</label><input name="superficie" type="number" step="0.01" className="input" /></div>
          <div><label className="label">Foglio</label><input name="catastoFoglio" className="input" /></div>
          <div><label className="label">Particella</label><input name="catastoParticella" className="input" /></div>
          <div><label className="label">Subalterno</label><input name="catastoSub" className="input" /></div>
          <div className="col-span-2 md:col-span-4"><SubmitButton>Aggiungi unità</SubmitButton></div>
        </form>
      </Collapsible>

      {/* CONDOMINI */}
      <Card titolo={`Soggetti (${condomini.length})`}>
        {condomini.length === 0 ? (
          <EmptyState messaggio="Nessun condomino registrato." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Nominativo</th><th>Tipo</th><th>C.F. / P.IVA</th><th>Contatti</th><th></th></tr>
              </thead>
              <tbody>
                {condomini.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-slate-800">{nomeCompleto(c)}</td>
                    <td><Badge>{c.tipoPersona}</Badge></td>
                    <td className="text-xs">{c.codiceFiscale ?? c.partitaIva ?? '—'}</td>
                    <td className="text-xs">{[c.email, c.telefono].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      <form action={eliminaCondomino}>
                        <input type="hidden" name="id" value={c.id} />
                        <ConfirmSubmit />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Collapsible titolo="Aggiungi soggetto (condomino)">
        <form action={creaCondomino} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className="label">Tipo persona</label>
            <select name="tipoPersona" className="input">
              <option value="fisica">Persona fisica</option>
              <option value="giuridica">Persona giuridica</option>
            </select>
          </div>
          <div><label className="label">Nome</label><input name="nome" className="input" /></div>
          <div><label className="label">Cognome</label><input name="cognome" className="input" /></div>
          <div><label className="label">Ragione sociale</label><input name="ragioneSociale" className="input" /></div>
          <div><label className="label">Codice fiscale</label><input name="codiceFiscale" className="input" /></div>
          <div><label className="label">Partita IVA</label><input name="partitaIva" className="input" /></div>
          <div><label className="label">Indirizzo</label><input name="indirizzo" className="input" /></div>
          <div><label className="label">Città</label><input name="citta" className="input" /></div>
          <div><label className="label">Email</label><input name="email" type="email" className="input" /></div>
          <div><label className="label">PEC</label><input name="pec" className="input" /></div>
          <div><label className="label">Telefono</label><input name="telefono" className="input" /></div>
          <div className="col-span-2 flex items-end md:col-span-3"><SubmitButton>Aggiungi soggetto</SubmitButton></div>
        </form>
      </Collapsible>
    </div>
  );
}
