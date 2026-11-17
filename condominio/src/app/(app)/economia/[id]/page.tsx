import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState } from '@/components/ui';
import { Collapsible, SubmitButton, ConfirmSubmit } from '@/components/forms';
import { euro, dataIt, nomeCompleto } from '@/lib/format';
import { calcolaRiparto } from '@/lib/agenti/ripartizione';
import { calcolaRendiconto } from '@/lib/agenti/rendiconto';
import {
  creaSpesa,
  eliminaSpesa,
  togglePagataSpesa,
  creaCategoria,
  generaRate,
  creaRataManuale,
  eliminaRata,
  registraPagamento,
  aggiornaStatoEsercizio,
  eliminaEsercizio,
} from '../actions';

export const dynamic = 'force-dynamic';

export default async function EsercizioDetail({ params }: { params: { id: string } }) {
  const esercizioId = params.id;
  const condominioId = await getCondominioId();

  const esercizio = await prisma.esercizio.findUnique({
    where: { id: esercizioId },
    include: {
      spese: { include: { categoria: true, fornitore: true }, orderBy: { data: 'asc' } },
      rate: { include: { pagamenti: true }, orderBy: [{ condominoId: 'asc' }, { numero: 'asc' }] },
    },
  });
  if (!esercizio || !condominioId) return notFound();

  const [categorie, fornitori, tabelle, condomini] = await Promise.all([
    prisma.categoriaSpesa.findMany({ where: { condominioId }, orderBy: { nome: 'asc' }, include: { tabella: true } }),
    prisma.fornitore.findMany({ where: { condominioId }, orderBy: { ragioneSociale: 'asc' } }),
    prisma.tabellaMillesimale.findMany({ where: { condominioId }, orderBy: { nome: 'asc' } }),
    prisma.condomino.findMany({ where: { condominioId }, orderBy: [{ cognome: 'asc' }, { ragioneSociale: 'asc' }] }),
  ]);

  const [riparto, rendiconto] = await Promise.all([
    calcolaRiparto(esercizioId),
    calcolaRendiconto(esercizioId),
  ]);

  const nomeCondomino = new Map(condomini.map((c) => [c.id, nomeCompleto(c)]));
  const totaleSpese = esercizio.spese.reduce((s, x) => s + x.importo, 0);

  // Raggruppa rate per condomino
  const rateByCondomino = new Map<string, typeof esercizio.rate>();
  for (const r of esercizio.rate) {
    const arr = rateByCondomino.get(r.condominoId) ?? [];
    arr.push(r);
    rateByCondomino.set(r.condominoId, arr);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titolo={esercizio.denominazione}
        sottotitolo={`${dataIt(esercizio.dataInizio)} – ${dataIt(esercizio.dataFine)} · ${esercizio.tipo} · fondo riserva ${euro(esercizio.fondoRiserva)}`}
        azione={
          <div className="flex items-center gap-2">
            <Link href="/economia" className="btn-secondary btn-sm">← Esercizi</Link>
            <form action={aggiornaStatoEsercizio} className="flex items-center gap-1">
              <input type="hidden" name="id" value={esercizio.id} />
              <select name="stato" defaultValue={esercizio.stato} className="input btn-sm max-w-[200px]">
                <option value="aperto">Aperto</option>
                <option value="preventivo_approvato">Preventivo approvato</option>
                <option value="consuntivo_approvato">Consuntivo approvato</option>
                <option value="chiuso">Chiuso</option>
              </select>
              <SubmitButton className="btn-secondary btn-sm">Aggiorna stato</SubmitButton>
            </form>
          </div>
        }
      />

      {/* ===== SPESE ===== */}
      <Card titolo={`Spese dell'esercizio — totale ${euro(totaleSpese)}`}>
        {esercizio.spese.length === 0 ? (
          <EmptyState messaggio="Nessuna spesa registrata." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th>Tabella</th><th className="text-right">Importo</th><th>Stato</th><th></th></tr>
              </thead>
              <tbody>
                {esercizio.spese.map((s) => (
                  <tr key={s.id}>
                    <td className="text-xs">{dataIt(s.data)}</td>
                    <td className="font-medium text-slate-700">{s.descrizione}{s.fornitore ? <div className="text-xs text-slate-400">{s.fornitore.ragioneSociale}</div> : null}</td>
                    <td className="text-xs">{s.categoria?.nome ?? '—'}</td>
                    <td className="text-xs">{tabelle.find((t) => t.id === (s.tabellaOverrideId ?? s.categoria?.tabellaId))?.nome ?? <span className="text-red-500">nessuna</span>}</td>
                    <td className="text-right font-medium">{euro(s.importo)}</td>
                    <td>
                      <form action={togglePagataSpesa}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="esercizioId" value={esercizio.id} />
                        <button type="submit"><Badge tono={s.pagata ? 'verde' : 'giallo'}>{s.pagata ? 'pagata' : 'da pagare'}</Badge></button>
                      </form>
                    </td>
                    <td>
                      <form action={eliminaSpesa}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="esercizioId" value={esercizio.id} />
                        <ConfirmSubmit />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {riparto.avvisi.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
            {riparto.avvisi.map((a, i) => <div key={i}>⚠️ {a}</div>)}
          </div>
        )}
      </Card>

      <Collapsible titolo="Registra spesa">
        <form action={creaSpesa} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <input type="hidden" name="esercizioId" value={esercizio.id} />
          <div><label className="label">Data</label><input name="data" type="date" className="input" required /></div>
          <div className="col-span-2"><label className="label">Descrizione</label><input name="descrizione" className="input" required /></div>
          <div><label className="label">Importo (€)</label><input name="importo" type="number" step="0.01" className="input" required /></div>
          <div>
            <label className="label">Categoria</label>
            <select name="categoriaId" className="input">
              <option value="">—</option>
              {categorie.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.tabella ? ` → ${c.tabella.nome}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Fornitore</label>
            <select name="fornitoreId" className="input">
              <option value="">—</option>
              {fornitori.map((f) => <option key={f.id} value={f.id}>{f.ragioneSociale}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tabella (override)</label>
            <select name="tabellaOverrideId" className="input">
              <option value="">(usa quella della categoria)</option>
              {tabelle.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div><label className="label">N. documento</label><input name="numeroDocumento" className="input" /></div>
          <div className="flex items-end gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pagata" /> già pagata</label></div>
          <div className="col-span-2 md:col-span-4"><SubmitButton>Registra spesa</SubmitButton></div>
        </form>
      </Collapsible>

      <Collapsible titolo="Gestione categorie di spesa">
        <div className="mb-3 flex flex-wrap gap-2">
          {categorie.map((c) => <Badge key={c.id} tono="neutro">{c.nome} {c.tabella ? `· ${c.tabella.nome}` : '· (no tabella)'}</Badge>)}
        </div>
        <form action={creaCategoria} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <input type="hidden" name="ritorno" value={`/economia/${esercizio.id}`} />
          <div className="col-span-2"><label className="label">Nome categoria</label><input name="nome" className="input" required /></div>
          <div>
            <label className="label">Tabella di riparto</label>
            <select name="tabellaId" className="input">
              <option value="">—</option>
              {tabelle.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input"><option value="ordinaria">Ordinaria</option><option value="straordinaria">Straordinaria</option></select>
          </div>
          <div className="col-span-2 md:col-span-4"><SubmitButton className="btn-secondary">Aggiungi categoria</SubmitButton></div>
        </form>
      </Collapsible>

      {/* ===== RIPARTO ===== */}
      <Card titolo="Riparto spese per unità (Agente Ripartizione)">
        {riparto.righe.length === 0 ? (
          <EmptyState messaggio="Nessuna unità o nessuna spesa ripartibile." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Unità</th><th>Titolare</th><th className="text-right">Quota a carico</th></tr>
              </thead>
              <tbody>
                {riparto.righe.map((r) => (
                  <tr key={r.unitaId}>
                    <td className="font-medium text-slate-700">{r.unitaDenominazione}</td>
                    <td className="text-xs">{r.condominoNome}</td>
                    <td className="text-right font-medium">{euro(r.totale)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={2}>Totale ripartito</td>
                  <td className="text-right">{euro(riparto.totaleRipartito)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===== RENDICONTO ===== */}
      {rendiconto && (
        <Card titolo="Rendiconto — riepilogo finanziario (art. 1130-bis c.c.)">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <RiepVoce etichetta="Totale uscite (spese)" valore={euro(rendiconto.totaleUscite)} />
            <RiepVoce etichetta="Totale entrate (versamenti)" valore={euro(rendiconto.totaleEntrate)} />
            <RiepVoce etichetta="Fondo riserva" valore={euro(rendiconto.fondoRiserva)} />
            <RiepVoce etichetta="Saldo cassa" valore={euro(rendiconto.saldoCassa)} />
            <RiepVoce etichetta="Crediti vs condomini (morosità)" valore={euro(rendiconto.creditiVersoCondomini)} tono="critico" />
            <RiepVoce etichetta="Debiti vs fornitori (non pagato)" valore={euro(rendiconto.debitiVersoFornitori)} tono="attenzione" />
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-brand-700">Registro di contabilità (movimenti cronologici)</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th className="text-right">Entrata</th><th className="text-right">Uscita</th></tr></thead>
                <tbody>
                  {rendiconto.movimenti.map((m, i) => (
                    <tr key={i}>
                      <td className="text-xs">{dataIt(m.data)}</td>
                      <td>{m.descrizione}</td>
                      <td className="text-xs">{m.categoria}</td>
                      <td className="text-right text-emerald-600">{m.entrata ? euro(m.entrata) : ''}</td>
                      <td className="text-right text-red-600">{m.uscita ? euro(m.uscita) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
      )}

      {/* ===== RATE E PAGAMENTI ===== */}
      <Card titolo="Rate e versamenti">
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <form action={generaRate} className="rounded-lg border border-slate-200 p-3">
            <input type="hidden" name="esercizioId" value={esercizio.id} />
            <div className="mb-2 text-sm font-semibold text-slate-700">Genera rate (riparto millesimale)</div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="label">Importo totale</label><input name="importoTotale" type="number" step="0.01" className="input" required /></div>
              <div><label className="label">N. rate</label><input name="numeroRate" type="number" defaultValue="2" min="1" className="input" /></div>
              <div><label className="label">1ª scadenza</label><input name="primaScadenza" type="date" className="input" required /></div>
            </div>
            <div className="mt-2"><SubmitButton className="btn-primary btn-sm">Genera rate per tutti</SubmitButton></div>
          </form>

          <form action={creaRataManuale} className="rounded-lg border border-slate-200 p-3">
            <input type="hidden" name="esercizioId" value={esercizio.id} />
            <div className="mb-2 text-sm font-semibold text-slate-700">Rata manuale</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><label className="label">Condomino</label>
                <select name="condominoId" className="input" required>
                  <option value="">Seleziona…</option>
                  {condomini.map((c) => <option key={c.id} value={c.id}>{nomeCompleto(c)}</option>)}
                </select>
              </div>
              <div><label className="label">Importo</label><input name="importo" type="number" step="0.01" className="input" required /></div>
              <div><label className="label">Scadenza</label><input name="scadenza" type="date" className="input" required /></div>
              <div className="col-span-2"><label className="label">Descrizione</label><input name="descrizione" className="input" /></div>
            </div>
            <div className="mt-2"><SubmitButton className="btn-secondary btn-sm">Aggiungi rata</SubmitButton></div>
          </form>
        </div>

        {rateByCondomino.size === 0 ? (
          <EmptyState messaggio="Nessuna rata emessa." />
        ) : (
          <div className="space-y-3">
            {Array.from(rateByCondomino.entries()).map(([condId, rate]) => {
              const dovuto = rate.reduce((s, r) => s + r.importo, 0);
              const pagato = rate.reduce((s, r) => s + r.pagamenti.reduce((a, p) => a + p.importo, 0), 0);
              const saldo = dovuto - pagato;
              return (
                <details key={condId} className="rounded-lg border border-slate-200">
                  <summary className="flex cursor-pointer items-center justify-between px-3 py-2">
                    <span className="font-medium text-slate-700">{nomeCondomino.get(condId) ?? '—'}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Dovuto {euro(dovuto)} · Versato {euro(pagato)}</span>
                      <Badge tono={saldo > 0.01 ? 'rosso' : 'verde'}>Saldo {euro(saldo)}</Badge>
                    </span>
                  </summary>
                  <div className="border-t border-slate-100 p-3">
                    <table className="table-base">
                      <thead><tr><th>Rata</th><th>Scadenza</th><th className="text-right">Importo</th><th className="text-right">Versato</th><th>Registra pagamento</th><th></th></tr></thead>
                      <tbody>
                        {rate.map((r) => {
                          const vers = r.pagamenti.reduce((a, p) => a + p.importo, 0);
                          const residuo = r.importo - vers;
                          return (
                            <tr key={r.id}>
                              <td className="text-xs">{r.descrizione ?? `Rata ${r.numero}`}</td>
                              <td className="text-xs">{dataIt(r.scadenza)}</td>
                              <td className="text-right">{euro(r.importo)}</td>
                              <td className="text-right text-emerald-600">{euro(vers)}</td>
                              <td>
                                {residuo > 0.01 ? (
                                  <form action={registraPagamento} className="flex items-center gap-1">
                                    <input type="hidden" name="rataId" value={r.id} />
                                    <input type="hidden" name="esercizioId" value={esercizio.id} />
                                    <input name="importo" type="number" step="0.01" defaultValue={residuo.toFixed(2)} className="input btn-sm max-w-[90px]" />
                                    <input name="data" type="date" className="input btn-sm max-w-[140px]" required />
                                    <SubmitButton className="btn-primary btn-sm">Salva</SubmitButton>
                                  </form>
                                ) : <Badge tono="verde">saldata</Badge>}
                              </td>
                              <td>
                                <form action={eliminaRata}>
                                  <input type="hidden" name="id" value={r.id} />
                                  <input type="hidden" name="esercizioId" value={esercizio.id} />
                                  <ConfirmSubmit>✕</ConfirmSubmit>
                                </form>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Card>

      <Card titolo="Zona pericolosa">
        <form action={eliminaEsercizio}>
          <input type="hidden" name="id" value={esercizio.id} />
          <ConfirmSubmit messaggio="Eliminare l'intero esercizio con spese, rate e pagamenti? Operazione irreversibile." className="btn-danger">
            Elimina esercizio
          </ConfirmSubmit>
        </form>
      </Card>
    </div>
  );
}

function RiepVoce({ etichetta, valore, tono }: { etichetta: string; valore: string; tono?: 'critico' | 'attenzione' }) {
  const c = tono === 'critico' ? 'text-red-600' : tono === 'attenzione' ? 'text-amber-600' : 'text-slate-800';
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{etichetta}</div>
      <div className={`text-lg font-bold ${c}`}>{valore}</div>
    </div>
  );
}
