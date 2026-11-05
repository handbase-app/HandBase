// Jeu de données FICTIF pour le serveur MCP Nextar (tools/test-mcp.ts, essai de bout en bout tools/essai-mcp/) : une Source
// en mémoire qui se comporte comme supabase/functions/mcp/source.ts (joueurs vivants seulement, aucun nom pour la lecture,
// propositions et rapports gardés). Noms, clubs et licences inventés. Importable par Node (jiti) et par Deno (imports en .ts,
// aucun module Node).

import type { AvisSrv, CritereSrv, EvenementSrv, GroupeSrv, JoueurNom, MesureSrv, PropositionSrv, Source, VuSrv } from '../supabase/functions/mcp/outils.ts'

export interface JoueurFictif {
  id: string
  firstName: string
  lastName: string
  birthDate: string
  sex: 'M' | 'F'
  position: string
  dept: string
  club: string
  license: string
  mergedInto?: string
  review?: string
}

export const CRITERES: CritereSrv[] = [
  { id: 'sprint_10', label: 'Sprint 10 m', category: 'Vitesse', kind: 'factual', scale: 'number', unit: 's', active: true, order: 1 },
  { id: 'cmj', label: 'CMJ', category: 'Détente', kind: 'factual', scale: 'number', unit: 'cm', active: true, order: 2 },
  { id: 'taille', label: 'Taille', category: 'Morphologie', kind: 'factual', scale: 'number', unit: 'cm', active: true, order: 3 },
  { id: 'lateralite', label: 'Latéralité', category: 'Morphologie', kind: 'factual', scale: 'choice', options: ['Gauche', 'Droit'], active: true, order: 4 },
  { id: 'tir', label: 'Tir en appui', category: 'Attaque', kind: 'subjective', scale: 'score5', positions: ['ARG', 'ARD'], active: true, order: 10 },
  { id: 'defense', label: 'Défense', category: 'Défense', kind: 'subjective', scale: 'score5', active: true, order: 11 },
  { id: 'mental', label: 'Mental', category: 'Mental', kind: 'subjective', scale: 'score5', active: true, order: 12 },
  { id: 'ancien', label: 'Ancien test', kind: 'factual', scale: 'number', unit: 's', active: false, order: 20, deleted: true },
]

export const JOUEURS: JoueurFictif[] = [
  { id: 'p-lucas', firstName: 'Lucas', lastName: 'Exemplaire', birthDate: '2011-03-14', sex: 'M', position: 'ARG', dept: '83', club: 'Club Fictif de Toulon', license: '6383001000111' },
  { id: 'p-emma', firstName: 'Emma', lastName: 'Imaginaire', birthDate: '2011-07-02', sex: 'F', position: 'DC', dept: '83', club: 'Entente Inventée', license: '6383001000222' },
  { id: 'p-noah', firstName: 'Noah', lastName: 'Fictivus', birthDate: '2012-01-21', sex: 'M', position: 'PIV', dept: '13', club: 'HB Nulle Part', license: '6313001000333' },
  { id: 'p-lea', firstName: 'Léa', lastName: 'Bidonville', birthDate: '2011-11-30', sex: 'F', position: 'ARD', dept: '06', club: 'Club Fictif de Toulon', license: '6306001000444' },
  { id: 'p-hugo', firstName: 'Hugo', lastName: 'Martinvert', birthDate: '2011-05-05', sex: 'M', position: 'ARG', dept: '83', club: 'AS Rêveuse', license: '6383001000555' },
  { id: 'p-hugo2', firstName: 'Hugo', lastName: 'Martinbleu', birthDate: '2012-05-05', sex: 'M', position: 'AG', dept: '83', club: 'AS Rêveuse', license: '6383001000556' },
  { id: 'p-jade', firstName: 'Jade', lastName: 'Chimérique', birthDate: '2010-09-09', sex: 'F', position: 'GB', dept: '2A', club: 'Corsica Fictive', license: '6320001000666' },
  { id: 'p-tom', firstName: 'Tom', lastName: 'Utopiste', birthDate: '2011-02-28', sex: 'M', position: 'AD', dept: '971', club: 'Karukera Invent', license: '6397101000777' },
  { id: 'p-fondu', firstName: 'Lucas', lastName: 'Exemplaire', birthDate: '2011-03-14', sex: 'M', position: 'ARG', dept: '83', club: 'Club Fictif de Toulon', license: '6383001000999', mergedInto: 'p-lucas' },
  { id: 'p-hors', firstName: 'Zoé', lastName: 'Horscadre', birthDate: '2011-04-04', sex: 'F', position: 'AG', dept: '83', club: 'Entente Inventée', license: '6383001000888', review: 'refused' },
]

