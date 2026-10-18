# Newswall Globe — piano

> Stato: **proposta, da leggere e approvare**. Niente di quanto descritto qui è ancora
> implementato. Quando una fase è fatta, va tolta da qui e raccontata nel README.

## 1. Vision

Newswall diventa due esperienze sopra lo stesso catalogo:

- **Il muro** (`index.html`) — quello di oggi. Si proietta, si guarda per ore. Resta
  tecnico, minimale, leggero: fino a 12 schermi in griglia, un audio alla volta. Non carica
  mai niente di 3D.
- **Il globo** (`globe.html`) — la modalità esplorazione. Entri in un mondo 3D: la Terra
  ruota sotto di te, con il giorno e la notte veri, e sopra ogni paese galleggiano gli schermi
  dei suoi canali. Giri il globo, ti avvicini, scegli. Si guida con mouse, tastiera, gamepad,
  e (fase 3) con lo smartphone come telecomando, agganciato inquadrando un QR.

Le due pagine sono collegate dall'URL: dal globo raccogli i canali e li **mandi al muro**
(`index.html#c=<mode>&s=a,b,c`); dal muro un pulsante porta al globo.

Il principio del progetto non cambia: **nessuna richiesta a terze parti per renderizzare**,
nessun account, nessun dato raccolto. L'unica eccezione, opzionale e isolata, è il relay del
telecomando (§7).

## 2. Decisioni prese

| Decisione | Perché |
|---|---|
| Globo come **pagina separata** | Il muro resta leggero: three.js (~600 KB) lo carica solo il globo. |
| **Niente YouTube nel globo** | Un iframe YouTube non può diventare texture WebGL: servirebbe un secondo renderer (CSS3D) sovrapposto. Senza, tutti gli schermi sono texture vere, toccate da luci e giorno/notte. Costo: 13 canali news su 108 non compaiono nel globo (dati del 18/10/2026: 95 news con HLS funzionante). Nel muro YouTube resta. |
| **Live solo 4–6 schermi** alla volta | Decodificare decine di stream è impossibile; gli altri mostrano logo o ultimo fotogramma. |
| **Niente build, niente Astro** | Astro è per siti di contenuto; qui è quasi tutto JS in tempo reale. Quello che serve è la **modularità**, e la danno i moduli ES nativi + `importmap`. Il codice in moduli ES passa a Vite quasi senza modifiche il giorno che servisse (TypeScript, molte dipendenze, shader complessi): scelta reversibile a basso costo. Il contrario no. |
| Dipendenze **vendorizzate** in `assets/vendor/` | Come hls.js: versione esatta, nessun CDN. |

## 3. Architettura dei file

```
index.html            muro (type="module")
globe.html            globo (type="module", importmap per three)
remote.html           telecomando da smartphone (fase 3)
js/
  core/
    data.js           carica sources.json + live.json, byId, inMode, MODES,
                      flag, countryName, langName, originText, firstStream
    hls-player.js     crea/distrugge un <video> HLS con fallback sugli stream,
                      watchdog, cap di qualità — senza sapere niente di griglia o globo
    url.js            lettura/scrittura di #c= e #s=, localStorage
  wall/
    wall.js           boot del muro, griglia, tile, audio, focus
    youtube.js        iframe + postMessage (solo muro)
    panel.js          catalogo e ricerca rapida
  globe/
    globe.js          boot, scena, loop di render
    earth.js          sfera, shader giorno/notte, atmosfera, confini
    sun.js            posizione del sole dall'ora UTC
    screens.js        schermi sospesi, cluster, etichette
    livepool.js       chi è live, isteresi, avvio/stop dei player
    controls.js       mouse, touch, tastiera, gamepad → comandi astratti
    hud.js            barra, scheda canale, cestino "manda al muro"
    geo.js            ISO2 → [lat, lon] (capitale / centro mediatico)
  remote/             (fase 3)
assets/
  vendor/             hls.min.js, three.module.min.js, qrcode.js (fase 3)
  earth/              texture e confini (pubblico dominio)
  logos/              loghi dei canali, scaricati una volta da uno script
relay/                (fase 3) Cloudflare Worker + Durable Object
```

Il punto chiave è `hls-player.js`: oggi `attach()`/`detach()` vivono dentro la logica delle
tile. Va estratta un'API che il globo possa usare con un `<video>` fuori dal DOM:

