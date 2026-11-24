import { describe, expect, it } from 'vitest'
import { type CrewPick, describeEntries, matchCrew, parseCrewReply } from '#/lib/crew-reply'

const crew: CrewPick[] = [
  { id: 't', name: 'Tommy', aliases: 'Tom', payType: 'hourly', rateCents: 2500 },
  { id: 'g', name: 'Gary', aliases: null, payType: 'day', rateCents: 22500 },
  { id: 'l', name: 'Lenny', aliases: null, payType: null, rateCents: null },
]
const entries = (t: string) => {
  const r = parseCrewReply(t, crew)
  if (r.kind !== 'entries') throw new Error(`not entries: ${r.kind}`)
  return r.entries
}

describe('parseCrewReply', () => {
  it('reads names and hours, pricing each with their usual pay', () => {
    expect(entries('Tommy 8, Gary 8')).toEqual([
      { name: 'Tommy', crewMemberId: 't', hours: 8, payType: 'hourly', rateCents: 2500, costCents: 20000, needsReview: false },
      { name: 'Gary', crewMemberId: 'g', hours: 8, payType: 'day', rateCents: 22500, costCents: 22500, needsReview: false },
    ])
  })
  it('takes a day amount or an hourly rate from the reply over the usual pay', () => {
    const [t, g, l] = entries('tommy 7.5h\ngary $250\nLenny 6 at $30')
    expect(t).toMatchObject({ hours: 7.5, costCents: 18750 })
    expect(g).toMatchObject({ payType: 'day', rateCents: 25000, costCents: 25000, hours: null })
    expect(l).toMatchObject({ crewMemberId: 'l', hours: 6, payType: 'hourly', rateCents: 3000, costCents: 18000, needsReview: false })
    expect(entries('Lenny 6 $30/hr')[0]).toMatchObject({ rateCents: 3000, costCents: 18000 })
    expect(entries('Lenny 6 hrs @ 32.50')[0]).toMatchObject({ rateCents: 3250, costCents: 19500 })
    expect(entries('Gary 250 for the day and Tom 8')).toMatchObject([
      { name: 'Gary', costCents: 25000 },
      { name: 'Tommy', hours: 8, costCents: 20000 },
    ])
  })
  it('flags a name not on the crew list and someone with no pay, without guessing', () => {
    const [m, l] = entries('Mike 8, Lenny 8')
    expect(m).toMatchObject({ name: 'Mike', crewMemberId: null, needsReview: true, costCents: null })
    expect(l).toMatchObject({ crewMemberId: 'l', needsReview: true, costCents: null, problem: 'no pay for Lenny' })
  })
  it("reads two people with no comma between them, as Pat wrote on Nov 23: 'Mike 8 - $400.    Lenny 8 -$500.'", () => {
    expect(entries('Mike 8 - $400.    Lenny 8 -$500.')).toMatchObject([
      { name: 'Mike', crewMemberId: null, hours: 8, payType: 'day', costCents: 40000, needsReview: true },
      { name: 'Lenny', crewMemberId: 'l', hours: 8, payType: 'day', costCents: 50000, needsReview: false },
    ])
    expect(entries('Tommy 8 Gary 8 hrs Lenny 6 at $30').map((e) => e.name)).toEqual(['Tommy', 'Gary', 'Lenny'])
    // A first and last name before any number stays one person; pay words stay with their person.
    expect(entries('Mike Smith 8 hrs at $30')).toMatchObject([{ name: 'Mike Smith', hours: 8, costCents: 24000 }])
    expect(entries('Gary 250 for the day')).toHaveLength(1)
  })
  it('understands whole-reply words', () => {
    expect(parseCrewReply('Nobody', crew).kind).toBe('none')
    expect(parseCrewReply('rain day', crew).kind).toBe('none')
    expect(parseCrewReply('same as yesterday', crew).kind).toBe('same')
    expect(parseCrewReply('FIX', crew).kind).toBe('fix')
    expect(parseCrewReply('???', crew).kind).toBe('unreadable')
  })
  it('matches nicknames and first-name prefixes only when they point at one person', () => {
    expect(matchCrew('tom', crew)?.id).toBe('t')
    expect(matchCrew('Len', crew)?.id).toBe('l')
    expect(matchCrew('Ga', crew)).toBeNull()
  })
  it('describes entries for the confirmation text', () => {
    expect(describeEntries(entries('Tommy 8, Gary $250, Lenny 6 at $30'))).toBe('Tommy 8h at $25/hr, Gary $250 day, Lenny 6h at $30/hr')
  })
})