export const EVENEMENTS: (EvenementSrv & { deleted?: boolean })[] = [
  { id: 'ev-var', name: 'Détection U15 Var', type: 'tournoi', date: '2026-10-12', playerIds: ['p-lucas', 'p-emma', 'p-hugo', 'p-hugo2', 'p-lea'], nums: { 'p-lucas': '7', 'p-emma': '11', 'p-hugo': '9', 'p-hugo2': '19', 'p-lea': '4' } },
  { id: 'ev-old', name: 'Stage de printemps', type: 'observation', date: '2026-04-02', archived: true, playerIds: ['p-noah', 'p-tom'] },
]

export const GROUPES: GroupeSrv[] = [{ id: 'g-pole', name: 'Pôle Espoirs Fictif', playerIds: ['p-lucas', 'p-emma', 'p-noah', 'p-jade'] }]

export const MESURES: MesureSrv[] = [
  { playerId: 'p-lucas', criterionId: 'sprint_10', value: 1.92, date: '2026-09-01' },
  { playerId: 'p-lucas', criterionId: 'sprint_10', value: 1.86, date: '2026-10-12' },
  { playerId: 'p-lucas', criterionId: 'taille', value: 176, date: '2026-10-12' },
  { playerId: 'p-emma', criterionId: 'sprint_10', value: 2.05, date: '2026-10-12' },
  { playerId: 'p-emma', criterionId: 'cmj', value: 31, date: '2026-10-12' },
  { playerId: 'p-noah', criterionId: 'cmj', value: 41, date: '2026-09-20' },
  { playerId: 'p-hugo', criterionId: 'sprint_10', value: 1.99, date: '2026-10-12' },
  { playerId: 'p-lea', criterionId: 'lateralite', value: 'Gauche', date: '2026-10-12' },
  { playerId: 'p-hors', criterionId: 'sprint_10', value: 1.7, date: '2026-10-12' },
]

/** Avis : notes ET commentaires (avec des noms dedans) ; les commentaires ne doivent jamais sortir. */
export const AVIS: (AvisSrv & { strengths?: string; improvements?: string; observer?: string })[] = [
  { playerId: 'p-lucas', date: '2026-10-12', scores: { tir: 4, defense: 3, mental: 5 }, strengths: 'Lucas Exemplaire a un tir puissant', observer: 'Observateur Fictif' },
  { playerId: 'p-lucas', date: '2026-10-13', scores: { tir: 5, defense: 4 }, improvements: 'Replacement défensif' },
  { playerId: 'p-emma', date: '2026-10-12', scores: { defense: 4, mental: 4 } },
  { playerId: 'p-hugo', date: '2026-10-12', scores: { tir: 2, defense: 2 }, strengths: 'Hugo Martinvert, bonne volonté' },
]

export const VUS: VuSrv[] = [
  { playerId: 'p-lucas', eventId: 'ev-var' },
  { playerId: 'p-lucas', eventId: 'ev-var' },
  { playerId: 'p-lucas', eventId: 'ev-old' },
  { playerId: 'p-emma', eventId: 'ev-var' },
  { playerId: 'p-noah', eventId: 'ev-old' },
]

/** Textes qui ne doivent JAMAIS apparaître dans une réponse d'outil (noms, prénoms rares, dates, clubs, licences, commentaires). */
export function textesInterdits(js: readonly JoueurFictif[] = JOUEURS): string[] {
  const out = new Set<string>()
  for (const p of js) {
    out.add(p.lastName)
    if (p.firstName.length >= 4) out.add(p.firstName)
    out.add(p.birthDate)
    out.add(p.club)
    out.add(p.license)
  }
  for (const a of AVIS) {
    if (a.strengths) out.add(a.strengths)
    if (a.improvements) out.add(a.improvements)
    if (a.observer) out.add(a.observer)
  }
  return [...out]
}

export interface SourceFictive extends Source {
  propositionsDeposees: { id: string; titre: string; contexte: Record<string, unknown>; lignes: string[][]; etat: string; created_at: string }[]
  rapportsDeposes: { id: string; titre: string; contenu: string }[]
  /** Appels faits à joueursNoms (pour vérifier que nextar_lire n'en fait aucun). */
  appelsNoms: number
}

