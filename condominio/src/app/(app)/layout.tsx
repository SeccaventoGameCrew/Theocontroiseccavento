import { redirect } from 'next/navigation';
import { isAutenticato } from '@/lib/auth';
import { getCondominioId, getListaCondomini } from '@/lib/condominio';
import Sidebar from '@/components/Sidebar';
import CondominioSwitcher from '@/components/CondominioSwitcher';
import { logout } from '@/app/actions/sistema';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isAutenticato()) {
    redirect('/login');
  }

  const [condomini, correnteId] = await Promise.all([getListaCondomini(), getCondominioId()]);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-lg font-bold text-brand-700">Gestione Condominio</div>
          <div className="text-xs text-slate-400">Conforme al Codice Civile</div>
        </div>
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
          <CondominioSwitcher condomini={condomini} correnteId={correnteId} />
          <form action={logout}>
            <button className="btn-secondary btn-sm" type="submit">
              Esci
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>
        <footer className="border-t border-slate-200 bg-white px-6 py-3 text-center text-xs text-slate-400">
          Applicazione dimostrativa di gestione condominiale · I calcoli normativi (quorum, riparti, adempimenti) sono
          strumenti di supporto e non sostituiscono la consulenza di un professionista abilitato.
        </footer>
      </div>
    </div>
  );
}
