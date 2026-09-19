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

  const emit = (type, payload) => (listeners[type] || []).forEach((fn) => fn(payload))

  function url() {
    const base = server ? new URL(server) : new URL(window.location.href)
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    const query = new URLSearchParams({ name })
    return `${protocol}//${base.host}/api/room/${encodeURIComponent(room)}/ws?${query}`
  }

  function open() {
    clearTimeout(retryTimer)
    emit('status', 'connecting')
    socket = new WebSocket(url())

    socket.onopen = () => {
      retryDelay = 1000
      emit('status', 'connected')
      pingTimer = setInterval(() => socket?.readyState === 1 && socket.send('ping'), 30000)
    }

    socket.onmessage = (event) => {
      if (event.data === 'pong') return
      const msg = JSON.parse(event.data)
      emit(msg.type, msg.type === 'roll' ? msg.roll : msg)
    }

    socket.onclose = () => {
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
      socket?.close()
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
