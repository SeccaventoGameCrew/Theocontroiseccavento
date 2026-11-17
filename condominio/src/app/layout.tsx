import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gestione Condominio',
  description:
    'Applicazione web per la gestione completa del condominio in Italia, conforme al Codice Civile e alle disposizioni di attuazione.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
