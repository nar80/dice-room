// Rogue Trader: W100 gleich oder unter Zielwert. Je volle 10 Punkte Abstand = 1 Grad
// (wie im Spielleiter-Tool). 100 misslingt immer, 01 gelingt immer.
export function evaluateTest(roll, target) {
  const success = roll !== 100 && (roll === 1 || roll <= target)
  const degrees = Math.floor(Math.abs(target - roll) / 10)
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
