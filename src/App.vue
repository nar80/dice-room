<script setup>
import { computed, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { createDiceClient } from './dice-client'
import { evaluateTest, quickTests, difficulties } from './systems/rogueTrader'
import rollSound from './assets/RollDice.mp3'

const $q = useQuasar()
const dice = createDiceClient({ server: import.meta.env.VITE_DICE_SERVER || '' })

const status = ref('disconnected')
const rolls = ref([])
const players = ref([])

const room = ref('')
const name = ref('')
const setupOpen = ref(false)
const setupRoom = ref('')
const setupName = ref('')

const notation = ref('')
const freeLabel = ref('')
const quickCount = ref(1)

const testValue = ref(40)
const testDifficulty = ref(0)
const testModifier = ref(0)
const testLabel = ref('')

const soundOn = ref(load('dice.sound', 'on') === 'on')
const audio = new Audio(rollSound)

const effectiveTarget = computed(
  () => Number(testValue.value || 0) + Number(testDifficulty.value) + Number(testModifier.value || 0)
)
const shareLink = computed(() => `${window.location.origin}/?raum=${room.value}`)

dice.on('status', (s) => (status.value = s))
dice.on('presence', (msg) => (players.value = msg.players))
dice.on('history', (msg) => (rolls.value = msg.rolls.reverse()))
dice.on('cleared', (msg) => {
  rolls.value = []
  $q.notify({ message: `${msg.by} hat den Verlauf geleert`, color: 'grey-8' })
})
dice.on('error', (msg) => $q.notify({ message: msg.message, color: 'negative', icon: 'error' }))
dice.on('roll', (roll) => {
  rolls.value.unshift(roll)
  if (soundOn.value) {
    audio.currentTime = 0
    audio.play().catch(() => {})
  }
})

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  room.value = slugify(params.get('raum') || load('dice.room', ''))
  name.value = load('dice.name', '')
  if (room.value && name.value) {
    join()
  } else {
    openSetup()
  }
})

function openSetup() {
  setupRoom.value = room.value || 'gruppe'
  setupName.value = name.value
  setupOpen.value = true
}

function saveSetup() {
  const newRoom = slugify(setupRoom.value)
  const newName = setupName.value.trim().slice(0, 30)
  if (!newRoom || !newName) return
  room.value = newRoom
  name.value = newName
  save('dice.room', newRoom)
  save('dice.name', newName)
  setupOpen.value = false
  join()
}

function join() {
  const url = new URL(window.location.href)
  url.searchParams.set('raum', room.value)
  window.history.replaceState(null, '', url)
  dice.connect(room.value, name.value)
}

function rollFree() {
  if (!notation.value.trim()) return
  if (send(() => dice.roll(notation.value, { label: freeLabel.value }))) {
    notation.value = ''
  }
}

function rollQuick(sides) {
  send(() => dice.roll(`${quickCount.value}d${sides}`))
}

function rollTest(label = testLabel.value) {
  send(() => dice.test(effectiveTarget.value, { label }))
}

function send(fn) {
  if (fn()) return true
  $q.notify({ message: 'Nicht verbunden – bitte kurz warten', color: 'warning', icon: 'wifi_off' })
  return false
}

function clearLog() {
  $q.dialog({
    title: 'Verlauf leeren?',
    message: 'Der Verlauf wird für alle im Raum gelöscht.',
    cancel: { label: 'Abbrechen', flat: true },
    ok: { label: 'Leeren', color: 'negative' },
    dark: true
  }).onOk(() => dice.clear())
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareLink.value)
    $q.notify({ message: 'Link kopiert', color: 'positive', icon: 'content_copy', timeout: 1500 })
  } catch {
    $q.notify({ message: shareLink.value, color: 'grey-8', timeout: 6000 })
  }
}

function toggleSound() {
  soundOn.value = !soundOn.value
  save('dice.sound', soundOn.value ? 'on' : 'off')
}

function testResult(roll) {
  return evaluateTest(roll.total, roll.target)
}

