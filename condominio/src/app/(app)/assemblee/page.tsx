import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState, InfoBox } from '@/components/ui';
import { Collapsible, SubmitButton } from '@/components/forms';
import { dataIt } from '@/lib/format';
import { creaAssemblea } from './actions';

export const dynamic = 'force-dynamic';

export default async function AssembleePage() {
  const condominioId = await getCondominioId();
  if (!condominioId) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const assemblee = await prisma.assemblea.findMany({
    where: { condominioId },
    orderBy: { dataPrimaConvocazione: 'desc' },
    include: { puntiOdg: true, partecipazioni: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        titolo="Assemblee condominiali"
        sottotitolo="Convocazione, quorum e verbali (artt. 1135-1136 c.c.; artt. 66-67 disp. att. c.c.)."
      />

      <InfoBox titolo="Convocazione — art. 66 disp. att. c.c.">
        L'avviso di convocazione deve pervenire a tutti i condomini almeno <strong>5 giorni prima</strong> della prima
        convocazione, a mezzo raccomandata, PEC, fax o consegna a mani, e deve indicare l'ordine del giorno in modo specifico.
        La seconda convocazione non può tenersi nello stesso giorno della prima.
      </InfoBox>

      <Card titolo={`Assemblee (${assemblee.length})`}>
        {assemblee.length === 0 ? (
          <EmptyState messaggio="Nessuna assemblea registrata." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Oggetto</th><th>Tipo</th><th>1ª / 2ª convocazione</th><th>Punti odg</th><th>Stato</th></tr>
              </thead>
              <tbody>
                {assemblee.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/assemblee/${a.id}`} className="font-medium text-brand-700 hover:underline">
                        {a.oggettoSintesi ?? 'Assemblea'}
                      </Link>
                    </td>
                    <td><Badge tono={a.tipo === 'straordinaria' ? 'giallo' : 'neutro'}>{a.tipo}</Badge></td>
                    <td className="text-xs">{dataIt(a.dataPrimaConvocazione)} {a.oraPrimaConvocazione ?? ''}{a.dataSecondaConvocazione ? ` · ${dataIt(a.dataSecondaConvocazione)} ${a.oraSecondaConvocazione ?? ''}` : ''}</td>
                    <td>{a.puntiOdg.length}</td>
                    <td><Badge tono={a.stato === 'svolta' ? 'verde' : a.stato === 'annullata' ? 'rosso' : 'giallo'}>{a.stato}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Collapsible titolo="Convoca nuova assemblea">
        <form action={creaAssemblea} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="col-span-2 md:col-span-3"><label className="label">Oggetto / sintesi</label><input name="oggettoSintesi" className="input" placeholder="Approvazione rendiconto e preventivo" required /></div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input"><option value="ordinaria">Ordinaria</option><option value="straordinaria">Straordinaria</option></select>
          </div>
          <div className="col-span-2"><label className="label">Luogo</label><input name="luogo" className="input" placeholder="Sala riunioni / studio amministratore" /></div>
          <div><label className="label">Data 1ª convocazione</label><input name="dataPrimaConvocazione" type="date" className="input" required /></div>
          <div><label className="label">Ora 1ª</label><input name="oraPrimaConvocazione" type="time" className="input" /></div>
          <div></div>
          <div><label className="label">Data 2ª convocazione</label><input name="dataSecondaConvocazione" type="date" className="input" /></div>
          <div><label className="label">Ora 2ª</label><input name="oraSecondaConvocazione" type="time" className="input" /></div>
          <div className="flex items-end"><SubmitButton>Convoca assemblea</SubmitButton></div>
        </form>
        <p className="mt-2 text-xs text-slate-400">Le partecipazioni saranno precompilate con i millesimi di proprietà di ciascun condomino.</p>
      </Collapsible>
    </div>
  );
}
