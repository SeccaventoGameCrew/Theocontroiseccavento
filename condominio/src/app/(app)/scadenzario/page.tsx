import { getCondominioId } from '@/lib/condominio';
import { calcolaScadenze } from '@/lib/agenti/scadenzario';
import { PageHeader, Card, Badge, StatCard, EmptyState, InfoBox } from '@/components/ui';
import { dataIt } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TONO: Record<string, 'rosso' | 'giallo' | 'blu' | 'neutro'> = {
  scaduta: 'rosso',
  urgente: 'giallo',
  prossima: 'blu',
  pianificata: 'neutro',
};
const ETICHETTA: Record<string, string> = {
  scaduta: 'Scaduta',
  urgente: 'Urgente (≤30g)',
  prossima: 'Prossima (≤90g)',
  pianificata: 'Pianificata',
};

export default async function ScadenzarioPage() {
  const condominioId = await getCondominioId();
  if (!condominioId) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const scadenze = await calcolaScadenze(condominioId);
  const conta = (p: string) => scadenze.filter((s) => s.priorita === p).length;

  return (
    <div className="space-y-6">
      <PageHeader
        titolo="Scadenzario adempimenti (Agente Scadenze)"
        sottotitolo="Scadenze gestionali, tecniche e fiscali del condominio, aggregate automaticamente."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard etichetta="Scadute" valore={String(conta('scaduta'))} tono={conta('scaduta') > 0 ? 'critico' : 'positivo'} />
        <StatCard etichetta="Urgenti (≤30g)" valore={String(conta('urgente'))} tono={conta('urgente') > 0 ? 'attenzione' : 'positivo'} />
        <StatCard etichetta="Prossime (≤90g)" valore={String(conta('prossima'))} />
        <StatCard etichetta="Totali monitorate" valore={String(scadenze.length)} />
      </div>

      <InfoBox titolo="Adempimenti ricorrenti del condominio">
        Il condominio è <strong>sostituto d'imposta</strong>: deve operare e versare le ritenute del 4% sui corrispettivi dovuti
        per contratti di appalto (art. 25-ter DPR 600/73), rilasciare la Certificazione Unica e presentare il modello 770.
        Vanno inoltre rispettate le verifiche periodiche di sicurezza degli impianti (ascensori — DPR 162/99; impianto termico —
        DPR 74/2013; antincendio) e le scadenze contrattuali e assicurative.
      </InfoBox>

      <Card titolo="Elenco scadenze">
        {scadenze.length === 0 ? (
          <EmptyState messaggio="Nessuna scadenza monitorata. Inserisci impianti, contratti e dati dell'amministratore." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Scadenza</th><th>Categoria</th><th>Data</th><th>Tempistica</th><th>Priorità</th><th>Riferimento</th></tr>
              </thead>
              <tbody>
                {scadenze.map((s, i) => (
                  <tr key={i}>
                    <td className="font-medium text-slate-700">{s.titolo}{s.dettaglio ? <div className="text-xs font-normal text-slate-400">{s.dettaglio}</div> : null}</td>
                    <td className="text-xs">{s.categoria}</td>
                    <td className="text-xs">{s.data ? dataIt(s.data) : '—'}</td>
                    <td className="text-xs">{s.giorni === null ? '—' : s.giorni < 0 ? `scaduta da ${-s.giorni}g` : `tra ${s.giorni}g`}</td>
                    <td><Badge tono={TONO[s.priorita]}>{ETICHETTA[s.priorita]}</Badge></td>
                    <td className="text-xs text-slate-400">{s.riferimento ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
