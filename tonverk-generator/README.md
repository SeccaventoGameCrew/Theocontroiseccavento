# Tonverk Song Generator

Descrivi una canzone a parole, ottieni un **progetto per Elektron Tonverk** pronto da caricare
sulla macchina: pattern per ogni sezione (intro, strofa, ritornello, break, finale), tutti i
trig con note, accordi, velocity e durate, più l'arrangiamento.

```
tvgen "techno ipnotica a 132 bpm in la minore, intro lunga, break con pad, 5 minuti" -t ./TEMPLATE
```

> ⚠️ **Sperimentale.** Elektron non documenta il formato dei progetti Tonverk. Il generatore
> scrive il database del progetto basandosi su un reverse engineering della community
> (Tonverk OS 1.3.x) e **non è ancora stato provato su una macchina reale**. Lavora sempre su
> copie, tieni un backup della scheda SD e prova prima con un progetto usa e getta.

## Come funziona

1. **Composizione.** Claude (API Anthropic) trasforma il prompt in una canzone strutturata:
   tonalità, BPM, swing, pattern con i trig di ogni traccia e l'ordine delle sezioni.
   Senza chiave API c'è un compositore offline a regole (techno, house, hip hop/lofi, trap,
   drum and bass, ambient, synthwave, pop, reggaeton) che legge genere, BPM, tonalità,
   umore e durata dal prompt.
2. **Suoni dal tuo template.** Il generatore non inventa i suoni: parte da un progetto che hai
   salvato sul Tonverk con i suoni caricati sulle 8 tracce audio. Ogni pattern generato riceve
   una copia di quei suoni (sul Tonverk ogni pattern possiede i propri preset).
3. **Scrittura del progetto.** La cartella del template viene copiata e nel database RocksDB
   vengono riscritti pattern (nome, BPM, lunghezza, swing), sequenze e trig. Tutto il resto
   (sample, routing, FX, mixer, impostazioni) resta quello del template. Il file viene scritto
   con le stesse opzioni del firmware (SST format_version 5, checksum XXH3, Snappy) e riletto
   byte per byte per verifica.

## App per Mac

**Tonverk Generator.app** è un'app macOS (Apple Silicon e Intel, macOS 11+) con finestra
nativa: scrivi il prompt, scegli la cartella del template con il selettore del Finder, genera,
**ascolta subito l'anteprima** con il sintetizzatore integrato (barra dell'arrangiamento
cliccabile, spazio = play/stop) e con **Copia sulla scheda SD** il progetto finisce accanto al
template sulla scheda. La chiave API di Claude si inserisce in *Impostazioni* e viene salvata
nel Portachiavi di macOS. Le canzoni generate restano in `~/Musica/Tonverk Generator` e sono
riapribili dalla lista *Recenti*.

### Scaricarla

L'app viene compilata automaticamente da GitHub Actions su un Mac (workflow
*Tonverk Generator - app macOS*): apri l'ultima esecuzione nella scheda **Actions** del
repository e scarica l'artifact `TonverkGenerator-macOS-arm64` (Mac con chip Apple) oppure
`TonverkGenerator-macOS-x86_64` (Mac Intel). Con un tag `tvgen-v…` i `.dmg` vengono anche
pubblicati in una Release.

La versione x86_64 funziona anche sui Mac con chip Apple tramite Rosetta 2: al primo avvio
macOS propone di installare Rosetta, basta accettare. Per una versione nativa arm64 compila
l'app sul tuo Mac con `macapp/build.sh` (vedi sotto).

Apri il `.dmg` e trascina l'app in *Applicazioni*. L'app non è firmata con un certificato
Apple Developer, quindi al primo avvio macOS la blocca: fai **clic destro → Apri**, oppure vai in
*Impostazioni di Sistema → Privacy e sicurezza* e premi **Apri comunque**. In alternativa, da
Terminale: `xattr -dr com.apple.quarantine "/Applications/Tonverk Generator.app"`.

### Compilarla sul tuo Mac

Serve Python 3.10+ (es. `brew install python@3.12`):

```bash
cd tonverk-generator
PYTHON=python3.12 ./macapp/build.sh
open "dist/Tonverk Generator.app"
```

Lo script crea un ambiente isolato, l'icona, l'app (PyInstaller), la firma ad-hoc, esegue un
autotest dell'app compilata e produce `dist/TonverkGenerator-<versione>-<arch>.dmg`.
Il log dell'app è in `~/Library/Logs/Tonverk Generator.log`.

## Installazione da riga di comando

Serve Python 3.10 o successivo.

```bash
cd tonverk-generator
pip install -e .
export ANTHROPIC_API_KEY=...   # facoltativo: senza chiave usa il compositore offline
```

## 1. Prepara il template sul Tonverk (una volta sola)

Crea un progetto nuovo e carica un suono per traccia secondo questo schema (modificabile, vedi
sotto):

| Traccia | Ruolo | Tipo |
|---|---|---|
| T1 | kick | drum |
| T2 | snare / clap | drum |
| T3 | hats | drum |
| T4 | perc | drum |
| T5 | basso | melodico, mono |
| T6 | accordi (piano, rhodes, stab) | melodico, polifonico |
| T7 | lead / melodia / arp | melodico |
| T8 | pad / atmosfera | melodico, polifonico |

