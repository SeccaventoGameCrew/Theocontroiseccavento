import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';

const COOKIE = 'condominio_corrente';

// Restituisce l'id del condominio attualmente selezionato (cookie) o il primo disponibile.
export async function getCondominioId(): Promise<string | null> {
  const fromCookie = cookies().get(COOKIE)?.value;
  if (fromCookie) {
    const exists = await prisma.condominio.findUnique({ where: { id: fromCookie } });
    if (exists) return fromCookie;
  }
  const primo = await prisma.condominio.findFirst({ orderBy: { createdAt: 'asc' } });
  return primo?.id ?? null;
}

export async function getCondominioCorrente() {
  const id = await getCondominioId();
  if (!id) return null;
  return prisma.condominio.findUnique({ where: { id } });
}

export async function getListaCondomini() {
  return prisma.condominio.findMany({ orderBy: { denominazione: 'asc' } });
}
