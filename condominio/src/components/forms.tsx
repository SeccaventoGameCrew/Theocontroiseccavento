'use client';

import { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export function SubmitButton({ children, className = 'btn-primary' }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? 'Salvataggio…' : children}
    </button>
  );
}

export function ConfirmSubmit({
  children = 'Elimina',
  messaggio = 'Confermi l\'eliminazione? L\'operazione non è reversibile.',
  className = 'btn-danger btn-sm',
}: {
  children?: ReactNode;
  messaggio?: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(messaggio)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

// Pannello richiudibile per i form di inserimento.
export function Collapsible({ titolo, children }: { titolo: string; children: ReactNode }) {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-brand-700">
        <span>➕ {titolo}</span>
        <span className="text-slate-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}
