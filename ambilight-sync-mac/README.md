# Ambilight Sync per Mac

Legge in tempo reale i colori **Ambilight** della TV Philips e li trasmette alle strisce LED
di casa, anche di marche diverse: *mensola 1*, *mensola 2*, *mensola 3*, *tavolo* e *salone*.

- Cerca **da sola** la TV nella rete di casa a ogni avvio, anche se il router le ha dato un nuovo indirizzo.
- **Verifica** che la TV esponga davvero i colori Ambilight e mostra un'anteprima dal vivo.
- Ogni striscia può seguire una zona diversa dello schermo (sinistra, destra, alto, in alto a sinistra...).
- Tutto resta nella rete di casa: niente cloud, nessun account, il pannello è visibile solo dal tuo Mac.

## Cosa serve

| | |
|---|---|
| **Mac** | macOS con Python 3.9 o successivo (lo installa l'installazione, se manca) |
| **TV** | Philips Ambilight con API JointSPACE: Android TV / Google TV (dal 2016) e Saphi. Per i modelli con Titan OS (2025+) usa il pulsante **Verifica Ambilight**: dice subito se la tua TV espone i colori |
| **Rete** | Mac, TV e strisce sulla **stessa rete Wi-Fi** (non la rete ospiti) |

### Strisce supportate

| Marca | Cosa attivare | Il nome di Alexa viene riconosciuto? |
|---|---|---|
| **Govee** | app Govee Home › dispositivo › ⚙ › **LAN Control** | no: usa «Fai lampeggiare» |
| **Philips WiZ** | app WiZ › Impostazioni › Sicurezza › **Consenti comunicazione locale** | no: usa «Fai lampeggiare» |
| **Yeelight** | app Yeelight › dispositivo › ⚙ › **Controllo LAN** | sì, se le hai dato un nome |
| **WLED** (ESP32/ESP8266) | niente | sì (nome del dispositivo) |
| **Magic Home** / LEDnet / Zengge | niente | no: usa «Fai lampeggiare» |
| **Philips Hue** (con Bridge) | premi il pulsante del Bridge quando richiesto | sì (nome nell'app Hue) |
| **Tuya / Smart Life** (molte strisce senza marca) | chiavi locali, una volta sola ([vedi sotto](#strisce-tuya--smart-life)) | sì (nome nell'app Smart Life) |

Non supportate (per ora): strisce **Zigbee collegate a un Echo** (non sono raggiungibili
dal Wi-Fi: spostale su un Bridge Hue), solo-Matter, TP-Link Tapo, LIFX, Nanoleaf.

## Installazione

1. Scarica questa cartella (`ambilight-sync-mac`) sul Mac, per esempio in *Download*.
2. Apri il **Terminale** (Spotlight › «Terminale») e scrivi:

   ```bash
   bash ~/Downloads/ambilight-sync-mac/installa.command
   ```

3. Al primo avvio macOS chiede di accedere ai **dispositivi della rete locale**: rispondi **Consenti**.

L'installazione crea l'app **Ambilight Sync** nella cartella *Applicazioni* della tua cartella Inizio
e apre il pannello nel browser (`http://127.0.0.1:8765`). Puoi rieseguirla per aggiornare
l'app: le impostazioni restano.

Avvio automatico: *Impostazioni di Sistema › Generali › Elementi login › +* › Ambilight Sync.

## Prima configurazione (5 minuti)

1. **TV**: accendi la TV con l'Ambilight attivo › **Cerca in rete** › **Usa questa**.
2. **Abbina TV**: sulla TV compare un PIN, scrivilo nel pannello. Serve una volta sola.
3. **Verifica Ambilight**: la lista di controlli dice se la TV espone i colori; a destra vedi l'anteprima.
4. **Strisce**: **Cerca strisce**. Quelle che comunicano un nome (WLED, Hue, Yeelight, Tuya) vengono
   associate da sole ai nomi *mensola 1…salone*. Per le altre premi **Fai lampeggiare**, guarda quale
   striscia lampeggia e scegli il suo nome nel menu.
5. **Segue**: scegli la zona dello schermo per ogni striscia. Proposta iniziale: mensola 1 › in alto a sinistra,
   mensola 2 › in alto al centro, mensola 3 › in alto a destra, tavolo › lato inferiore, salone › tutto lo schermo.
6. **Avvia sincronizzazione**.

Regolazioni utili: *Luminosità*, *Morbidezza transizioni* (più alta = colori più calmi),
*Saturazione* (colori più vivi), *Spegni le strisce nelle scene nere / quando la TV si spegne*.
Le strisce WLED possono anche essere **sfumate**: ogni LED segue un punto diverso del lato scelto.

## Controllare la rete senza installare nulla

Dalla cartella scaricata:

```bash
cd ~/Downloads/ambilight-sync-mac
python3 -m ambisync scan      # cerca TV e strisce e dice se la TV espone i colori Ambilight
python3 -m ambisync pair      # abbina la TV dal Terminale (chiede il PIN)
python3 -m ambisync verify    # verifica completa dei colori Ambilight
```

## Strisce Tuya / Smart Life

Le strisce Tuya cifrano i comandi con una «chiave locale» diversa per ogni dispositivo. Si recupera una volta sola:

1. Crea un account gratuito su [iot.tuya.com](https://iot.tuya.com), crea un *Cloud Project* (data center *Central Europe*)
   e collega l'app Smart Life inquadrando il QR code (*Devices › Link App Account*).
2. Nel Terminale:

   ```bash
   ~/Library/Application\ Support/AmbilightSync/venv/bin/python3 -m tinytuya wizard
   ```

3. Apri il file `devices.json` creato, copia tutto il contenuto e incollalo nel pannello
   (*Altre marche › Tuya / Smart Life › Importa chiavi Tuya*), poi **Cerca strisce**.

## Se qualcosa non va

- **Non trova nulla / «No route to host»**: *Impostazioni di Sistema › Privacy e sicurezza › Rete locale*
  › attiva *Ambilight Sync* (e *Terminale* se usi i comandi da Terminale).
- **La TV non viene trovata**: deve essere accesa (non in standby profondo) e sulla stessa rete.
  Puoi inserire l'IP a mano (pannello › TV › *Inserisci l'indirizzo IP a mano*).
- **Colori tutti neri**: l'Ambilight della TV è spento: accendilo dal telecomando.
- **«Il certificato della TV è cambiato»**: succede dopo un aggiornamento della TV: premi *Abbina di nuovo*.
- **Una striscia «non risponde»**: controlla l'opzione LAN/locale nell'app della marca (tabella sopra).
- **Ritardo**: le strisce Wi-Fi hanno di solito 0,1-0,3 s di ritardo; Hue e Yeelight sono le più lente, WLED la più veloce.
- Il registro completo è in `~/Library/Application Support/AmbilightSync/ambisync.log` e nel pannello (*Registro*).

Disinstallazione: `bash ~/Downloads/ambilight-sync-mac/disinstalla.command`.

## Sicurezza e privacy

- Il pannello risponde solo su `127.0.0.1` (non è visibile da altri dispositivi) e rifiuta le richieste
  di altri siti web.
- La chiave di abbinamento della TV è salvata in
  `~/Library/Application Support/AmbilightSync/config.json`, leggibile solo dal tuo utente.
- Il certificato della TV viene memorizzato al primo collegamento e verificato a ogni connessione.

## Per sviluppatori

Nessuna dipendenza esterna, salvo `tinytuya` (facoltativa). Python 3.9+.

```bash
python3 -m unittest discover -s tests   # test con TV e strisce simulate
python3 tests/demo.py                   # pannello demo su http://127.0.0.1:8799 con dispositivi simulati
```

| File | Ruolo |
|---|---|
| `ambisync/tv.py` | TV Philips: ricerca, abbinamento (PIN + digest), lettura colori Ambilight, verifica |
| `ambisync/lights/` | un driver per marca (`discover()` + classe `Light`) |
| `ambisync/discovery.py` | scansione della rete e riconoscimento dei nomi |
| `ambisync/engine.py` | ciclo di sincronizzazione, un thread per striscia |
| `ambisync/app.py`, `web/index.html` | server locale e pannello |
| `macos/` | launcher AppleScript e icona dell'app |
