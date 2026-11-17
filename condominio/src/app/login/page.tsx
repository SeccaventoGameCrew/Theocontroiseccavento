import { redirect } from 'next/navigation';
import { isAutenticato } from '@/lib/auth';
import LoginForm from './LoginForm';

export default function LoginPage() {
  if (isAutenticato()) redirect('/');
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-700 to-brand-900 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="text-3xl font-bold">Gestione Condominio</div>
          <div className="mt-1 text-sm text-brand-100">
            Amministrazione conforme al Codice Civile italiano
          </div>
        </div>
        <div className="card p-6">
          <LoginForm />
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <div className="font-semibold text-slate-600">Accesso dimostrativo</div>
            Email: <code>admin@condominio.it</code> — Password: <code>condominio2026</code>
          </div>
        </div>
      </div>
    </div>
  );
}
