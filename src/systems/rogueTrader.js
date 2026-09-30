// Rogue Trader: W100 gleich oder unter Zielwert. Je volle 10 Punkte Abstand = 1 Grad
// (wie im Spielleiter-Tool). Ab AUTO_FAIL_FROM misslingt immer, 01 gelingt immer.
const AUTO_FAIL_FROM = 95

export function evaluateTest(roll, target) {
  const success = roll < AUTO_FAIL_FROM && (roll === 1 || roll <= target)
  // Automatischer Erfolg/Misserfolg gegen den Zielwert hat keine Grade
  const degrees = success === (roll <= target) ? Math.floor(Math.abs(target - roll) / 10) : 0
  return {
    success,
    degrees,
    text: success
      ? `Erfolg${degrees ? ` · ${degrees} ${degrees === 1 ? 'Erfolgsgrad' : 'Erfolgsgrade'}` : ''}`
      : `Misserfolg${degrees ? ` · ${degrees} ${degrees === 1 ? 'Misserfolgsgrad' : 'Misserfolgsgrade'}` : ''}`
  }
}

export const quickTests = [
  { label: 'KG', name: 'Kampfgeschick' },
  { label: 'BF', name: 'Ballistische Fertigkeit' },
  { label: 'ST', name: 'Stärke' },
  { label: 'WI', name: 'Widerstand' },
  { label: 'GE', name: 'Gewandtheit' },
  { label: 'IN', name: 'Intelligenz' },
  { label: 'WA', name: 'Wahrnehmung' },
  { label: 'WK', name: 'Willenskraft' },
  { label: 'CH', name: 'Charisma' }
]

export const difficulties = [
  { label: 'Trivial', value: 30 },
  { label: 'Elementar', value: 20 },
  { label: 'Einfach', value: 10 },
  { label: 'Normal', value: 0 },
  { label: 'Anspruchsvoll', value: -10 },
  { label: 'Schwer', value: -20 },
  { label: 'Sehr schwer', value: -30 }
]
