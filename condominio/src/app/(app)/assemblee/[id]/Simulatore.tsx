'use client';

import { useMemo, useState } from 'react';
import {
  verificaCostituzione,
  verificaDelibera,
  REGOLE_MAGGIORANZA,
  TipoMaggioranza,
  TOTALE_MILLESIMI,
} from '@/lib/agenti/assembleare';
import { generaVerbale } from '@/lib/agenti/documenti';
import { salvaEsitoPunto } from '../actions';
import CopyBox from '@/components/CopyBox';

interface CondominoSim {
  partecipazioneId: string;
  nome: string;
  millesimi: number;
  presente: boolean;
}
interface PuntoSim {
  id: string;
  numero: number;
  oggetto: string;
  tipoMaggioranza: TipoMaggioranza;
}

interface Props {
  assembleaId: string;
  condominioNome: string;
  tipoAssemblea: string;
  data: string | null;
  ora: string | null;
  luogo: string | null;
  condomini: CondominoSim[];
  punti: PuntoSim[];
}

export default function Simulatore(props: Props) {
  const [conv, setConv] = useState<1 | 2>(2);
  const [presenti, setPresenti] = useState<Record<string, boolean>>(
    Object.fromEntries(props.condomini.map((c) => [c.partecipazioneId, c.presente])),
  );

  const partecipantiTotali = props.condomini.length;
  const presentiTeste = props.condomini.filter((c) => presenti[c.partecipazioneId]).length;
  const presentiMillesimi = props.condomini
    .filter((c) => presenti[c.partecipazioneId])
    .reduce((s, c) => s + c.millesimi, 0);

  const costituzione = useMemo(
    () =>
      verificaCostituzione({
        convocazione: conv,
        partecipantiTotali,
        millesimiTotali: TOTALE_MILLESIMI,
        presentiTeste,
        presentiMillesimi,
      }),
    [conv, partecipantiTotali, presentiTeste, presentiMillesimi],
  );

  // Voti per punto (default: tutti i presenti favorevoli)
  const [voti, setVoti] = useState<Record<string, { favT: number; favM: number }>>({});
  const getVoto = (id: string) => voti[id] ?? { favT: presentiTeste, favM: Math.round(presentiMillesimi * 100) / 100 };

  const esitoPunto = (p: PuntoSim) => {
    const v = getVoto(p.id);
    return verificaDelibera({
      convocazione: conv,
      tipoMaggioranza: p.tipoMaggioranza,
      partecipantiTotali,
      presentiTeste,
      favorevoliTeste: v.favT,
      favorevoliMillesimi: v.favM,
    });
  };

  const verbale = useMemo(
    () =>
      generaVerbale({
        condominio: props.condominioNome,
        tipo: props.tipoAssemblea,
        convocazione: conv,
        data: props.data ? new Date(props.data) : null,
        ora: props.ora,
        luogo: props.luogo,
        partecipantiTotali,
        presentiTeste,
        presentiMillesimi,
        costituita: costituzione.valida,
        punti: props.punti.map((p) => {
          const v = getVoto(p.id);
          const e = esitoPunto(p);
          return {
            numero: p.numero,
            oggetto: p.oggetto,
            tipoMaggioranza: p.tipoMaggioranza,
            favorevoliTeste: v.favT,
            favorevoliMillesimi: v.favM,
            contrariTeste: Math.max(0, presentiTeste - v.favT),
            contrariMillesimi: Math.max(0, Math.round((presentiMillesimi - v.favM) * 100) / 100),
            astenutiTeste: 0,
            astenutiMillesimi: 0,
            esito: e.approvata ? 'approvato' : 'respinto',
          };
        }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conv, presenti, voti],
  );

  return (
    <div className="space-y-5">
      {/* Convocazione */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-slate-600">Convocazione:</span>
        {[1, 2].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setConv(n as 1 | 2)}
            className={conv === n ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          >
            {n === 1 ? 'Prima' : 'Seconda'} convocazione
          </button>
        ))}
      </div>

      {/* Presenze */}
      <div className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
          Presenze (spunta i condomini presenti o rappresentati per delega)
        </div>
        <div className="grid gap-1 p-3 sm:grid-cols-2">
          {props.condomini.map((c) => (
            <label key={c.partecipazioneId} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-slate-50">
              <span className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!presenti[c.partecipazioneId]}
                  onChange={(e) => setPresenti((prev) => ({ ...prev, [c.partecipazioneId]: e.target.checked }))}
                />
                {c.nome}
              </span>
              <span className="text-xs text-slate-400">{c.millesimi.toFixed(2)} mill.</span>
            </label>
          ))}
        </div>
      </div>

      {/* Esito costituzione */}
      <div className={`rounded-lg border p-4 ${costituzione.valida ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">
            {costituzione.valida ? '✅ Assemblea validamente costituita' : '⛔ Assemblea NON costituita'}
          </div>
          <div className="text-xs text-slate-500">
            Presenti: {presentiTeste}/{partecipantiTotali} teste · {presentiMillesimi.toFixed(2)}/{TOTALE_MILLESIMI} mill.
          </div>
        </div>
        <div className="mt-1 text-xs text-slate-600">{costituzione.regola}</div>
        <div className="text-xs text-slate-500">
          Richiesti: {costituzione.tesateRichieste} teste e {costituzione.millesimiRichiesti.toFixed(2)} millesimi.
        </div>
      </div>

      {/* Punti / delibere */}
      <div className="space-y-3">
        {props.punti.map((p) => {
          const regola = REGOLE_MAGGIORANZA[p.tipoMaggioranza];
          const v = getVoto(p.id);
          const esito = esitoPunto(p);
          return (
            <div key={p.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Punto {p.numero} — {p.oggetto}</div>
                  <div className="text-xs text-slate-500">{regola.etichetta} · {regola.riferimento}</div>
                </div>
                <span className={`badge ${esito.approvata ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {costituzione.valida ? (esito.approvata ? 'APPROVATO' : 'RESPINTO') : 'non deliberabile'}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-500">
                  Favorevoli (teste)
                  <input
                    type="number"
                    min={0}
                    max={presentiTeste}
                    value={v.favT}
                    onChange={(e) => setVoti((prev) => ({ ...prev, [p.id]: { ...getVoto(p.id), favT: Number(e.target.value) } }))}
                    className="input btn-sm ml-1 w-20"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Favorevoli (millesimi)
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={v.favM}
                    onChange={(e) => setVoti((prev) => ({ ...prev, [p.id]: { ...getVoto(p.id), favM: Number(e.target.value) } }))}
                    className="input btn-sm ml-1 w-24"
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setVoti((prev) => ({ ...prev, [p.id]: { favT: presentiTeste, favM: Math.round(presentiMillesimi * 100) / 100 } }))}
                >
                  Tutti favorevoli
                </button>
              </div>

              <div className="mt-2 text-xs text-slate-600">{esito.motivazione}</div>
              <div className="text-xs text-slate-400">{esito.dettaglio}</div>

              {/* Persistenza esito */}
              <form action={salvaEsitoPunto} className="mt-2">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="assembleaId" value={props.assembleaId} />
                <input type="hidden" name="favorevoliTeste" value={v.favT} />
                <input type="hidden" name="favorevoliMillesimi" value={v.favM} />
                <input type="hidden" name="contrariTeste" value={Math.max(0, presentiTeste - v.favT)} />
                <input type="hidden" name="contrariMillesimi" value={Math.max(0, Math.round((presentiMillesimi - v.favM) * 100) / 100)} />
                <input type="hidden" name="esito" value={esito.approvata ? 'approvato' : 'respinto'} />
                <button type="submit" className="btn-secondary btn-sm">Registra esito a verbale</button>
              </form>
            </div>
          );
        })}
      </div>

      {/* Bozza verbale */}
      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-brand-700">Bozza di verbale generata</summary>
        <div className="p-3">
          <CopyBox testo={verbale} etichetta="Copia verbale" />
        </div>
      </details>
    </div>
  );
}
