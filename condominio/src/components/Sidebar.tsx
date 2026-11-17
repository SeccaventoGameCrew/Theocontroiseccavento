'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const VOCI = [
  { href: '/', label: 'Cruscotto', icon: '🏠' },
  { href: '/anagrafe', label: 'Anagrafe condominiale', icon: '👥' },
  { href: '/millesimi', label: 'Tabelle millesimali', icon: '📐' },
  { href: '/economia', label: 'Gestione economica', icon: '💶' },
  { href: '/assemblee', label: 'Assemblee', icon: '🗳️' },
  { href: '/scadenzario', label: 'Scadenzario adempimenti', icon: '📅' },
  { href: '/fornitori', label: 'Fornitori e impianti', icon: '🔧' },
  { href: '/registri', label: 'Registri obbligatori', icon: '📚' },
  { href: '/privacy', label: 'Privacy / GDPR', icon: '🔒' },
  { href: '/impostazioni', label: 'Condominio e amministratore', icon: '⚙️' },
  { href: '/normativa', label: 'Guida normativa', icon: '⚖️' },
];

export default function Sidebar() {
  const path = usePathname();
  const attivo = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {VOCI.map((v) => (
        <Link
          key={v.href}
          href={v.href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
            attivo(v.href)
              ? 'bg-brand-600 font-semibold text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span className="text-base">{v.icon}</span>
          <span>{v.label}</span>
        </Link>
      ))}
    </nav>
  );
}
