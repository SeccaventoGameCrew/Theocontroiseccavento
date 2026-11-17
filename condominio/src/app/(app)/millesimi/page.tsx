import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState, InfoBox } from '@/components/ui';
import { Collapsible, SubmitButton, ConfirmSubmit } from '@/components/forms';
import { millesimi as fmtMill } from '@/lib/format';
import { creaTabella, eliminaTabella, salvaQuote } from './actions';

export const dynamic = 'force-dynamic';

export default async function MillesimiPage() {
  const condominioId = await getCondominioId();
  if (!condominioId) return <EmptyState messaggio="Nessun condominio selezionato." />;

  const [tabelle, unita] = await Promise.all([
    prisma.tabellaMillesimale.findMany({ where: { condominioId }, orderBy: { nome: 'asc' }, include: { quote: true } }),
    prisma.unitaImmobiliare.findMany({ where: { condominioId }, orderBy: { denominazione: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        titolo="Tabelle millesimali"
        sottotitolo="Criteri di ripartizione delle spese (artt. 1123, 1124 c.c.; artt. 68-69 disp. att. c.c.)."
      />

      <InfoBox titolo="Nota normativa">
        Le tabelle millesimali esprimono il valore proporzionale di ciascuna unità. La <strong>tabella di proprietà</strong> deve
        totalizzare 1000 millesimi. Esistono tabelle speciali per servizi che non servono tutti in egual misura (ascensore,
        scale, riscaldamento: artt. 1123 c.2-3 e 1124 c.c.). La <strong>modifica</strong> delle tabelle convenzionali richiede
        l'unanimità; la revisione per errore o per mutata consistenza &gt; 1/5 è possibile a maggioranza (art. 69 disp. att.).
      </InfoBox>

      {tabelle.length === 0 && <EmptyState messaggio="Nessuna tabella millesimale definita." />}

      {tabelle.map((t) => {
        const quotaMap = new Map(t.quote.map((q) => [q.unitaId, q.millesimi]));
        const totale = t.quote.reduce((s, q) => s + q.millesimi, 0);
        const quadra = Math.abs(totale - t.totale) < 0.01;
        return (
          <Card
            key={t.id}
            titolo={`${t.nome}`}
            azione={
              <div className="flex items-center gap-2">
                <Badge tono="neutro">{t.tipo}</Badge>
                <Badge tono={quadra ? 'verde' : 'rosso'}>
                  Totale: {fmtMill(totale)} / {fmtMill(t.totale)}
                </Badge>
                <form action={eliminaTabella}>
                  <input type="hidden" name="id" value={t.id} />
                  <ConfirmSubmit messaggio={`Eliminare la tabella "${t.nome}" e tutte le sue quote?`} />
                </form>
              </div>
            }
          >
            {t.descrizione && <p className="mb-3 text-xs text-slate-500">{t.descrizione}</p>}
            {unita.length === 0 ? (
              <EmptyState messaggio="Aggiungi prima delle unità immobiliari in Anagrafe." />
            ) : (
              <form action={salvaQuote}>
                <input type="hidden" name="tabellaId" value={t.id} />
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr><th>Unità</th><th>Piano</th><th className="text-right">Millesimi</th></tr>
                    </thead>
                    <tbody>
                      {unita.map((u) => (
                        <tr key={u.id}>
                          <td className="font-medium text-slate-700">{u.denominazione}</td>
                          <td className="text-xs text-slate-400">{u.piano ?? '—'}</td>
                          <td className="text-right">
                            <input
                              name={`m_${u.id}`}
                              type="number"
                              step="0.01"
                              defaultValue={quotaMap.get(u.id) ?? 0}
                              className="input ml-auto max-w-[120px] text-right"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {!quadra && (
                    <span className="text-xs font-medium text-red-600">
                      Attenzione: la somma dei millesimi ({fmtMill(totale)}) non coincide con il totale previsto ({fmtMill(t.totale)}).
                    </span>
                  )}
                  <div className="ml-auto"><SubmitButton className="btn-primary btn-sm">Salva quote</SubmitButton></div>
                </div>
              </form>
            )}
          </Card>
        );
      })}

      <Collapsible titolo="Aggiungi tabella millesimale">
        <form action={creaTabella} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className="label">Nome</label><input name="nome" className="input" placeholder="Riscaldamento" required /></div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input">
              <option value="proprieta">Proprietà</option>
              <option value="scala">Scala</option>
              <option value="ascensore">Ascensore</option>
              <option value="riscaldamento">Riscaldamento</option>
              <option value="acqua">Acqua</option>
              <option value="lastrico">Lastrico solare</option>
              <option value="altro">Altro</option>
            </select>
          </div>
          <div><label className="label">Totale millesimi</label><input name="totale" type="number" step="0.01" defaultValue="1000" className="input" /></div>
          <div className="col-span-2 md:col-span-1 flex items-end"><SubmitButton>Crea tabella</SubmitButton></div>
          <div className="col-span-2 md:col-span-4"><label className="label">Descrizione</label><input name="descrizione" className="input" placeholder="Criterio di ripartizione / riferimento normativo" /></div>
        </form>
      </Collapsible>
    </div>
  );
}
