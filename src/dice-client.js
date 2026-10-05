// Verbindung zu einem Würfelraum. Ohne Abhängigkeiten, damit die Datei später
// in Charakterbogen/Sternenkarte kopiert werden kann.
//
//   const dice = createDiceClient({ server: 'https://dice-room.xyz.workers.dev' })
//   dice.on('roll', (roll) => ...)
//   dice.connect('gruppe', 'Joseph')
//   dice.roll('2d10+4', { label: 'Boltpistole' })
//   dice.test(45, { label: 'BF' })

export function createDiceClient({ server = '' } = {}) {
  const listeners = {}
  let socket = null
  let room = null
  let name = null
  let pingTimer = null
  let retryTimer = null
  let retryDelay = 1000
  let wanted = false
  // Bleibt für die Lebensdauer der Seite gleich. Der Server ersetzt beim Wiederverbinden
  // die alte Verbindung dieses Tabs, statt den Spieler doppelt anzuzeigen.
  const clientId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)

  const emit = (type, payload) => (listeners[type] || []).forEach((fn) => fn(payload))

  function url() {
    const base = server ? new URL(server) : new URL(window.location.href)
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    const query = new URLSearchParams({ name, id: clientId })
    return `${protocol}//${base.host}/api/room/${encodeURIComponent(room)}/ws?${query}`
  }

  function open() {
    clearTimeout(retryTimer)
    emit('status', 'connecting')
    const ws = new WebSocket(url())
    socket = ws

    // Eine alte, gerade schließende Verbindung darf die neue nicht beeinflussen.
    ws.onopen = () => {
      if (socket !== ws) return
      retryDelay = 1000
      emit('status', 'connected')
      clearInterval(pingTimer)
      pingTimer = setInterval(() => ws.readyState === 1 && ws.send('ping'), 30000)
    }

    ws.onmessage = (event) => {
      if (socket !== ws || event.data === 'pong') return
      const msg = JSON.parse(event.data)
      emit(msg.type, msg.type === 'roll' ? msg.roll : msg)
    }

    ws.onclose = () => {
      if (socket !== ws) return
      clearInterval(pingTimer)
      socket = null
      emit('status', 'disconnected')
      if (wanted) {
        retryTimer = setTimeout(open, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 15000)
      }
    }
  }

  function send(payload) {
    if (socket?.readyState !== 1) return false
    socket.send(JSON.stringify(payload))
    return true
  }

  return {
    on(type, fn) {
      ;(listeners[type] ||= []).push(fn)
    },
    connect(newRoom, newName) {
      this.disconnect()
      room = newRoom
      name = newName
      wanted = true
      open()
    },
    disconnect() {
      wanted = false
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      const old = socket
      socket = null
      old?.close()
      if (old) emit('status', 'disconnected')
    },
    get connected() {
      return socket?.readyState === 1
    },
    roll(notation, { label } = {}) {
      return send({ type: 'roll', kind: 'free', notation, label })
    },
    test(target, { label } = {}) {
      return send({ type: 'roll', kind: 'test', target, label })
    },
    clear() {
      return send({ type: 'clear' })
    }
  }
}
