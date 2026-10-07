import { DurableObject } from 'cloudflare:workers'
import { DiceRoll, NumberGenerator, Parser } from '@dice-roller/rpg-dice-roller'

if (NumberGenerator.engines.browserCrypto) {
  NumberGenerator.generator.engine = NumberGenerator.engines.browserCrypto
}

const HISTORY_ON_CONNECT = 150
const HISTORY_KEEP = 1000
const MAX_NOTATION_LENGTH = 80
const MAX_DICE_PER_GROUP = 50
const MAX_SIDES = 1000
const ROOM_PATTERN = /^[a-z0-9-]{1,40}$/
// Der Client pingt alle 30 s; Hintergrund-Tabs drosselt der Browser auf ~1x pro Minute.
// Wer so lange gar nichts sendet, ist weg (Handy gesperrt, WLAN weg, Tab eingefroren).
const STALE_AFTER_MS = 150_000
const SWEEP_EVERY_MS = 60_000

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const match = url.pathname.match(/^\/api\/room\/([^/]+)\/ws$/)

    if (!match) {
      return Response.json({ error: 'Nicht gefunden' }, { status: 404 })
    }

    const room = decodeURIComponent(match[1]).toLowerCase()
    if (!ROOM_PATTERN.test(room)) {
      return Response.json({ error: 'Ungültiger Raumname' }, { status: 400 })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket erwartet', { status: 426 })
    }

    const stub = env.DICE_ROOM.get(env.DICE_ROOM.idFromName(room))
    return stub.fetch(request)
  }
}

