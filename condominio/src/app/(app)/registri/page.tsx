import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState, InfoBox } from '@/components/ui';
import { dataIt, euro, nomeCompleto } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function RegistriPage() {
  const condominioId = await getCondominioId();
  if (!condominioId) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const [unita, condomini, assemblee, mandati, esercizi, documenti] = await Promise.all([
    prisma.unitaImmobiliare.findMany({ where: { condominioId }, orderBy: { denominazione: 'asc' }, include: { titolarita: { include: { condomino: true } } } }),
    prisma.condomino.count({ where: { condominioId } }),
    prisma.assemblea.findMany({ where: { condominioId }, orderBy: { dataPrimaConvocazione: 'desc' } }),
    prisma.mandatoAmministratore.findMany({ where: { condominioId }, orderBy: { dataNomina: 'desc' } }),
    prisma.esercizio.findMany({ where: { condominioId }, orderBy: { dataInizio: 'desc' }, include: { spese: true, rate: { include: { pagamenti: true } } } }),
    prisma.documento.findMany({ where: { condominioId }, orderBy: { createdAt: 'desc' } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader titolo="Registri obbligatori" sottotitolo="I quattro registri che l'amministratore deve tenere ai sensi dell'art. 1130 c.c., generati automaticamente dai dati gestiti." />

      <InfoBox titolo="Art. 1130 c.c. — Attribuzioni dell'amministratore">
        L'amministratore deve curare la tenuta di: <strong>registro di anagrafe condominiale</strong> (n.6), <strong>registro dei
        verbali delle assemblee</strong>, <strong>registro di nomina e revoca dell'amministratore</strong> e <strong>registro di
        contabilità</strong> (n.7). I registri devono essere messi a disposizione dei condomini che ne facciano richiesta.
      </InfoBox>

      {/* 1. Anagrafe */}
      <Card titolo="1 · Registro di anagrafe condominiale (art. 1130 n.6)">
        <p className="mb-2 text-xs text-slate-500">{condomini} soggetti · {unita.length} unità immobiliari</p>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Unità</th><th>Dati catastali</th><th>Titolari</th></tr></thead>
            <tbody>
              {unita.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium text-slate-700">{u.denominazione}<div className="text-xs text-slate-400">{u.piano ?? ''} {u.scala ? `Scala ${u.scala}` : ''}</div></td>
                  <td className="text-xs">Fg. {u.catastoFoglio ?? '—'} · Part. {u.catastoParticella ?? '—'} · Sub {u.catastoSub ?? '—'}</td>
                  <td className="text-xs">{u.titolarita.map((t) => `${nomeCompleto(t.condomino)} (${t.tipo})`).join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 2. Verbali */}
      <Card titolo="2 · Registro dei verbali delle assemblee (art. 1130 n.7)">
        {assemblee.length === 0 ? <EmptyState messaggio="Nessun verbale." /> : (
          <table className="table-base">
            <thead><tr><th>Data</th><th>Oggetto</th><th>Tipo</th><th>Verbale</th></tr></thead>
            <tbody>
              {assemblee.map((a) => (
                <tr key={a.id}>
                  <td className="text-xs">{dataIt(a.dataPrimaConvocazione)}</td>
                  <td><Link href={`/assemblee/${a.id}`} className="text-brand-700 hover:underline">{a.oggettoSintesi ?? 'Assemblea'}</Link></td>
                  <td><Badge tono="neutro">{a.tipo}</Badge></td>
                  <td>{a.verbaleTesto ? <Badge tono={a.verbaleApprovato ? 'verde' : 'giallo'}>{a.verbaleApprovato ? 'approvato' : 'redatto'}</Badge> : <Badge tono="rosso">mancante</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 3. Nomina/revoca amministratore */}
      <Card titolo="3 · Registro di nomina e revoca dell'amministratore (art. 1130 n.4)">
        {mandati.length === 0 ? <EmptyState messaggio="Nessun mandato registrato." /> : (
          <table className="table-base">
            <thead><tr><th>Amministratore</th><th>Nomina</th><th>Scadenza</th><th>Revoca</th><th className="text-right">Compenso</th><th>Delibera</th></tr></thead>
            <tbody>
              {mandati.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium text-slate-700">{m.nominativo}</td>
                  <td className="text-xs">{dataIt(m.dataNomina)}</td>
                  <td className="text-xs">{dataIt(m.dataScadenza)}</td>
                  <td className="text-xs">{m.dataRevoca ? dataIt(m.dataRevoca) : '—'}</td>
                  <td className="text-right text-xs">{m.compensoAnnuo ? euro(m.compensoAnnuo) : '—'}</td>
                  <td className="text-xs text-slate-400">{m.deliberaRif ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 4. Contabilità */}
      <Card titolo="4 · Registro di contabilità (art. 1130 n.7)">
        {esercizi.length === 0 ? <EmptyState messaggio="Nessun esercizio contabile." /> : (
          <table className="table-base">
            <thead><tr><th>Esercizio</th><th>Periodo</th><th className="text-right">Uscite</th><th className="text-right">Entrate</th><th></th></tr></thead>
            <tbody>
              {esercizi.map((e) => {
                const uscite = e.spese.reduce((s, x) => s + x.importo, 0);
                const entrate = e.rate.reduce((s, r) => s + r.pagamenti.reduce((a, p) => a + p.importo, 0), 0);
                return (
                  <tr key={e.id}>
                    <td className="font-medium text-slate-700">{e.denominazione}</td>
                    <td className="text-xs">{dataIt(e.dataInizio)} – {dataIt(e.dataFine)}</td>
                    <td className="text-right text-red-600">{euro(uscite)}</td>
                    <td className="text-right text-emerald-600">{euro(entrate)}</td>
                    <td><Link href={`/economia/${e.id}`} className="text-xs text-brand-600 hover:underline">dettaglio →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Archivio documenti */}
      <Card titolo="Archivio documenti">
        {documenti.length === 0 ? <EmptyState messaggio="Nessun documento archiviato." /> : (
          <div className="flex flex-wrap gap-2">
            {documenti.map((d) => (
              <div key={d.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                <div className="font-medium text-slate-700">{d.nome}</div>
                <div className="text-slate-400">{d.categoria}{d.riferimentoAnno ? ` · ${d.riferimentoAnno}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