```js
const p = createHlsPlayer(source, { cap: 360, onPlaying, onDead });
p.video        // <video> da usare come texture
p.setCap(1080) // quando lo schermo viene selezionato
p.destroy()
```

## 4. Fasi

### Fase 0 — Fondamenta (nessun cambiamento visibile)

1. Dividere `app.js` nei moduli `js/core/*` e `js/wall/*`; `index.html` con
   `<script type="module">`.
2. Estrarre `createHlsPlayer()` dalle tile, con lo stesso comportamento di oggi
   (fallback `idx + 1`, watchdog, `markDead`, controllo `isConnected`).
3. Normalizzare `country: "UK"` → `"GB"` in `sources.json` (4 sorgenti) e fare in modo
   che `harvest-iptv.py` scriva sempre `GB` (iptv-org usa `UK`).
4. Aggiornare CLAUDE.md e README ("How it's built").

**Fatto quando:** il muro si comporta esattamente come prima (modi, URL, drag, audio,
fallback, palette), verificato nel browser.

### Fase 1 — Il globo

1. Vendorizzare three.js (versione esatta) e le risorse della Terra (§5).
2. `geo.js`: coordinate per i ~70 paesi del catalogo.
3. Terra con giorno/notte reali, atmosfera, confini.
4. Schermi sospesi: tutti i canali HLS del modo corrente, con logo come immagine ferma.
5. `livepool.js`: 4 live (configurabile fino a 6), con isteresi (§6).
6. Controlli: mouse/touch, tastiera, gamepad (§6).
7. Selezione: la camera vola sullo schermo, che si ingrandisce, passa a piena qualità e
   prende l'audio. Cestino → "Apri nel muro".
8. Selettore dei modi (News · Sport · Markets · Weather) come nel muro.
9. Schermata d'ingresso (serve il gesto dell'utente per l'autoplay, come `#gate`).
10. Pulsante "Globe" nel muro, "Wall" nel globo.

**Fatto quando:** apri `globe.html`, giri il globo con mouse e gamepad, 4 schermi frontali
sono live, ne selezioni uno e lo ascolti, mandi 6 canali al muro e il muro li apre.

### Fase 2 — Rifinitura

- **Cluster**: paesi con molti canali (US 21, IN 11, FR 9) da lontano sono uno schermo con
  contatore `×21`; avvicinandosi si aprono a ventaglio.
- **Ultimo fotogramma**: quando uno schermo smette di essere live, si cattura un frame
  e diventa la sua immagine ferma (desaturata, con l'ora "visto alle 14:32").
- Transizioni di camera curate, `prefers-reduced-motion` rispettato.
- Taratura mobile (meno live, pixel ratio più basso).
- Script stdlib `scripts/fetch-logos.py` per scaricare e ridimensionare i loghi.

### Fase 3 — Telecomando da smartphone

Vedi §7.

## 5. Idea grafica

**Tono**: la stessa "control room" del muro, ma vista dallo spazio. Notturno, preciso,
silenzioso. Niente effetti da videogioco cartoon: più centro di controllo missione.

**La Terra**
- Oceano quasi nero, blu-grafite. Terre in grigio scuro opaco, oppure a **griglia di
  punti** (più "strumento", meno fotografia) — da decidere guardando un prototipo.
- **Confini** sottili, appena più chiari; il paese dello schermo selezionato si accende.
- **Giorno e notte reali**: la posizione del sole si calcola dall'ora UTC (declinazione +
  equazione del tempo, formula breve). Lo shader sfuma tra il lato in luce e quello in
  ombra con una fascia di crepuscolo morbida.
- **Luci delle città** (NASA Black Marble) che compaiono solo sul lato notturno: rende
  visibile a colpo d'occhio dove è notte e i telegiornali sono in replica.
- **Atmosfera**: alone sottile sul bordo (effetto Fresnel), freddo di giorno, quasi assente
  di notte.
- Stelle rade sullo sfondo, molto discrete.

Risorse, tutte di pubblico dominio: NASA Blue Marble / Black Marble (2K, ~1–2 MB in tutto),
Natural Earth 1:110m per i confini (~100 KB).

**Gli schermi sospesi**
- Pannelli 16:9 a una certa altezza sopra il paese, rivolti verso l'esterno e leggermente
  verso la camera, così restano leggibili anche vicino al bordo del globo.
- Un **filo sottile** collega lo schermo al punto sul terreno, dove pulsa un piccolo
  marcatore.