export class DiceRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rolls (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        ts       INTEGER NOT NULL,
        player   TEXT    NOT NULL,
        label    TEXT,
        kind     TEXT    NOT NULL,
        target   INTEGER,
        notation TEXT    NOT NULL,
        output   TEXT    NOT NULL,
        total    REAL    NOT NULL
      )
    `)
    // Einzelne Würfel für die Statistik ("Grischa – W100: Ø 57,5")
    const hadDice = this.sql
      .exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'dice'")
      .one().n > 0
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS dice (
        roll_id INTEGER NOT NULL,
        ts      INTEGER NOT NULL,
        player  TEXT    NOT NULL,
        sides   INTEGER NOT NULL,
        value   INTEGER NOT NULL
      )
    `)
    this.sql.exec('CREATE INDEX IF NOT EXISTS dice_ts ON dice (ts)')
    if (!hadDice) this.backfillDice()
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request) {
    const url = new URL(request.url)
    const name = cleanText(url.searchParams.get('name'), 30) || 'Unbekannt'
    const id = cleanText(url.searchParams.get('id'), 64) || null

    // Derselbe Tab verbindet sich neu: alte Verbindung ersetzen statt doppelt zeigen
    if (id) {
      for (const ws of this.ctx.getWebSockets()) {
        if (ws.deserializeAttachment()?.id === id) closeQuietly(ws, 4000, 'Ersetzt')
      }
    }

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ name, id, since: Date.now() })

    const history = this.sql
      .exec('SELECT * FROM rolls ORDER BY id DESC LIMIT ?', HISTORY_ON_CONNECT)
      .toArray()
      .reverse()
    server.send(JSON.stringify({ type: 'history', rolls: history }))
    this.broadcastPresence()

    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY_MS)
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  async alarm() {
    const before = this.ctx.getWebSockets().length
    const live = this.liveSockets()
    if (live.length !== before) this.broadcastPresence()
    if (live.length) await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY_MS)
  }

  // Offene Verbindungen, die sich zuletzt gemeldet haben. Stille werden geschlossen.
  liveSockets() {
    const now = Date.now()
    return this.ctx.getWebSockets().filter((ws) => {
      if (ws.readyState !== WebSocket.OPEN) return false
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
      const { since = 0, seen = 0 } = ws.deserializeAttachment() ?? {}
      if (now - Math.max(lastPing, since, seen) < STALE_AFTER_MS) return true
      closeQuietly(ws, 4001, 'Zeitüberschreitung')
      return false
    })
  }

  async webSocketMessage(ws, raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return sendError(ws, 'Ungültige Nachricht')
    }

    const attachment = ws.deserializeAttachment() ?? { name: 'Unbekannt' }
    const { name } = attachment
    ws.serializeAttachment({ ...attachment, seen: Date.now() })

    if (msg.type === 'roll') {
      let roll
      try {
        roll = this.roll(name, msg)
      } catch (err) {
        return sendError(ws, err.message)
      }
      this.broadcast({ type: 'roll', roll })
    } else if (msg.type === 'stats') {
      ws.send(JSON.stringify({ type: 'stats', since: msg.since ?? 0, rows: this.stats(msg.since) }))
    } else if (msg.type === 'clear') {
      this.sql.exec('DELETE FROM rolls')
      this.sql.exec('DELETE FROM dice')
      this.broadcast({ type: 'cleared', by: name })
    }
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code, 'bye')
    } catch {}
    this.broadcastPresence(ws)
  }

  async webSocketError(ws) {
    this.broadcastPresence(ws)
  }

  roll(player, msg) {
    const kind = msg.kind === 'test' ? 'test' : 'free'
    const label = cleanText(msg.label, 200) || null
    let target = null
    let notation

    if (kind === 'test') {
      target = Math.trunc(Number(msg.target))
      if (!Number.isFinite(target) || target < -100 || target > 200) {
        throw new Error('Zielwert muss zwischen -100 und 200 liegen')
      }
      notation = '1d100'
    } else {
      notation = normalizeNotation(msg.notation)
    }

    let diceRoll
    try {
      diceRoll = new DiceRoll(notation)
    } catch {
      throw new Error(`Würfelausdruck nicht verstanden: ${notation}`)
    }

    const entry = {
      ts: Date.now(),
      player,
      label,
      kind,
      target,
      notation,
      output: diceRoll.output,
      total: diceRoll.total
    }

    const { id } = this.sql
      .exec(
        `INSERT INTO rolls (ts, player, label, kind, target, notation, output, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        entry.ts, entry.player, entry.label, entry.kind, entry.target,
        entry.notation, entry.output, entry.total
      )
      .one()
    this.sql.exec('DELETE FROM rolls WHERE id <= ?', id - HISTORY_KEEP)
    this.sql.exec('DELETE FROM dice WHERE roll_id <= ?', id - HISTORY_KEEP)

    // Gewürfelter Wert vor Modifikatoren – "min3" hebt an, zählt aber nicht als Wurf
    const groups = diceRoll.rolls.filter((r) => Array.isArray(r?.rolls))
    diceGroups(notation).forEach((sides, i) => {
      if (!sides) return
      for (const die of groups[i]?.rolls ?? []) {
        this.sql.exec(
          'INSERT INTO dice (roll_id, ts, player, sides, value) VALUES (?, ?, ?, ?, ?)',
          id, entry.ts, player, sides, die.initialValue
        )
      }
    })

    return { id, ...entry }
  }

  stats(since) {
    return this.sql
      .exec(
        `SELECT player, sides, COUNT(*) AS count, AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max
         FROM dice WHERE ts >= ? GROUP BY player, sides ORDER BY player, sides`,
        Number(since) || 0
      )
      .toArray()
  }

  // Einmalig nach dem Update: Würfel aus dem bestehenden Verlauf nachtragen
  backfillDice() {
    for (const r of this.sql.exec('SELECT id, ts, player, notation, output FROM rolls').toArray()) {
      let sidesList
      try {
        sidesList = diceGroups(r.notation)
      } catch {
        continue
      }
      const brackets = [...r.output.slice(r.output.indexOf(':') + 1).matchAll(/\[([^\]]*)\]/g)]
      sidesList.forEach((sides, i) => {
        if (!sides || !brackets[i]) return
        for (const raw of brackets[i][1].split(',')) {
          // angehobene Werte (^) kennen ihren Ursprungswurf nicht mehr
          if (raw.includes('^')) continue
          const value = parseInt(raw, 10)
          if (Number.isFinite(value)) {
            this.sql.exec(
              'INSERT INTO dice (roll_id, ts, player, sides, value) VALUES (?, ?, ?, ?, ?)',
              r.id, r.ts, r.player, sides, value
            )
          }
        }
      })
    }
  }

  broadcast(payload, except = null) {
    const data = JSON.stringify(payload)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      try {
        ws.send(data)
      } catch {}
    }
  }

  broadcastPresence(leaving = null) {
    const players = this.liveSockets()
      .filter((ws) => ws !== leaving)
      .map((ws) => ws.deserializeAttachment()?.name)
      .filter(Boolean)
    this.broadcast({ type: 'presence', players: [...new Set(players)].sort() }, leaving)
  }
}

function normalizeNotation(input) {
  const notation = String(input ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/(^|[^a-z])(\d*)w(?=\d|%)/gi, '$1$2d')

  if (!notation) throw new Error('Kein Würfelausdruck angegeben')
  if (notation.length > MAX_NOTATION_LENGTH) throw new Error('Würfelausdruck zu lang')

  for (const [, count, sides] of notation.matchAll(/(\d*)d(\d+|%|F)/gi)) {
    if (count && Number(count) > MAX_DICE_PER_GROUP) {
      throw new Error(`Höchstens ${MAX_DICE_PER_GROUP} Würfel pro Gruppe`)
    }
    if (/^\d+$/.test(sides) && Number(sides) > MAX_SIDES) {
      throw new Error(`Höchstens W${MAX_SIDES}`)
    }
  }
  return notation
}

// Seitenzahl je Würfelgruppe in Reihenfolge, z. B. "2d10+1d6" -> [10, 6]; W% = 100, Fudge = null
function diceGroups(notation) {
  return Parser.parse(notation)
    .filter((part) => part && typeof part === 'object' && 'sides' in part)
    .map((dice) => (dice.sides === '%' ? 100 : Number.isInteger(dice.sides) ? dice.sides : null))
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max)
}

function closeQuietly(ws, code, reason) {
  try {
    ws.close(code, reason)
  } catch {}
}

function sendError(ws, message) {
  ws.send(JSON.stringify({ type: 'error', message }))
}
