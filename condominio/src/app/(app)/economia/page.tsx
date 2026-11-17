import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState, InfoBox } from '@/components/ui';
import { Collapsible, SubmitButton } from '@/components/forms';
import { euro, dataIt } from '@/lib/format';
import { creaEsercizio } from './actions';

export const dynamic = 'force-dynamic';

export default async function EconomiaPage() {
  const condominioId = await getCondominioId();
  if (!condominioId) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const esercizi = await prisma.esercizio.findMany({
    where: { condominioId },
    orderBy: { dataInizio: 'desc' },
    include: { spese: true, rate: { include: { pagamenti: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        titolo="Gestione economica"
        sottotitolo="Esercizi contabili, spese, riparto e rendiconto (artt. 1130, 1130-bis, 1135 c.c.)."
        azione={<Link href="/economia/morosita" className="btn-secondary">Morosità e solleciti</Link>}
      />

      <InfoBox titolo="Rendiconto condominiale — art. 1130-bis c.c.">
        Il rendiconto si compone di <strong>registro di contabilità</strong>, <strong>riepilogo finanziario</strong> e
        <strong> nota sintetica esplicativa</strong>. Deve essere approvato dall'assemblea entro 180 giorni dalla chiusura
        dell'esercizio. Apri un esercizio per registrare le spese e generare automaticamente riparto e rendiconto.
      </InfoBox>

      <Card titolo={`Esercizi contabili (${esercizi.length})`}>
        {esercizi.length === 0 ? (
          <EmptyState messaggio="Nessun esercizio. Creane uno qui sotto." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Denominazione</th><th>Periodo</th><th>Tipo</th><th className="text-right">Spese</th><th className="text-right">Incassato</th><th>Stato</th></tr>
              </thead>
              <tbody>
                {esercizi.map((e) => {
                  const spese = e.spese.reduce((s, x) => s + x.importo, 0);
                  const incassato = e.rate.reduce((s, r) => s + r.pagamenti.reduce((a, p) => a + p.importo, 0), 0);
                  return (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/economia/${e.id}`} className="font-medium text-brand-700 hover:underline">{e.denominazione}</Link>
                      </td>
                      <td className="text-xs">{dataIt(e.dataInizio)} – {dataIt(e.dataFine)}</td>
                      <td><Badge tono={e.tipo === 'straordinaria' ? 'giallo' : 'neutro'}>{e.tipo}</Badge></td>
                      <td className="text-right font-medium">{euro(spese)}</td>
                      <td className="text-right text-emerald-600">{euro(incassato)}</td>
                      <td><Badge tono={e.stato.includes('approvato') || e.stato === 'chiuso' ? 'verde' : 'giallo'}>{e.stato.replace('_', ' ')}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Collapsible titolo="Nuovo esercizio contabile">
        <form action={creaEsercizio} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2"><label className="label">Denominazione</label><input name="denominazione" className="input" placeholder="Esercizio 2026 - Gestione ordinaria" required /></div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input">
              <option value="ordinaria">Ordinaria</option>
              <option value="straordinaria">Straordinaria</option>
            </select>
          </div>
          <div><label className="label">Fondo riserva (€)</label><input name="fondoRiserva" type="number" step="0.01" defaultValue="0" className="input" /></div>
          <div><label className="label">Data inizio</label><input name="dataInizio" type="date" className="input" required /></div>
          <div><label className="label">Data fine</label><input name="dataFine" type="date" className="input" required /></div>
          <div className="col-span-2 flex items-end md:col-span-2"><SubmitButton>Crea esercizio</SubmitButton></div>
        </form>
      </Collapsible>
    </div>
  );
}