/** Une Source en mémoire sur ces données (ou d'autres joueurs : grande base fictive). */
export function sourceFictive(o: { joueurs?: JoueurFictif[]; erreurDepot?: string } = {}): SourceFictive {
  const joueurs = o.joueurs ?? JOUEURS
  const vivants = () => joueurs.filter((p) => !p.mergedInto && p.review !== 'refused')
  let n = 0
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const props: SourceFictive['propositionsDeposees'] = []
  const raps: SourceFictive['rapportsDeposes'] = []
  const src: SourceFictive = {
    propositionsDeposees: props,
    rapportsDeposes: raps,
    appelsNoms: 0,
    async criteres() {
      return CRITERES.filter((c) => !c.deleted).map((c) => ({ ...c }))
    },
    async config() {
      return []
    },
    async evenements({ archives }) {
      return EVENEMENTS.filter((e) => !e.deleted && (archives || !e.archived)).map(({ nums: _n, ...e }) => ({ ...e }))
    },
    async evenement(id) {
      const e = EVENEMENTS.find((x) => x.id === id && !x.deleted)
      return e ? { ...e } : null
    },
    async groupes({ archives }) {
      return GROUPES.filter((g) => archives || !g.archived).map((g) => ({ ...g }))
    },
    async groupe(id) {
      const g = GROUPES.find((x) => x.id === id)
      return g ? { ...g } : null
    },
    async joueursLire(f, max) {
      let js = vivants()
      if (f.ids) js = js.filter((p) => f.ids!.includes(p.id))
      if (f.sexe) js = js.filter((p) => p.sex === f.sexe)
      if (f.postes?.length) js = js.filter((p) => f.postes!.includes(p.position))
      if (f.depts?.length) js = js.filter((p) => f.depts!.includes(p.dept))
      if (f.annees?.length) js = js.filter((p) => f.annees!.includes(+p.birthDate.slice(0, 4)))
      return { joueurs: js.slice(0, max).map((p) => ({ id: p.id, annee: +p.birthDate.slice(0, 4), sexe: p.sex, poste: p.position, dept: p.dept })), tronque: js.length > max }
    },
    async joueursNoms(ids, max) {
      src.appelsNoms++
      let js = vivants()
      if (ids) js = js.filter((p) => ids.includes(p.id))
      return { joueurs: js.slice(0, max).map((p): JoueurNom => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate })), tronque: js.length > max }
    },
    async mesures(ids) {
      return MESURES.filter((m) => ids.includes(m.playerId))
    },
    async avis(ids) {
      return AVIS.filter((a) => ids.includes(a.playerId)).map((a) => ({ playerId: a.playerId, date: a.date, scores: a.scores }))
    },
    async vus(ids) {
      return VUS.filter((v) => ids.includes(v.playerId))
    },
    async deposerProposition(p) {
      if (o.erreurDepot) return { erreur: o.erreurDepot }
      const id = uuid()
      props.push({ id, ...p, etat: 'en_attente', created_at: '2026-11-05T10:00:00Z' })
      return { id }
    },
    async proposition(id) {
      const p = props.find((x) => x.id === id)
      return p ? toSrv(p) : null
    },
    async propositions(limite) {
      return props.slice(-limite).reverse().map((p) => ({ ...toSrv(p), nbLignes: -1 }))
    },
    async deposerRapport(r) {
      const id = uuid()
      raps.push({ id, ...r })
      return { id, expires_at: '2026-12-05T10:00:00Z' }
    },
  }
  return src
}

const toSrv = (p: SourceFictive['propositionsDeposees'][number]): PropositionSrv => ({
  id: p.id,
  source: 'mcp',
  kind: 'mesures',
  titre: p.titre,
  etat: p.etat,
  nbLignes: p.lignes.length,
  created_at: p.created_at,
  updated_at: p.created_at,
  expires_at: '2026-12-05T10:00:00Z',
  deleted_at: null,
})

/** Grande base fictive (identifiants et noms tirés d'un générateur fixe). */
export function grandeBase(n: number): JoueurFictif[] {
  const prenoms = ['Adam', 'Basile', 'Chloé', 'Diane', 'Ethan', 'Fanny', 'Gaspard', 'Hélène', 'Iris', 'Jules', 'Kenza', 'Louis', 'Manon', 'Nina', 'Oscar', 'Paul', 'Rose', 'Sacha', 'Théo', 'Victor']
  const syll = ['ba', 'lu', 'mo', 'ri', 'ten', 'vo', 'gar', 'sel', 'pin', 'dor', 'chu', 'fal', 'nek', 'ro', 'zan', 'quel']
  let x = 123456789
  const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0), x >>> 12) // bits du haut (ceux du bas se répètent vite)
  const out: JoueurFictif[] = []
  for (let i = 0; i < n; i++) {
    const nom = syll[rnd() % 16] + syll[rnd() % 16] + syll[rnd() % 16] + syll[rnd() % 16]
    out.push({
      id: `fict-${i.toString(36)}-${(rnd() % 1e6).toString(36)}`,
      firstName: prenoms[rnd() % prenoms.length],
      lastName: nom[0].toUpperCase() + nom.slice(1),
      birthDate: `${2008 + (rnd() % 6)}-0${1 + (rnd() % 9)}-1${rnd() % 10}`,
      sex: rnd() % 2 ? 'M' : 'F',
      position: ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV'][rnd() % 7],
      dept: String(1 + (rnd() % 95)).padStart(2, '0'),
      club: `Club fictif ${rnd() % 500}`,
      license: String(6300000000000 + i),
    })
  }
  return out
}
