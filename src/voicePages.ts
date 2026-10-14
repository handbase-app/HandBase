// Recherche vocale « micro ✨ » du bilan de détection (les listes Joueurs, Événements et Groupes ont leurs filtres en
// recette : src/playerQuery.ts, src/listQuery.ts).
// Chaque page a son schéma (clés, valeurs permises), ses filtres actifs sous ces clés, et sa relecture de la réponse du
// modèle (src/voiceFilters.ts pour le reste : actions, textes). Fonctions pures (tools/test-recherche-vocale-pages.ts).
// Seuls la phrase, le schéma et les filtres actifs partent chez Mistral : jamais de données de joueurs ; les noms
// d'événements, de groupes et de clubs ne sont pas listés (le modèle recopie ce qui est dit, l'appli le retrouve ici).

import {
  asText,
  bestMatch,
  normalize,
  parseSex,
  parseYear,
  quote,
  readPlace,
  startReading,
  type FilterRules,
  type Places,
  type VoicePage,
} from './voiceFilters'

const SEX_TEXT = { M: 'garçons', F: 'filles' } as const

// ---------- Bilan de détection (/bilan) ----------

/** Filtres du bilan pilotés à la voix (le reste de l'état de la page, « Déjà vus » ouvert, couleur de la carte, ne bouge pas). */
export type BilanVoice = {
  sex: 'all' | 'M' | 'F'
  period: 'season' | 'all'
  /** null : toutes les années ; '' : année inconnue. */
  year: string | null
  region: string
  dept: string
  /** Clé du club (clubKey) ; null : aucun. */
  club: string | null
  view: 'map' | 'years'
}

export type BilanVoiceContext = Places & {
  /** Clubs des joueurs de la base, avec le département de la plupart de leurs joueurs (retrouvés ici, jamais envoyés). */
  clubs: { key: string; name: string; dept?: string }[]
  thisYear: number
  /** Vue affichée : « efface tout » ne la change pas. */
  view: BilanVoice['view']
  /** Libellé de la saison en cours (« 2025-2026 »). */
  season: string
}

const BILAN_KEYS = ['sexe', 'annee', 'periode', 'region', 'departement', 'club', 'vue']

export function parsePeriod(v: unknown): BilanVoice['period'] | undefined {
  const s = normalize(asText(v))
  if (/^(saison|cette saison|season|en cours|actuelle?)/.test(s)) return 'season'
  if (/^(toujours|depuis toujours|tout|all|toutes)/.test(s)) return 'all'
  return undefined
}

export function parseView(v: unknown): BilanVoice['view'] | undefined {
  const s = normalize(asText(v))
  if (/^(carte|map|france)/.test(s)) return 'map'
  if (/^(generation|annee|years)/.test(s)) return 'years'
  return undefined
}