function playerColor(player) {
  let hash = 0
  for (const ch of player) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360}, 55%, 65%)`
}

function time(ts) {
  const d = new Date(ts)
  const today = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('de-DE', today
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function load(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}
</script>

<template>
  <q-layout view="hHh lpR fFf" class="bg-dark-page">
    <q-header class="bg-dark header">
      <q-toolbar>
        <q-icon name="casino" size="sm" color="secondary" class="q-mr-sm" />
        <q-toolbar-title class="title">Würfelraum</q-toolbar-title>

        <q-chip v-if="room" clickable dense color="primary" text-color="white" icon="meeting_room" @click="openSetup">
          {{ room }}
        </q-chip>
        <q-icon
          :name="status === 'connected' ? 'wifi' : 'wifi_off'"
          :color="status === 'connected' ? 'positive' : status === 'connecting' ? 'warning' : 'negative'"
          class="q-mx-sm"
        >
          <q-tooltip>{{ { connected: 'Verbunden', connecting: 'Verbinde …', disconnected: 'Getrennt' }[status] }}</q-tooltip>
        </q-icon>
        <q-btn flat round dense :icon="soundOn ? 'volume_up' : 'volume_off'" @click="toggleSound">
          <q-tooltip>Würfelgeräusch</q-tooltip>
        </q-btn>
        <q-btn flat round dense icon="link" @click="copyLink">
          <q-tooltip>Raum-Link kopieren</q-tooltip>
        </q-btn>
        <q-btn flat round dense icon="settings" @click="openSetup">
          <q-tooltip>Name / Raum</q-tooltip>
        </q-btn>
      </q-toolbar>
      <div v-if="players.length" class="players q-px-md q-pb-xs">
        <span class="text-grey-6 q-mr-xs">Online:</span>
        <span v-for="p in players" :key="p" class="q-mr-sm" :style="{ color: playerColor(p) }">● {{ p }}</span>
      </div>
    </q-header>

    <q-page-container>
      <q-page class="q-pa-md">
        <div class="row q-col-gutter-md">
          <div class="col-12 col-md-5">
            <q-card class="panel q-mb-md">
              <q-card-section class="section-title">Rogue-Trader-Probe</q-card-section>
              <q-card-section class="q-gutter-sm">
                <div class="row q-col-gutter-sm">
                  <q-input v-model.number="testValue" type="number" label="Wert" dense outlined class="col-4" />
                  <q-select
                    v-model="testDifficulty"
                    :options="difficulties"
                    :option-label="(d) => `${d.label} (${d.value >= 0 ? '+' : ''}${d.value})`"
                    emit-value
                    map-options
                    label="Schwierigkeit"
                    dense
                    outlined
                    class="col-8"
                  />
                  <q-input v-model.number="testModifier" type="number" label="Modifikator" dense outlined class="col-4" />
                  <q-input v-model="testLabel" label="Bezeichnung (optional)" dense outlined class="col-8" maxlength="60" />
                </div>
                <div class="row items-center q-gutter-xs">
                  <q-btn
                    v-for="t in quickTests"
                    :key="t.label"
                    dense
                    outline
                    size="sm"
                    color="secondary"
                    :label="t.label"
                    @click="rollTest(`${t.name}${testLabel ? ' – ' + testLabel : ''}`)"
                  >
                    <q-tooltip>{{ t.name }}</q-tooltip>
                  </q-btn>
                </div>
                <q-btn
                  class="full-width"
                  color="primary"
                  icon="casino"
                  :label="`Probe auf ${effectiveTarget}`"
                  @click="rollTest()"
                />
              </q-card-section>
            </q-card>

            <q-card class="panel q-mb-md">
              <q-card-section class="section-title">Freier Wurf</q-card-section>
              <q-card-section class="q-gutter-sm">
                <q-input
                  v-model="notation"
                  label="Würfelausdruck"
                  hint="z. B. 2W10+4 · 3d6! · 4d6kh3 · 5d6>=5"
                  dense
                  outlined
                  maxlength="80"
                  @keyup.enter="rollFree"
                >
                  <template #append>
                    <q-btn flat round dense icon="send" color="secondary" @click="rollFree" />
                  </template>
                </q-input>
                <q-input v-model="freeLabel" label="Bezeichnung (optional)" dense outlined maxlength="60" @keyup.enter="rollFree" />
              </q-card-section>
              <q-separator dark />
              <q-card-section>
                <div class="row items-center q-gutter-sm">
                  <q-btn round dense flat icon="remove" :disable="quickCount <= 1" @click="quickCount--" />
                  <div class="count">{{ quickCount }}×</div>
                  <q-btn round dense flat icon="add" :disable="quickCount >= 20" @click="quickCount++" />
                  <q-btn
                    v-for="s in [4, 6, 8, 10, 12, 20, 100]"
                    :key="s"
                    dense
                    unelevated
                    color="grey-9"
                    :label="`W${s}`"
                    class="die-btn"
                    @click="rollQuick(s)"
                  />
                </div>
              </q-card-section>
            </q-card>
          </div>

          <div class="col-12 col-md-7">
            <q-card class="panel log-card">
              <q-card-section class="section-title row items-center">
                <div class="col">Verlauf</div>
                <q-btn flat dense size="sm" icon="delete_sweep" label="Leeren" :disable="!rolls.length" @click="clearLog" />
              </q-card-section>
              <q-separator dark />
              <div class="log">
                <div v-if="!rolls.length" class="text-grey-6 q-pa-lg text-center">Noch nichts gewürfelt.</div>
                <transition-group name="roll">
                  <div
                    v-for="r in rolls"
                    :key="r.id"
                    class="entry"
                    :class="{ own: r.player === name }"
                  >
                    <div class="row items-baseline no-wrap">
                      <span class="player" :style="{ color: playerColor(r.player) }">{{ r.player }}</span>
                      <span v-if="r.label" class="label q-ml-sm ellipsis">{{ r.label }}</span>
                      <q-space />
                      <span class="ts">{{ time(r.ts) }}</span>
                    </div>

                    <div v-if="r.kind === 'test'" class="row items-center q-mt-xs">
                      <div class="big" :class="testResult(r).success ? 'text-positive' : 'text-negative'">
                        {{ String(r.total).padStart(2, '0') }}
                      </div>
                      <div class="q-ml-md">
                        <div class="text-grey-5">gegen {{ r.target }}</div>
                        <div :class="testResult(r).success ? 'text-positive' : 'text-negative'" class="text-weight-bold">
                          {{ testResult(r).text }}
                        </div>
                      </div>
                    </div>

                    <div v-else class="row items-center q-mt-xs">
                      <div class="big text-secondary">{{ r.total }}</div>
                      <div class="q-ml-md output">{{ r.output }}</div>
                    </div>
                  </div>
                </transition-group>
              </div>
            </q-card>
          </div>
        </div>
      </q-page>
    </q-page-container>

    <q-dialog v-model="setupOpen" :persistent="!room || !name">
      <q-card class="panel" style="min-width: 320px">
        <q-card-section class="section-title">Würfelraum betreten</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input v-model="setupName" label="Dein Name" outlined dense autofocus maxlength="30" @keyup.enter="saveSetup" />
          <q-input
            v-model="setupRoom"
            label="Raum"
            outlined
            dense
            maxlength="40"
            :hint="`Alle mit demselben Raum sehen dieselben Würfe → ${slugify(setupRoom) || '…'}`"
            @keyup.enter="saveSetup"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-if="room && name" flat label="Abbrechen" v-close-popup />
          <q-btn color="primary" label="Beitreten" :disable="!setupName.trim() || !slugify(setupRoom)" @click="saveSetup" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<style lang="scss">
body {
  background: $dark-page;
}
.header {
  border-bottom: 1px solid rgba($secondary, 0.4);
}
.title {
  font-family: Georgia, 'Times New Roman', serif;
  letter-spacing: 0.05em;
  color: $secondary;
}
.players {
  font-size: 0.8rem;
}
.panel {
  background: $dark;
  border: 1px solid rgba($secondary, 0.25);
}
.section-title {
  font-family: Georgia, 'Times New Roman', serif;
  color: $secondary;
  font-size: 1.05rem;
  padding-bottom: 4px;
}
.count {
  min-width: 2.2em;
  text-align: center;
  font-weight: bold;
}
.die-btn {
  min-width: 3.4em;
}
.log-card {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 130px);
  min-height: 400px;
}
.log {
  overflow-y: auto;
  flex: 1;
}
.entry {
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  &.own {
    background: rgba($primary, 0.12);
  }
}
.player {
  font-weight: bold;
}
.label {
  color: #ccc;
}
.ts {
  font-size: 0.75rem;
  color: #777;
}
.big {
  font-size: 1.8rem;
  font-weight: bold;
  min-width: 2.2em;
  font-family: Georgia, 'Times New Roman', serif;
}
.output {
  color: #aaa;
  font-family: monospace;
  word-break: break-word;
}
.roll-enter-active {
  transition: all 0.35s ease;
}
.roll-enter-from {
  opacity: 0;
  transform: translateY(-12px);
  background: rgba($secondary, 0.25);
}
@media (max-width: 1023px) {
  .log-card {
    height: 70vh;
  }
}
</style>
