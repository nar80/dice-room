# Würfelraum

Gemeinsamer Würfelraum für Pen&Paper-Runden: Alle im selben Raum sehen jeden Wurf sofort,
der Verlauf bleibt gespeichert. Gewürfelt wird auf dem Server, nicht im Browser.

- **Seite:** Vue 3 + Quasar (`src/`)
- **Würfel-Server:** Cloudflare Worker + Durable Object mit SQLite (`worker/index.js`)
- Beides läuft zusammen unter **einer** URL auf Cloudflare, kostenlos.

## Lokal starten

```bash
npm install          # einmalig
npm run dev          # Server (8787) + Seite (5173) gleichzeitig
```

Dann http://localhost:5173 öffnen. Zum Testen mit mehreren Spielern einfach einen zweiten
Tab (oder ein Inkognito-Fenster) mit anderem Namen öffnen.

## Wo was geändert wird

| Was | Datei |
|---|---|
| Regeln eines Systems (Erfolgsgrade, Schnellproben, Schwierigkeiten) | `src/systems/rogueTrader.js` |
| Aussehen, Buttons, Verlauf | `src/App.vue`, Farben in `src/quasar-variables.sass` |
| Verbindung zum Raum (später in andere Tools kopierbar) | `src/dice-client.js` |
| Server: Würfeln, Speichern, Limits | `worker/index.js` – muss selten angefasst werden |

Würfelausdrücke nutzen [rpg-dice-roller](https://dice-roller.github.io/documentation/guide/notation/):
`2d10+4`, `2W10+4` (W geht auch), `3d6!` (explodierend), `4d6kh3` (höchste 3), `5d6>=5` (Erfolge zählen).

---

## Online stellen (einmalig, ca. 10 Minuten)

### 1. GitHub-Repo anlegen

1. Auf https://github.com/new ein neues Repo anlegen, z. B. `dice-room`
   (**leer lassen**, kein README/.gitignore ankreuzen).
2. Im Projektordner:
   ```bash
   git init
   git add .
   git commit -m "Würfelraum: erste Version"
   git branch -M main
   git remote add origin https://github.com/nar80/dice-room.git
   git push -u origin main
   ```

### 2. Cloudflare-Account

1. Auf https://dash.cloudflare.com/sign-up registrieren (kostenlos, keine Kreditkarte nötig).
2. Beim ersten Mal fragt Cloudflare nach einer **workers.dev-Subdomain** – einfach einen
   Namen wählen, z. B. `nar80`. Die Seite heißt später `dice-room.nar80.workers.dev`.

### 3. Repo mit Cloudflare verbinden

1. Im Dashboard links **Workers & Pages** → **Create** (bzw. „Anwendung erstellen“).
2. **Import a repository** / „Repository importieren“ → GitHub verbinden → Repo `dice-room` auswählen.
3. Einstellungen:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy` (steht meist schon drin)
   - Rest so lassen.
4. **Deploy** klicken. Nach 1–2 Minuten steht die URL oben auf der Seite.

**Fertig.** Ab jetzt reicht `git push` – Cloudflare baut und veröffentlicht automatisch,
genau wie Netlify bei der Sternenkarte.

### Alternative ohne GitHub-Verbindung

```bash
npx wrangler login     # öffnet den Browser, einmal bestätigen
npm run deploy         # baut und lädt hoch
```

Das muss dann nach jeder Änderung von Hand wiederholt werden.

## Benutzen

- Seite öffnen, Namen und Raum eingeben (z. B. `rogue-trader`).
- Über das 🔗-Symbol den **Raum-Link kopieren** und in Discord posten – wer ihn öffnet,
  landet direkt im Raum und muss nur noch seinen Namen eingeben.
- **Verlauf leeren** löscht für alle im Raum.

## Kosten & Limits

Kostenloser Cloudflare-Plan: 100.000 Anfragen pro Tag – eine Spielrunde kommt nicht mal in die
Nähe. Pro Raum werden die letzten 1000 Würfe gespeichert, beim Betreten die letzten 150 geladen.

## Später: Charakterbogen anbinden

`src/dice-client.js` in den Charakterbogen kopieren und dort statt in die Zwischenablage würfeln:

```js
import { createDiceClient } from './dice-client'
const dice = createDiceClient({ server: 'https://dice-room.nar80.workers.dev' })
dice.connect('rogue-trader', 'Joseph')

// in copyDamageRoll() / rollInitiative():
if (dice.connected) dice.roll(diceCode, { label: weapon.name })
else await navigator.clipboard.writeText(`/würfle generic eingabe: ${diceCode}`)
```