- Cornice sottile tipo monitor; sotto, etichetta in Spline Sans Mono: bandiera, nome,
  ora locale (dal `tz` della sorgente).
- **Stati**:
  - *live*: colori pieni, cornice chiara;
  - *fermo*: logo o ultimo fotogramma, desaturato e più scuro;
  - *selezionato*: più grande, piena qualità;
  - *in onda* (ha l'audio): **rosso**, la stessa regola del muro: il rosso è solo per chi
    parla;
  - *ritrasmissione* (`origin.kind = rebroadcast`): dettaglio arancione, come nel muro.
- Il lato notturno tocca anche gli schermi: quelli nel buio hanno la cornice più fioca.

**HUD** (vetro smerigliato, solo su superfici una alla volta come da regole del muro)
- In alto: logo, modi, conteggio live, ora UTC, cestino `3/12 → Apri nel muro`.
- Al centro: un **mirino** discreto: lo schermo più vicino al mirino è il candidato alla
  selezione (essenziale per il gamepad).
- In basso: scheda del canale selezionato — nome, paese, lingua, provenienza dello stream
  con la stessa regola di onestà del muro.

## 6. Comportamento

**Chi è live (`livepool.js`)**
- Punteggio = distanza angolare dello schermo dal centro dell'inquadratura; contano solo
  quelli sull'emisfero visibile.
- Sono live i primi K (default 4, max 6; 3 su mobile).
- **Isteresi**: uno schermo live resta live finché non esce dai primi K+2 o dall'emisfero
  visibile. Uno stream impiega 2–5 s a partire: senza isteresi, ruotando si vedrebbero solo
  caricamenti.
- **Attesa**: nuovi player partono solo quando la camera è quasi ferma da ~400 ms, al
  massimo 2 avvii in parallelo.
- Qualità: 360p per gli schermi live, piena per quello selezionato.
- Safari: forzare hls.js (MediaSource) anche dove esiste l'HLS nativo, altrimenti il video
  non è utilizzabile come texture.
- Le texture si aggiornano solo a fotogramma nuovo (`requestVideoFrameCallback`); il render
  si ferma con la scheda nascosta.

**Controlli** — tutti tradotti in comandi astratti (`rotate`, `zoom`, `next`, `select`,
`audio`, `basket`, `mode`, `back`), così telecomando e gamepad usano lo stesso canale.

| Azione | Mouse / touch | Tastiera | Gamepad |
|---|---|---|---|
| ruota | trascina (con inerzia) | frecce / WASD | stick sinistro |
| zoom | rotella / pinch | `+` `-` | grilletti |
| schermo vicino | — | `Tab` / `Shift-Tab` | stick destro / croce |
| seleziona | click | `Invio` | A |
| audio | click sullo selezionato | `Spazio` | X |
| nel cestino | pulsante | `B` | Y |
| cambia modo | barra | `1`–`4` | dorsali |
| indietro | `Esc` | `Esc` | B |
| apri nel muro | pulsante | `Shift-Invio` | Start |

## 7. Il telecomando (fase 3)

**Esperienza.** Nel globo, il pulsante "Telecomando" mostra un QR. Lo inquadri con il
telefono, si apre `remote.html` già agganciato. Sul telefono:

- in alto, la scheda del canale selezionato (nome, paese, live/fermo);
- al centro un **trackpad**: trascini per ruotare, pizzichi per lo zoom;
- sotto, la lista dei **canali vicini** al mirino: tocchi e selezioni;
- pulsanti grandi: Audio · Nel cestino · Apri nel muro · modi;
- vibrazione al cambio di selezione (Android);
- opzionale: **modalità giroscopio**, inclini il telefono e il globo ruota.

Più avanti lo stesso telecomando può pilotare **il muro** (chi ha l'audio, schermo
intero): è proprio l'uso "proiettato" dove non hai la tastiera a portata.

**Perché serve un relay.** Telefono e schermo devono trovarsi, e una pagina statica non
può farlo da sola. Opzioni considerate:

1. **Relay minimo su Cloudflare (Worker + Durable Object)** — *raccomandato*.
2. **Deno Deploy** — alternativa valida: gratuito, WebSocket supportati; le istanze sono
   separate, quindi telefono e globo si parlano via `BroadcastChannel`.
3. Relay proprio (un container Node/Python sullo swarm già gestito): costo zero e nessun
   terzo, ma va mantenuto e lega Newswall a quella macchina.
4. Servizi pubblici (PeerJS cloud) o BaaS (Supabase Realtime, Firebase): un terzo vede chi si
   collega, account e chiavi nella pagina. Contro lo spirito del progetto.
5. WebRTC con scambio manuale di due QR: senza server, ma macchinoso.

Esclusi: **Vercel** e **Netlify** (le funzioni vivono una richiesta, niente WebSocket
persistenti); **Render** free (si addormenta dopo ~15 min, risveglio 30–60 s); **Fly.io** e
**Railway** (niente più piano gratuito vero).

**Come funziona il relay**
- Il globo genera un `room` casuale (128 bit) e una chiave `k`. Il QR contiene
  `https://tv.archimedix.net/remote.html#r=<room>&k=<key>`: tutto nel **frammento**, che
  il browser non invia mai al server.
- Entrambi aprono un WebSocket verso il Durable Object della stanza; il relay inoltra i
  messaggi dall'uno all'altro e non fa altro.
- **Cifratura end-to-end**: i messaggi sono cifrati con AES-GCM (WebCrypto) usando `k`.
  Il relay vede solo il `room` e byte cifrati.
- Niente WebRTC: sono pochi messaggi piccoli, la latenza via edge Cloudflare (20–50 ms) basta
  per un telecomando, e si evitano NAT, ICE e TURN.
- Il Durable Object usa la **WebSocket Hibernation API** (`state.acceptWebSocket`), non
  `accept()`: da fermo non consuma durata. Nessuno storage (classe SQLite, l'unica sul piano
  Free, ma senza scriverci).
- La stanza muore quando entrambi si disconnettono, o dopo 2 ore. Nessun log persistente.
- Un solo telecomando alla volta: il secondo che si aggancia prende il controllo.
- Se il relay non risponde, il pulsante "Telecomando" non compare: il globo funziona uguale.

**Protocollo** (JSON, prima della cifratura)

```
telefono → globo   {t:"rotate", dx, dy}   (max 30/s)
                   {t:"zoom", d}
                   {t:"select", id} | {t:"next", dir}
                   {t:"audio"} | {t:"basket", id} | {t:"mode", m} | {t:"open-wall"}
globo → telefono   {t:"state", mode, selected, near:[{id,name,cc,live}], basket:[…]}
```

**Repo e deploy**: cartella `relay/` con il Worker (`wrangler.toml`), deploy a mano con
`wrangler` o da una Action separata. Dominio, per esempio `relay.archimedix.net`. QR
generato nel browser da una libreria vendorizzata (qrcode-generator, MIT, ~20 KB).

## 8. Rischi e domande aperte

- **Peso**: three.js + texture ≈ 2–3 MB al primo caricamento del globo. Accettabile per una
  modalità esplorazione, da tenere d'occhio.
- **Hardware modesto**: 4–6 decoder video + WebGL su un portatile vecchio o un telefono.
  K e pixel ratio vanno tarati in fase 2.
- **CORS**: gli stream che hls.js non riesce a caricare per CORS non compaiono nemmeno nel
  globo (stesso limite del muro, es. IRIB).
- **Cloudflare** — verificato il 18/10/2026
  ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
  [limits](https://developers.cloudflare.com/durable-objects/platform/limits/)): i Durable
  Objects sono nel piano **Free** (solo backend SQLite). Limiti al giorno: 100.000 richieste,
  13.000 GB-s di durata, reset alle 00:00 UTC; oltre, errore e nessun addebito. Un WebSocket
  aperto = 1 richiesta, i messaggi in arrivo contano 1 ogni 20, quelli in uscita sono gratis.
  Caso peggiore, 30 msg/s di trascinamento continuo ≈ 1,5 richieste/s → ~18 ore al giorno:
  margine ampio. Da ricontrollare solo se le condizioni cambiano.
- **Terre a punti o piene?** Da decidere su un prototipo della fase 1.
- **Sorgenti senza paese preciso** (canali internazionali, panarabi): si ancorano alla sede
  (`country` attuale). Eventuale override `geo` per sorgente solo se serve.

## 9. Cosa approvare prima di iniziare

1. L'impostazione generale (due pagine, moduli ES, niente build).
2. L'ordine delle fasi: 0 → 1 → 2 → 3.
3. Il relay Cloudflare per il telecomando (fattibile e gratuito, vedi §8; si decide prima
   della fase 3).
