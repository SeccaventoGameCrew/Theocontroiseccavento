import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getCondominioId, getCondominioCorrente } from '@/lib/condominio';
import { calcolaScadenze } from '@/lib/agenti/scadenzario';
import { calcolaMorosita } from '@/lib/agenti/morosita';
import { PageHeader, StatCard, Card, Badge, EmptyState } from '@/components/ui';
import { euro, dataIt } from '@/lib/format';

const TONO_PRIORITA: Record<string, 'rosso' | 'giallo' | 'blu' | 'neutro'> = {
  scaduta: 'rosso',
  urgente: 'giallo',
  prossima: 'blu',
  pianificata: 'neutro',
};

export default async function Dashboard() {
  const condominio = await getCondominioCorrente();
  const condominioId = await getCondominioId();

  if (!condominio || !condominioId) {
    return (
      <div>
        <PageHeader titolo="Cruscotto" />
        <EmptyState messaggio="Nessun condominio presente. Esegui il seed dei dati dimostrativi (npm run db:seed) oppure crea un condominio da Impostazioni." />
      </div>
    );
  }

  const [nUnita, nCondomini, tabellaProprieta, esercizi, prossimaAssemblea, scadenze, morosita] =
    await Promise.all([
      prisma.unitaImmobiliare.count({ where: { condominioId } }),
      prisma.condomino.count({ where: { condominioId } }),
      prisma.tabellaMillesimale.findFirst({
        where: { condominioId, tipo: 'proprieta' },
        include: { quote: true },
      }),
      prisma.esercizio.findMany({ where: { condominioId }, orderBy: { dataInizio: 'desc' }, take: 5 }),
      prisma.assemblea.findFirst({
        where: { condominioId, stato: 'convocata' },
        orderBy: { dataPrimaConvocazione: 'asc' },
      }),
      calcolaScadenze(condominioId),
      calcolaMorosita(condominioId),
    ]);

  const millesimiAssegnati = tabellaProprieta?.quote.reduce((s, q) => s + q.millesimi, 0) ?? 0;
  const scaduteOUrgenti = scadenze.filter((s) => s.priorita === 'scaduta' || s.priorita === 'urgente');

  return (
    <div>
      <PageHeader titolo={condominio.denominazione} sottotitolo={`${condominio.indirizzo}${condominio.citta ? ', ' + condominio.citta : ''}`} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard etichetta="Unità immobiliari" valore={String(nUnita)} />
        <StatCard etichetta="Condomini (anagrafe)" valore={String(nCondomini)} />
        <StatCard
          etichetta="Millesimi proprietà"
          valore={millesimiAssegnati.toFixed(2)}
          sub={millesimiAssegnati === 1000 ? 'Quadratura corretta (1000)' : 'Attenzione: totale ≠ 1000'}
          tono={Math.abs(millesimiAssegnati - 1000) < 0.01 ? 'positivo' : 'critico'}
        />
        <StatCard
          etichetta="Morosità"
          valore={euro(morosita.totaleMorosita)}
          sub={`${morosita.numeroMorosi} condòmini morosi`}
          tono={morosita.totaleMorosita > 0 ? 'critico' : 'positivo'}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card titolo="Scadenze e adempimenti imminenti" azione={<Link className="text-xs font-medium text-brand-600" href="/scadenzario">Vedi tutte →</Link>}>
          {scaduteOUrgenti.length === 0 ? (
            <EmptyState messaggio="Nessuna scadenza urgente nei prossimi 30 giorni." />
          ) : (
            <ul className="space-y-2">
              {scaduteOUrgenti.slice(0, 6).map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{s.titolo}</div>
                    <div className="text-xs text-slate-400">
                      {s.categoria} · {s.data ? dataIt(s.data) : 'senza data'}
                      {s.riferimento ? ` · ${s.riferimento}` : ''}
                    </div>
                  </div>
                  <Badge tono={TONO_PRIORITA[s.priorita]}>
                    {s.giorni !== null ? (s.giorni < 0 ? `scaduta da ${-s.giorni}g` : `tra ${s.giorni}g`) : '—'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card titolo="Esercizi contabili" azione={<Link className="text-xs font-medium text-brand-600" href="/economia">Gestione economica →</Link>}>
          {esercizi.length === 0 ? (
            <EmptyState messaggio="Nessun esercizio contabile registrato." />
          ) : (
            <ul className="space-y-2">
              {esercizi.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                  <div>
                    <Link href={`/economia/${e.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                      {e.denominazione}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {dataIt(e.dataInizio)} – {dataIt(e.dataFine)} · {e.tipo}
                    </div>
                  </div>
                  <Badge tono={e.stato.includes('approvato') || e.stato === 'chiuso' ? 'verde' : 'giallo'}>
                    {e.stato.replace('_', ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card titolo="Prossima assemblea" azione={<Link className="text-xs font-medium text-brand-600" href="/assemblee">Assemblee →</Link>}>
          {prossimaAssemblea ? (
            <div>
              <div className="text-sm font-medium text-slate-700">
                Assemblea {prossimaAssemblea.tipo} {prossimaAssemblea.oggettoSintesi ? `– ${prossimaAssemblea.oggettoSintesi}` : ''}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                1ª conv.: {dataIt(prossimaAssemblea.dataPrimaConvocazione)} {prossimaAssemblea.oraPrimaConvocazione ?? ''}
                {prossimaAssemblea.dataSecondaConvocazione && (
                  <> · 2ª conv.: {dataIt(prossimaAssemblea.dataSecondaConvocazione)} {prossimaAssemblea.oraSecondaConvocazione ?? ''}</>
                )}
              </div>
              <div className="mt-3">
                <Link href={`/assemblee/${prossimaAssemblea.id}`} className="btn-secondary btn-sm">
                  Apri assemblea
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState messaggio="Nessuna assemblea convocata." />
          )}
        </Card>

        <Card titolo="Situazione incassi">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xs text-slate-400">Dovuto</div>
              <div className="text-lg font-bold text-slate-800">{euro(morosita.totaleDovuto)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Incassato</div>
              <div className="text-lg font-bold text-emerald-600">{euro(morosita.totaleIncassato)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Da incassare</div>
              <div className="text-lg font-bold text-red-600">{euro(morosita.totaleDovuto - morosita.totaleIncassato)}</div>
            </div>
          </div>
          <div className="mt-4">
            <Link href="/economia/morosita" className="btn-secondary btn-sm">
              Gestione morosità e solleciti
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
