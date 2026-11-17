// Utilità di formattazione per il contesto italiano.

export function euro(value: number | null | undefined): string {
  const n = typeof value === 'number' && isFinite(value) ? value : 0;
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(n);
}

export function numero(value: number | null | undefined, decimali = 2): string {
  const n = typeof value === 'number' && isFinite(value) ? value : 0;
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimali,
    maximumFractionDigits: decimali,
  }).format(n);
}

export function millesimi(value: number | null | undefined): string {
  return numero(value, 2);
}

export function dataIt(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function dataOraIt(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

// Numero di giorni tra oggi e una data (positivo = nel futuro).
export function giorniAllaData(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return null;
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - oggi.getTime()) / 86400000);
}

export function nomeCompleto(p: {
  tipoPersona?: string | null;
  nome?: string | null;
  cognome?: string | null;
  ragioneSociale?: string | null;
}): string {
  if (p.tipoPersona === 'giuridica' || p.ragioneSociale) {
    return p.ragioneSociale || 'Persona giuridica';
  }
  return [p.cognome, p.nome].filter(Boolean).join(' ') || 'Senza nome';
}
