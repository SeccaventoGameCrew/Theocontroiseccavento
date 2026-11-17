'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { login } from '@/app/actions/auth';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Accesso in corso…' : 'Accedi'}
    </button>
  );
}

export default function LoginForm() {
  const [errore, formAction] = useFormState(login, undefined);
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label">Email</label>
        <input name="email" type="email" required className="input" defaultValue="admin@condominio.it" />
      </div>
      <div>
        <label className="label">Password</label>
        <input name="password" type="password" required className="input" />
      </div>
      {errore && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{errore}</div>}
      <Submit />
    </form>
  );
}