export function bilanRules(ctx: BilanVoiceContext): FilterRules<BilanVoice> {
  const empty: BilanVoice = { sex: 'all', period: 'season', year: null, region: '', dept: '', club: null, view: ctx.view }
  return {
    empty,
    // Comme sur la page : changer de région remet le département et le club ; changer de département, le club.
    fields: { sexe: ['sex'], annee: ['year'], periode: ['period'], region: ['region', 'dept', 'club'], departement: ['dept', 'club'], club: ['club'], vue: ['view'] },
    keyText: { sexe: 'garçons / filles', annee: 'génération', periode: 'période', region: 'région', departement: 'département', club: 'club', vue: 'vue' },
    aliases: {
      sexe: 'sexe', genre: 'sexe', annee: 'annee', annees: 'annee', generation: 'annee', generations: 'annee', naissance: 'annee',
      periode: 'periode', saison: 'periode', region: 'region', ligue: 'region', departement: 'departement', dept: 'departement',
      lieu: 'region', club: 'club', clubs: 'club', vue: 'vue', carte: 'vue',
    },
    interpret: (filtres, nonGere, current) => {
      const r = startReading(filtres, nonGere, BILAN_KEYS)
      const { f, has, understood, skip } = r
      const values: BilanVoice = { ...empty }
      if (has('sexe')) {
        const v = parseSex(f.sexe)
        if (v) {
          values.sex = v
          understood.push({ key: 'sexe', label: SEX_TEXT[v] })
        } else skip(`sexe ${quote(f.sexe)}`, 'valeur inconnue')
      }
      if (has('annee')) {
        const v = parseYear(f.annee, ctx.thisYear)
        if (v) {
          values.year = String(v)
          understood.push({ key: 'annee', label: `génération ${v}` })
        } else if (/^inconnu/.test(normalize(asText(f.annee)))) {
          values.year = ''
          understood.push({ key: 'annee', label: 'année de naissance inconnue' })
        } else skip(`génération ${quote(f.annee)}`, 'pas une année de naissance')
      }
      if (has('periode')) {
        const v = parsePeriod(f.periode)
        if (v) {
          values.period = v
          understood.push({ key: 'periode', label: v === 'season' ? `saison ${ctx.season}` : 'depuis toujours' })
        } else skip(`période ${quote(f.periode)}`, 'valeur inconnue')
      }
      const place = readPlace(f, ctx, r, { dept: (c) => (values.dept = c), region: (id) => (values.region = id) })
      // Département choisi : sa région, comme un toucher sur la carte.
      if (place.dept && !place.region) values.region = ctx.regionOfDept?.(place.dept) ?? ''
      if (has('club')) {
        const s = asText(f.club)
        // Département dit : ses clubs ; sinon, s'il y a plusieurs clubs de ce nom, celui du département déjà choisi.
        const inDept = (d: string) => ctx.clubs.filter((c) => c.dept === d)
        let m = bestMatch(s, values.dept ? inDept(values.dept) : ctx.clubs, (c) => [c.name])
        if ('ambiguous' in m && !values.dept && current.dept) {
          const here = bestMatch(s, inDept(current.dept), (c) => [c.name])
          if ('found' in here) m = here
        }
        if ('found' in m) {
          values.club = m.found.key
          // Le club amène son lieu : la carte va à son département.
          if (!values.dept && m.found.dept) {
            values.dept = m.found.dept
            values.region = ctx.regionOfDept?.(m.found.dept) ?? ''
          }
          understood.push({ key: 'club', label: `club : ${m.found.name}` })
        } else if ('ambiguous' in m) skip(`club ${quote(s)}`, `${m.ambiguous.length} clubs possibles : choisissez dans la liste`)
        else skip(`club ${quote(s)}`, values.dept ? 'pas trouvé dans ce département' : 'pas trouvé dans la base')
      }
      if (has('vue')) {
        const v = parseView(f.vue)
        if (v) {
          values.view = v
          understood.push({ key: 'vue', label: v === 'map' ? 'vue carte' : 'vue générations' })
        } else skip(`vue ${quote(f.vue)}`, 'valeur inconnue')
      }
      return { values, understood, notFound: r.notFound, unsupported: r.unsupported }
    },
    afterAdd: (values, added, it) => {
      // Département ajouté : sa région suit ; club ajouté sans lieu : son lieu suit.
      if (added.has('departement') && !added.has('region')) values.region = it.values.region
      if (added.has('club') && !added.has('departement') && !added.has('region') && it.values.dept) {
        values.dept = it.values.dept
        values.region = it.values.region
      }
    },
  }
}

export function bilanVoicePage(ctx: BilanVoiceContext): VoicePage<BilanVoice> {
  const rules = bilanRules(ctx)
  return {
    id: 'bilan',
    rules,
    schema: () => ({
      sexe: 'M (garçons) ou F (filles)',
      annee: 'génération : année de naissance, entier (une seule) ; ou inconnue',
      periode: `saison (saison ${ctx.season}, par défaut) ou toujours (depuis toujours)`,
      region: 'nom de la région tel que dit',
      departement: 'numéro ou nom du département tel que dit',
      club: 'nom du club tel que dit',
      vue: 'carte ou generations (écran affiché)',
    }),
    current: (v) => {
      const o: Record<string, string | number | boolean> = {}
      if (v.sex !== 'all') o.sexe = v.sex
      if (v.year !== null) o.annee = v.year ? Number(v.year) : 'inconnue'
      if (v.period === 'all') o.periode = 'toujours'
      if (v.region) o.region = ctx.regions.find((x) => x.id === v.region)?.name ?? v.region
      if (v.dept) o.departement = /^[0-9AB]{2,3}$/i.test(v.dept) ? v.dept : 'non renseigné'
      if (v.club !== null) o.club = ctx.clubs.find((c) => c.key === v.club)?.name ?? 'club choisi'
      o.vue = v.view === 'map' ? 'carte' : 'generations'
      return o
    },
    hint: 'les filles de 2011 dans le Var », « depuis toujours », « le club de Toulon », « efface tout',
  }
}
