import { DurableObject } from 'cloudflare:workers'
import { DiceRoll, NumberGenerator } from '@dice-roller/rpg-dice-roller'

if (NumberGenerator.engines.browserCrypto) {
  NumberGenerator.generator.engine = NumberGenerator.engines.browserCrypto
}

const HISTORY_ON_CONNECT = 150
const HISTORY_KEEP = 1000
const MAX_NOTATION_LENGTH = 80
const MAX_DICE_PER_GROUP = 50
const MAX_SIDES = 1000
const ROOM_PATTERN = /^[a-z0-9-]{1,40}$/

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
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request) {
    const url = new URL(request.url)
    const name = cleanText(url.searchParams.get('name'), 30) || 'Unbekannt'

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ name })

    const history = this.sql
      .exec('SELECT * FROM rolls ORDER BY id DESC LIMIT ?', HISTORY_ON_CONNECT)
      .toArray()
      .reverse()
    server.send(JSON.stringify({ type: 'history', rolls: history }))
    this.broadcastPresence()

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return sendError(ws, 'Ungültige Nachricht')
    }

    const { name } = ws.deserializeAttachment() ?? { name: 'Unbekannt' }

    if (msg.type === 'roll') {
      let roll
      try {
        roll = this.roll(name, msg)
      } catch (err) {
        return sendError(ws, err.message)
      }
      this.broadcast({ type: 'roll', roll })
    } else if (msg.type === 'clear') {
      this.sql.exec('DELETE FROM rolls')
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
    const label = cleanText(msg.label, 60) || null
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

    return { id, ...entry }
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
    const players = this.ctx
      .getWebSockets()
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

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max)
}

function sendError(ws, message) {
  ws.send(JSON.stringify({ type: 'error', message }))
}
