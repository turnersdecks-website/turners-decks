// FLW-203: the stored value of an option the owner adds in Estimator settings. Values must be letters and numbers
// only (document.ts) and unique within the question; the label can change later without touching the value.

/** "Trex Transcend" -> "trexTranscend"; "trexTranscend2" if that is taken; "option" when the label has no letters. */
export function optionValueFor(label: string, taken: readonly string[]): string {
  const words = label.match(/[a-zA-Z0-9]+/g) ?? []
  const base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join('').slice(0, 36) || 'option'
  let value = base
  for (let n = 2; taken.includes(value); n++) value = `${base}${n}`
  return value
}
