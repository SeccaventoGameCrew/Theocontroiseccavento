
# Theø vs. I Seccavento

## Come avviare il gioco

1. Clona questo repository o scaricalo come ZIP.
2. Assicurati che il file `index.html` sia nella root.
3. Carica tutto su GitHub in questo stesso formato.
4. Attiva GitHub Pages:
   - Vai su Settings > Pages
   - Source: `main`, Folder: `/ (root)`
   - Salva

Il gioco sarà disponibile al link:
https://<nome-utente>.github.io/<nome-repo>/

## Comandi

- Frecce sinistra/destra: muovi Theo
- Freccia su: salta

---

# cutecore ♡ — visualizzatore musicale

Nella cartella [`cutecore/`](cutecore/) c'è un'app web (installabile sul telefono come PWA) che
**compone una canzone cutecore** e **la disegna mentre suona**, con sei pannelli in stile "strumento da laboratorio":

| Pannello | Cosa mostra |
| --- | --- |
| 01 SHEET | la canzone "stampata" come sei nastri intrecciati, uno per banda di frequenza (penna Mesh / Braid / Dots) |
| 02 WAVEFORM · SCOPE · SPECTRUM · VECTOR | forma d'onda e loudness, oscilloscopio, spettro, goniometro stereo + LUFS momentary / integrated e picco |
| 03 ROLL | piano roll che scorre, con battute e note che suonano |
| 04 ROOTS | grafo delle note: più una nota suona, più cresce; linee = percorso della melodia, puntini = colpi di batteria |
| 05 FOUNTAIN | fontana di particelle guidata dai canali sinistro/destro |
| 06 ORBIT | un giro per battuta: le note diventano archi attorno all'orologio |

- **▶** play/pausa · **↻ NEW** genera una nuova canzone (seed nell'URL, es. `#seed=112`) · **⤒ LOAD** visualizza un tuo file audio (tempo, note e colpi vengono stimati automaticamente) · **◎ LAB / ♡ KAWAII** cambia tema.
- Tastiera: `spazio` play/pausa, `← →` una battuta, `N` nuova canzone, `T` tema, `P` penna. Si può anche trascinare un file audio sulla pagina.
- La musica è sintetizzata nel browser (Web Audio): campanelle FM tipo carillon, arpeggi, accordi "future bass" con sidechain, sub bass, batteria.

Con GitHub Pages attivo l'app è su `https://<nome-utente>.github.io/<nome-repo>/cutecore/`.
In locale: `cd cutecore && python3 -m http.server` e apri `http://localhost:8000`.
