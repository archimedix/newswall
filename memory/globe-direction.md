---
name: globe-direction
description: Decisioni sulla futura vista 3D "globo" di Newswall (pagina separata, no YouTube, no build); piano in docs/globe-plan.md
metadata:
  type: project
---

Il 2026-10-18 l'utente ha deciso di affiancare al muro una vista esplorazione 3D (`globe.html`,
three.js vendorizzato). Piano completo in `docs/globe-plan.md`, **da approvare prima di eseguire**.

Decisioni: globo come pagina separata (il muro resta minimale e non carica 3D); niente YouTube nel
globo (solo HLS come texture WebGL); 4–6 schermi live, gli altri logo/ultimo fotogramma; niente
build né Astro (moduli ES nativi + importmap, Vite eventualmente più avanti); telecomando da
smartphone via QR con relay Cloudflare Worker + Durable Object, cifrato end-to-end (fase 3).

**Why:** l'utente vuole un'esperienza "videogioco" per esplorare, senza appesantire il muro che si
proietta; preferisce discutere e leggere il piano prima che si scriva codice.

**How to apply:** non iniziare fasi del piano senza il via esplicito; quando una fase è fatta,
spostarla nel README e toglierla dal piano.
