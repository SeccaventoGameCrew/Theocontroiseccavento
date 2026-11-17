import Link from 'next/link';
import { ReactNode } from 'react';

export function PageHeader({
  titolo,
  sottotitolo,
  azione,
}: {
  titolo: string;
  sottotitolo?: string;
  azione?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{titolo}</h1>
        {sottotitolo && <p className="mt-1 text-sm text-slate-500">{sottotitolo}</p>}
      </div>
      {azione}
    </div>
  );
}

export function Card({
  children,
  className = '',
  titolo,
  azione,
}: {
  children: ReactNode;
  className?: string;
  titolo?: string;
  azione?: ReactNode;
}) {
  return (
    <div className={`card ${className}`}>
      {(titolo || azione) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          {titolo && <h2 className="text-sm font-semibold text-slate-700">{titolo}</h2>}
          {azione}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function StatCard({
  etichetta,
  valore,
  sub,
  tono = 'neutro',
}: {
  etichetta: string;
  valore: string;
  sub?: string;
  tono?: 'neutro' | 'positivo' | 'attenzione' | 'critico';
}) {
  const toni: Record<string, string> = {
    neutro: 'text-slate-900',
    positivo: 'text-emerald-600',
    attenzione: 'text-amber-600',
    critico: 'text-red-600',
  };
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{etichetta}</div>
      <div className={`mt-1 text-2xl font-bold ${toni[tono]}`}>{valore}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function Badge({
  children,
  tono = 'neutro',
}: {
  children: ReactNode;
  tono?: 'neutro' | 'verde' | 'rosso' | 'giallo' | 'blu';
}) {
  const toni: Record<string, string> = {
    neutro: 'bg-slate-100 text-slate-700',
    verde: 'bg-emerald-100 text-emerald-700',
    rosso: 'bg-red-100 text-red-700',
    giallo: 'bg-amber-100 text-amber-700',
    blu: 'bg-brand-100 text-brand-700',
  };
  return <span className={`badge ${toni[tono]}`}>{children}</span>;
}

export function EmptyState({ messaggio }: { messaggio: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {messaggio}
    </div>
  );
}

export function LinkButton({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Link href={href} className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'}>
      {children}
    </Link>
  );
}

export function InfoBox({ titolo, children }: { titolo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">
      <div className="mb-1 font-semibold">{titolo}</div>
      <div className="text-brand-800/90">{children}</div>
    </div>
  );
}
