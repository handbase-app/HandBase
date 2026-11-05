// Types de src/db.ts dont a besoin la copie de src/importMesures.ts (partage/importMesures.ts), réduits aux champs qu'elle
// lit. Écrit à la main (src/db.ts tire Dexie : pas recopiable). Mêmes noms et mêmes types que dans src/db.ts.

export type CriterionKind = 'factual' | 'subjective'
export type CriterionScale = 'score5' | 'score3' | 'score2' | 'number' | 'text' | 'choice'

export interface Criterion {
  id: string
  label: string
  category: string
  kind: CriterionKind
  scale: CriterionScale
  unit?: string
  options?: string[]
  positions?: string[]
  active: boolean
  order: number
  deleted?: boolean
}

export interface Measurement {
  id: string
  playerId: string
  criterionId: string
  value: number | string
  date: string
  deleted?: boolean
}
