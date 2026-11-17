import Link from 'next/link';
import { getCondominioId, getCondominioCorrente } from '@/lib/condominio';
import { calcolaMorosita, generaSollecito } from '@/lib/agenti/morosita';
import { PageHeader, Card, StatCard, Badge, EmptyState, InfoBox } from '@/components/ui';
import CopyBox from '@/components/CopyBox';
import { euro, dataIt } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function MorositaPage() {
  const condominioId = await getCondominioId();
  const condominio = await getCondominioCorrente();
  if (!condominioId || !condominio) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const m = await calcolaMorosita(condominioId);

  return (
    <div className="space-y-6">
      <PageHeader
        titolo="Morosità e solleciti"
        sottotitolo="Situazione dei pagamenti per condomino (Agente Morosità)."
        azione={<Link href="/economia" className="btn-secondary btn-sm">← Gestione economica</Link>}
      />

      <InfoBox titolo="Riscossione forzosa — art. 63 disp. att. c.c. e art. 1129 c.9 c.c.">
        In caso di morosità, l'amministratore può ottenere un <strong>decreto ingiuntivo immediatamente esecutivo</strong> (art. 63
        disp. att.) ed è tenuto ad agire per la riscossione <strong>entro sei mesi dalla chiusura dell'esercizio</strong> in cui il
        credito è compreso, salvo diversa delibera (art. 1129, c.9, c.c.). I fornitori possono agire verso i morosi prima di
        aggredire i condomini in regola.
      </InfoBox>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard etichetta="Totale dovuto" valore={euro(m.totaleDovuto)} />
        <StatCard etichetta="Totale incassato" valore={euro(m.totaleIncassato)} tono="positivo" />
        <StatCard etichetta="Morosità (scaduto)" valore={euro(m.totaleMorosita)} tono={m.totaleMorosita > 0 ? 'critico' : 'positivo'} />
        <StatCard etichetta="Condòmini morosi" valore={String(m.numeroMorosi)} tono={m.numeroMorosi > 0 ? 'attenzione' : 'positivo'} />
      </div>

      <Card titolo="Posizioni dei condomini">
        {m.posizioni.length === 0 ? (
          <EmptyState messaggio="Nessuna posizione contabile (nessuna rata emessa)." />
        ) : (
          <div className="space-y-3">
            {m.posizioni.map((p) => (
              <details key={p.condominoId} className="rounded-lg border border-slate-200">
                <summary className="flex cursor-pointer items-center justify-between px-3 py-2">
                  <span className="font-medium text-slate-700">{p.nome}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">Dovuto {euro(p.totaleDovuto)} · Versato {euro(p.totalePagato)}</span>
                    {p.moroso ? (
                      <Badge tono="rosso">Moroso · scaduto {euro(p.importoScaduto)}</Badge>
                    ) : p.saldo > 0.01 ? (
                      <Badge tono="giallo">A debito {euro(p.saldo)}</Badge>
                    ) : (
                      <Badge tono="verde">In regola</Badge>
                    )}
                  </span>
                </summary>
                <div className="space-y-3 border-t border-slate-100 p-3">
                  <table className="table-base">
                    <thead><tr><th>Rata</th><th>Scadenza</th><th className="text-right">Importo</th><th className="text-right">Residuo</th><th>Stato</th></tr></thead>
                    <tbody>
                      {p.rate.map((r) => (
                        <tr key={r.rataId}>
                          <td className="text-xs">{r.descrizione}</td>
                          <td className="text-xs">{dataIt(r.scadenza)}</td>
                          <td className="text-right">{euro(r.importo)}</td>
                          <td className="text-right">{euro(r.residuo)}</td>
                          <td>{r.residuo < 0.01 ? <Badge tono="verde">pagata</Badge> : r.scaduta ? <Badge tono="rosso">scaduta</Badge> : <Badge tono="giallo">a scadere</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {p.moroso && (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold text-brand-700">Genera lettera di sollecito</summary>
                      <div className="mt-2">
                        <CopyBox testo={generaSollecito(p, condominio.denominazione)} />
                      </div>
                    </details>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
