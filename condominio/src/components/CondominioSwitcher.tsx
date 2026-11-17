'use client';

import { cambiaCondominio } from '@/app/actions/sistema';

export default function CondominioSwitcher({
  condomini,
  correnteId,
}: {
  condomini: { id: string; denominazione: string }[];
  correnteId: string | null;
}) {
  if (condomini.length === 0) return null;
  return (
    <form action={cambiaCondominio}>
      <select
        name="condominioId"
        defaultValue={correnteId ?? ''}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input max-w-xs"
      >
        {condomini.map((c) => (
          <option key={c.id} value={c.id}>
            {c.denominazione}
          </option>
        ))}
      </select>
    </form>
  );
}