Consigli:

- metti **almeno un trig sulla traccia 1** prima di salvare: così il generatore legge dal
  template il formato esatto degli id dei trig invece di dedurlo;
- i suoni drum suonano alla nota del sample (C4 = 60): se un suono è intonato diversamente
  cambia `note` nel layout;
- regola già nel template FX, send e mixer: vengono copiati in ogni pattern.

Salva il progetto (es. `TEMPLATE`), collega la scheda SD al computer e copia la cartella del
progetto sul disco. Controlla che sia leggibile:

```bash
tvgen inspect ./TEMPLATE
```

### Layout personalizzato

Se le tue tracce hanno ruoli diversi, salva il layout di default e modificalo:

```bash
tvgen layout > TEMPLATE/tvgen-layout.json
```

Ogni traccia ha `role`, `kind` (`drum` o `melodic`), `note` (nota dei trig drum), `low`/`high`
(estensione per le parti melodiche), `poly` (accordi sì/no) e `hint` (descrizione del suono,
usata da Claude per scrivere parti adatte). Il file dentro il template viene letto
automaticamente e non viene copiato nel progetto generato.

## 2. Genera

Riga di comando:

```bash
tvgen "lofi hip hop malinconico \"Pioggia\", rhodes caldo, 84 bpm" -t ./TEMPLATE -o ./output
```

Opzioni utili:

| Opzione | |
|---|---|
| `--engine claude\|offline\|auto` | compositore (default `auto`: Claude se c'è una chiave) |
| `--model` | modello Claude (default `claude-opus-5-5`) |
| `--effort low…max` | quanto Claude ragiona sulla composizione (default `high`) |
| `--revise "ritornello più energico"` | dopo la generazione chiede a Claude una revisione |
| `--song song.json` | rigenera il progetto da un `song.json` (anche modificato a mano) |
| `--quantize` | trig tutti sulla griglia, niente micro-timing |
| `--name` | nome del progetto (default: titolo della canzone) |

Interfaccia web locale:

```bash
tvgen web -t ./TEMPLATE      # poi apri http://127.0.0.1:8765
```

Scrivi il prompt, premi **Genera**, scarica lo zip; con **Rigenera** chiedi modifiche a Claude.

## 3. Cosa ottieni

```
output/PIOGGIA/
├── PIOGGIA/              ← il progetto Tonverk da copiare sulla scheda SD
├── arrangiamento.html    ← foglio con arrangiamento, suoni suggeriti, griglie dei pattern
├── song.mid              ← tutte le note, canale N = traccia N
├── preview_gm.mid        ← anteprima General MIDI da ascoltare in qualsiasi player/DAW
├── songverk.json         ← arrangiamento per Songverk (song mode via MIDI)
├── song.json             ← la canzone in forma modificabile (rigenerabile con --song)
└── layout.json
```

Copia la cartella del progetto sulla scheda SD **accanto al template**, riaccendi il Tonverk e
caricala. I pattern sono in ordine nel banco A (A01, A02, …).

**Arrangiamento.** Il formato del song mode del Tonverk non è ancora stato decodificato, quindi
la Song non viene scritta nel progetto. Hai due strade: ricrearla nel song mode seguendo la
tabella di `arrangiamento.html` (una riga per sezione, con le ripetizioni), oppure importare
`songverk.json` in [Songverk](https://github.com/romainguerif/songverk), che suona
l'arrangiamento da browser con Program Change.

## Limiti noti e cose da verificare sulla macchina

- **Velocity**: nel corpus analizzato compare solo il valore 201, il default del firmware, che
  coincide con velocity MIDI 100 su scala 0–255. Il generatore usa quella scala.
- **Id dei trig**: se il template non contiene trig, il formato degli id di eventi e tick è
  dedotto (10 cifre, come gli altri id a 32 bit). Con un trig nel template viene letto.
- **Micro-timing**: posizioni fuori griglia (es. rulli in 1/32) vengono scritte come tick a 480
  PPQN, lo stesso formato delle registrazioni live non quantizzate; con `--quantize` si evitano.
- **Song mode** non scritto (vedi sopra); scala/accordi del pattern lasciati come nel template.
- Tracce 9–16 (bus, send FX, mix): copiate dal template, non sequenziate.
- Usa un progetto **salvato** come template, non la base interna `active_project`.

Se qualcosa non torna, `tvgen inspect --dump CARTELLA > dump.txt` produce un dump completo
utile per capire cosa cambia tra un progetto salvato dalla macchina e uno generato.

## Test

```bash
pip install -e ".[test]"
pytest
```

I test usano un template **sintetico** costruito dallo schema documentato
(`tvgen/tonverk/fixture.py`): serve solo per i test, non va caricato sulla macchina.

## Crediti

- Formato dei progetti: reverse engineering di
  [tonverk-merger](https://github.com/romainguerif/tonverk-merger) (Romain Guerif, MIT).
- Song mode esterno: [Songverk](https://github.com/romainguerif/songverk).
- Progetto indipendente, non affiliato con Elektron. Tonverk è un marchio di Elektron Music Machines.
