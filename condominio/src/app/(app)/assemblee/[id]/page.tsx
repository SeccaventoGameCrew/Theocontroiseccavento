import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCondominioCorrente } from '@/lib/condominio';
import { PageHeader, Card, Badge, EmptyState, InfoBox } from '@/components/ui';
import { Collapsible, SubmitButton, ConfirmSubmit } from '@/components/forms';
import { nomeCompleto } from '@/lib/format';
import { generaConvocazione } from '@/lib/agenti/documenti';
import { REGOLE_MAGGIORANZA, TipoMaggioranza } from '@/lib/agenti/assembleare';
import CopyBox from '@/components/CopyBox';
import Simulatore from './Simulatore';
import { creaPunto, eliminaPunto, eliminaAssemblea, salvaVerbale } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AssembleaDetail({ params }: { params: { id: string } }) {
  const condominio = await getCondominioCorrente();
  const assemblea = await prisma.assemblea.findUnique({
    where: { id: params.id },
    include: {
      puntiOdg: { orderBy: { numero: 'asc' } },
      partecipazioni: { include: { condomino: true } },
    },
  });
  if (!assemblea || !condominio) return notFound();

  const convocazioneText = generaConvocazione({
    condominio: condominio.denominazione,
    indirizzo: condominio.indirizzo,
    tipo: assemblea.tipo,
    luogo: assemblea.luogo,
    dataPrima: assemblea.dataPrimaConvocazione,
    oraPrima: assemblea.oraPrimaConvocazione,
    dataSeconda: assemblea.dataSecondaConvocazione,
    oraSeconda: assemblea.oraSecondaConvocazione,
    punti: assemblea.puntiOdg.map((p) => ({ numero: p.numero, oggetto: p.oggetto })),
    dataInvio: assemblea.dataInvioConvocazione,
  });

  const condominiSim = assemblea.partecipazioni
    .map((p) => ({
      partecipazioneId: p.id,
      nome: nomeCompleto(p.condomino),
      millesimi: p.millesimiRappresentati,
      presente: p.presente,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));

  return (
    <div className="space-y-6">
      <PageHeader
        titolo={assemblea.oggettoSintesi ?? 'Assemblea'}
        sottotitolo={`Assemblea ${assemblea.tipo} · ${condominio.denominazione}`}
        azione={<Link href="/assemblee" className="btn-secondary btn-sm">← Assemblee</Link>}
      />

      {/* Convocazione */}
      <Card titolo="Avviso di convocazione (art. 66 disp. att. c.c.)">
        <CopyBox testo={convocazioneText} etichetta="Copia convocazione" />
      </Card>

      {/* Ordine del giorno */}
      <Card titolo={`Ordine del giorno (${assemblea.puntiOdg.length} punti)`}>
        {assemblea.puntiOdg.length === 0 ? (
          <EmptyState messaggio="Nessun punto all'ordine del giorno." />
        ) : (
          <ul className="space-y-2">
            {assemblea.puntiOdg.map((p) => {
              const regola = REGOLE_MAGGIORANZA[p.tipoMaggioranza as TipoMaggioranza] ?? REGOLE_MAGGIORANZA.ordinaria;
              return (
                <li key={p.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{p.numero}. {p.oggetto}</div>
                    <div className="text-xs text-slate-400">{regola.etichetta} · {regola.riferimento}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.votato && <Badge tono={p.esito === 'approvato' ? 'verde' : 'rosso'}>{p.esito}</Badge>}
                    <form action={eliminaPunto}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="assembleaId" value={assemblea.id} />
                      <ConfirmSubmit>✕</ConfirmSubmit>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3">
          <Collapsible titolo="Aggiungi punto all'ordine del giorno">
            <form action={creaPunto} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input type="hidden" name="assembleaId" value={assemblea.id} />
              <div className="md:col-span-2"><label className="label">Oggetto</label><input name="oggetto" className="input" required /></div>
              <div>
                <label className="label">Maggioranza richiesta</label>
                <select name="tipoMaggioranza" className="input">
                  {Object.values(REGOLE_MAGGIORANZA).map((r) => (
                    <option key={r.codice} value={r.codice}>{r.etichetta}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3"><SubmitButton>Aggiungi punto</SubmitButton></div>
            </form>
          </Collapsible>
        </div>
      </Card>

      {/* Riferimento maggioranze */}
      <InfoBox titolo="Le maggioranze deliberative (art. 1136 c.c.)">
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {Object.values(REGOLE_MAGGIORANZA).map((r) => (
            <li key={r.codice}><strong>{r.etichetta}:</strong> {r.descrizione}</li>
          ))}
        </ul>
      </InfoBox>

      {/* Simulatore quorum */}
      <Card titolo="Simulatore quorum e verbale (Agente Assembleare)">
        {condominiSim.length === 0 ? (
          <EmptyState messaggio="Nessun partecipante. Verifica l'anagrafe condominiale." />
        ) : (
          <Simulatore
            assembleaId={assemblea.id}
            condominioNome={condominio.denominazione}
            tipoAssemblea={assemblea.tipo}
            data={(assemblea.dataSecondaConvocazione ?? assemblea.dataPrimaConvocazione)?.toISOString() ?? null}
            ora={assemblea.oraSecondaConvocazione ?? assemblea.oraPrimaConvocazione}
            luogo={assemblea.luogo}
            condomini={condominiSim}
            punti={assemblea.puntiOdg.map((p) => ({
              id: p.id,
              numero: p.numero,
              oggetto: p.oggetto,
              tipoMaggioranza: (p.tipoMaggioranza as TipoMaggioranza) ?? 'ordinaria',
            }))}
          />
        )}
      </Card>

      {/* Verbale definitivo */}
      <Card titolo="Verbale definitivo">
        <form action={salvaVerbale} className="space-y-3">
          <input type="hidden" name="assembleaId" value={assemblea.id} />
          <textarea name="verbaleTesto" rows={10} className="input font-mono text-xs" defaultValue={assemblea.verbaleTesto ?? ''} placeholder="Incolla qui la bozza generata e integrala con le dichiarazioni a verbale…" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="verbaleApprovato" defaultChecked={assemblea.verbaleApprovato} /> Verbale approvato</label>
            <select name="stato" defaultValue={assemblea.stato} className="input max-w-[180px]">
              <option value="convocata">Convocata</option>
              <option value="svolta">Svolta</option>
              <option value="annullata">Annullata</option>
            </select>
            <SubmitButton>Salva verbale</SubmitButton>
          </div>
        </form>
      </Card>

      <Card titolo="Zona pericolosa">
        <form action={eliminaAssemblea}>
          <input type="hidden" name="id" value={assemblea.id} />
          <ConfirmSubmit messaggio="Eliminare l'assemblea con punti e partecipazioni?" className="btn-danger">Elimina assemblea</ConfirmSubmit>
        </form>
      </Card>
    </div>
  );
}
