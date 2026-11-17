import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, EmptyState, InfoBox } from '@/components/ui';
import { Collapsible, SubmitButton, ConfirmSubmit } from '@/components/forms';
import { creaTrattamento, eliminaTrattamento } from './actions';

export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  const condominioId = await getCondominioId();
  if (!condominioId) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const trattamenti = await prisma.trattamentoDati.findMany({ where: { condominioId }, orderBy: { finalita: 'asc' } });

  return (
    <div className="space-y-6">
      <PageHeader titolo="Privacy / GDPR" sottotitolo="Registro delle attività di trattamento dei dati personali (Reg. UE 2016/679)." />

      <InfoBox titolo="Il condominio e il GDPR">
        Il condominio, tramite l'amministratore, è <strong>titolare del trattamento</strong> dei dati personali dei condomini
        (anagrafici, di contatto, catastali, di pagamento). Deve rispettare i principi di liceità, minimizzazione e limitazione
        della conservazione, informare gli interessati e gestire i dati per le sole finalità di legge e di gestione. I dati
        dell'anagrafe non possono essere diffusi a terzi estranei. Il registro dei trattamenti documenta le finalità e le basi
        giuridiche di ciascun trattamento.
      </InfoBox>

      <Card titolo={`Registro dei trattamenti (${trattamenti.length})`}>
        {trattamenti.length === 0 ? (
          <EmptyState messaggio="Nessun trattamento registrato." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Finalità</th><th>Base giuridica</th><th>Categorie di dati</th><th>Destinatari</th><th>Conservazione</th><th></th></tr></thead>
              <tbody>
                {trattamenti.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium text-slate-700">{t.finalita}</td>
                    <td className="text-xs">{t.baseGiuridica}</td>
                    <td className="text-xs">{t.categorieDati}</td>
                    <td className="text-xs">{t.destinatari ?? '—'}</td>
                    <td className="text-xs">{t.conservazione ?? '—'}</td>
                    <td><form action={eliminaTrattamento}><input type="hidden" name="id" value={t.id} /><ConfirmSubmit /></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Collapsible titolo="Aggiungi trattamento">
        <form action={creaTrattamento} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div><label className="label">Finalità</label><input name="finalita" className="input" required /></div>
          <div><label className="label">Base giuridica</label><input name="baseGiuridica" className="input" placeholder="Obbligo legale (art. 1130 c.c.)…" required /></div>
          <div><label className="label">Categorie di dati</label><input name="categorieDati" className="input" required /></div>
          <div><label className="label">Destinatari</label><input name="destinatari" className="input" /></div>
          <div><label className="label">Periodo di conservazione</label><input name="conservazione" className="input" /></div>
          <div className="flex items-end"><SubmitButton>Aggiungi trattamento</SubmitButton></div>
        </form>
      </Collapsible>
    </div>
  );
}
