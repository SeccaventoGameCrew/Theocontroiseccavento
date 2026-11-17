'use client';

import { useState } from 'react';

export default function CopyBox({ testo, etichetta = 'Copia testo' }: { testo: string; etichetta?: string }) {
  const [copiato, setCopiato] = useState(false);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(testo);
              setCopiato(true);
              setTimeout(() => setCopiato(false), 2000);
            } catch {
              setCopiato(false);
            }
          }}
        >
          {copiato ? '✓ Copiato' : etichetta}
        </button>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        {testo}
      </pre>
    </div>
  );
}
