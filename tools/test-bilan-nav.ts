// Bilan : le retour remonte d'un étage (src/bilanNav.ts). npx jiti tools/test-bilan-nav.ts
import { placeKey, placeParent, placePlan, type Place } from '../src/bilanNav'

let fails = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { fails++; console.log(`ÉCHEC ${name}\n  obtenu ${g}\n  voulu  ${w}`) } else console.log(`ok ${name}`)
}
const P = (region = '', dept = '', club: string | null = null): Place => ({ region, dept, club })
const F = P(), R = P('93'), D = P('93', '83'), C = P('93', '83', 'toulon'), D2 = P('93', '06'), O = P('76', '34')
const K = (...ps: Place[]) => ps.map(placeKey)

eq('parent du club', placeParent(C), D)
eq('parent du département', placeParent(D), R)
eq('parent de la région', placeParent(R), F)
eq('France sans parent', placeParent(F), undefined)
eq('département sans région : France', placeParent(P('', '97x')), F)

eq('descendre France → région', placePlan([], F, R), { pop: 0, push: [R] })
eq('descendre région → département', placePlan(K(F), R, D), { pop: 0, push: [D] })
eq('France → département direct : région empilée', placePlan([], F, D), { pop: 0, push: [R, D] })
eq('remonter club → département', placePlan(K(F, R, D), C, D), { pop: 1, push: [] })
eq('remonter club → France', placePlan(K(F, R, D), C, F), { pop: 3, push: [] })
eq('département voisin même région', placePlan(K(F, R), D, D2), { pop: 1, push: [D2] })
eq('département d\'une autre région', placePlan(K(F, R), D, O), { pop: 2, push: [P('76'), O] })
eq('autre club du département', placePlan(K(F, R, D), C, P('93', '83', 'hyeres')), { pop: 1, push: [P('93', '83', 'hyeres')] })
eq('ouvert directement sur un département', placePlan([], D, D2), { pop: 0, replace: F, push: [R, D2] })

if (fails) { console.log(`${fails} échec(s)`); process.exit(1) }
console.log('tout bon')
