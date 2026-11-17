'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCondominioId } from '@/lib/condominio';

function toDateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = String(v || '');
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function creaAssemblea(formData: FormData) {
  const condominioId = await getCondominioId();
  if (!condominioId) return;

  const ass = await prisma.assemblea.create({
    data: {
      condominioId,
      tipo: String(formData.get('tipo') || 'ordinaria'),
      oggettoSintesi: String(formData.get('oggettoSintesi') || '') || null,
      luogo: String(formData.get('luogo') || '') || null,
      dataPrimaConvocazione: toDateOrNull(formData.get('dataPrimaConvocazione')),
      oraPrimaConvocazione: String(formData.get('oraPrimaConvocazione') || '') || null,
      dataSecondaConvocazione: toDateOrNull(formData.get('dataSecondaConvocazione')),
      oraSecondaConvocazione: String(formData.get('oraSecondaConvocazione') || '') || null,
    },
  });

  // Precompila le partecipazioni con i millesimi di proprietà di ciascun condomino.
  const tabella = await prisma.tabellaMillesimale.findFirst({
    where: { condominioId, tipo: 'proprieta' },
    include: { quote: { include: { unita: { include: { titolarita: true } } } } },
  });
  const perCondomino = new Map<string, number>();
  if (tabella) {
    for (const q of tabella.quote) {
      const tit = q.unita.titolarita.find((t) => t.tipo === 'proprietario') ?? q.unita.titolarita[0];
      if (!tit) continue;
      perCondomino.set(tit.condominoId, (perCondomino.get(tit.condominoId) ?? 0) + q.millesimi);
    }
  }
  const condomini = await prisma.condomino.findMany({ where: { condominioId } });
  for (const c of condomini) {
    await prisma.partecipazione.create({
      data: { assembleaId: ass.id, condominoId: c.id, presente: false, millesimiRappresentati: perCondomino.get(c.id) ?? 0 },
    });
  }

  redirect(`/assemblee/${ass.id}`);
}

export async function eliminaAssemblea(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.assemblea.delete({ where: { id } });
  revalidatePath('/assemblee');
  redirect('/assemblee');
}

export async function creaPunto(formData: FormData) {
  const assembleaId = String(formData.get('assembleaId') || '');
  if (!assembleaId) return;
  const count = await prisma.puntoOdg.count({ where: { assembleaId } });
  await prisma.puntoOdg.create({
    data: {
      assembleaId,
      numero: count + 1,
      oggetto: String(formData.get('oggetto') || 'Punto'),
      tipoMaggioranza: String(formData.get('tipoMaggioranza') || 'ordinaria'),
    },
  });
  revalidatePath(`/assemblee/${assembleaId}`);
}

export async function eliminaPunto(formData: FormData) {
  const id = String(formData.get('id') || '');
  const assembleaId = String(formData.get('assembleaId') || '');
  if (id) await prisma.puntoOdg.delete({ where: { id } });
  revalidatePath(`/assemblee/${assembleaId}`);
}

export async function salvaPresenze(formData: FormData) {
  const assembleaId = String(formData.get('assembleaId') || '');
  if (!assembleaId) return;
  const partecipazioni = await prisma.partecipazione.findMany({ where: { assembleaId } });
  for (const p of partecipazioni) {
    const presente = formData.get(`presente_${p.id}`) === 'on';
    const delegatoNome = String(formData.get(`delega_${p.id}`) || '') || null;
    await prisma.partecipazione.update({
      where: { id: p.id },
      data: { presente, perDelega: !!delegatoNome, delegatoNome },
    });
  }
  revalidatePath(`/assemblee/${assembleaId}`);
}

export async function salvaEsitoPunto(formData: FormData) {
  const id = String(formData.get('id') || '');
  const assembleaId = String(formData.get('assembleaId') || '');
  if (!id) return;
  await prisma.puntoOdg.update({
    where: { id },
    data: {
      votato: true,
      favorevoliTeste: Number(formData.get('favorevoliTeste') || 0),
      favorevoliMillesimi: Number(formData.get('favorevoliMillesimi') || 0),
      contrariTeste: Number(formData.get('contrariTeste') || 0),
      contrariMillesimi: Number(formData.get('contrariMillesimi') || 0),
      astenutiTeste: Number(formData.get('astenutiTeste') || 0),
      astenutiMillesimi: Number(formData.get('astenutiMillesimi') || 0),
      esito: String(formData.get('esito') || '') || null,
    },
  });
  revalidatePath(`/assemblee/${assembleaId}`);
}

export async function salvaVerbale(formData: FormData) {
  const assembleaId = String(formData.get('assembleaId') || '');
  if (!assembleaId) return;
  await prisma.assemblea.update({
    where: { id: assembleaId },
    data: {
      verbaleTesto: String(formData.get('verbaleTesto') || '') || null,
      verbaleApprovato: formData.get('verbaleApprovato') === 'on',
      stato: String(formData.get('stato') || 'convocata'),
    },
  });
  revalidatePath(`/assemblee/${assembleaId}`);
}
