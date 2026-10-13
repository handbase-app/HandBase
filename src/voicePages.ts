// Recherche vocale « micro ✨ » des pages autres que les listes de joueurs : bilan de détection, Événements, Groupes.
// Chaque page a son schéma (clés, valeurs permises), ses filtres actifs sous ces clés, et sa relecture de la réponse du
// modèle (src/voiceFilters.ts pour le reste : actions, textes). Fonctions pures (tools/test-recherche-vocale-pages.ts).
// Seuls la phrase, le schéma et les filtres actifs partent chez Mistral : jamais de données de joueurs ; les noms
// d'événements, de groupes et de clubs ne sont pas listés (le modèle recopie ce qui est dit, l'appli le retrouve ici).

import {
  asText,
  bestMatch,
  isTrue,
  normalize,
  parseSex,
  parseYear,
  quote,
  readName,
  readPlace,
  startReading,
  type FilterRules,
  type Places,
  type VoicePage,
} from './voiceFilters'

const NAME_PLACEHOLDER = '(nom)'
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

// ---------- Événements ----------

export type EventsVoice = { q: string; type: string; year: string; mine: boolean }
export const EMPTY_EVENTS: EventsVoice = { q: '', type: '', year: '', mine: false }

export type EventsVoiceContext = {
  types: { value: string; label: string }[]
  /** Noms et lieux des événements (retrouvés ici, jamais envoyés). */
  names: string[]
  /** Années des événements de la liste. */
  years: string[]
}

const EVENT_KEYS = ['recherche', 'type', 'annee', 'mesEvenements']
const TYPE_ALIASES: Record<string, string[]> = {
  match: ['matchs', 'rencontre', 'rencontres'],
  tournoi: ['tournois', 'plateau', 'plateaux'],
  entrainement: ['entrainements', 'stage', 'stages', 'seance', 'seances'],
  observation: ['observations', 'detection', 'detections', 'journee de selection', 'selection'],
}

export function eventsRules(ctx: EventsVoiceContext): FilterRules<EventsVoice> {
  return {
    empty: EMPTY_EVENTS,
    fields: { recherche: ['q'], type: ['type'], annee: ['year'], mesEvenements: ['mine'] },
    keyText: { recherche: 'recherche', type: 'type', annee: 'année', mesEvenements: 'mes événements' },
    aliases: {
      recherche: 'recherche', nom: 'recherche', noms: 'recherche', lieu: 'recherche', texte: 'recherche', type: 'type', types: 'type', genre: 'type',
      annee: 'annee', annees: 'annee', date: 'annee', mes: 'mesEvenements', mesevenements: 'mesEvenements', createur: 'mesEvenements',
    },
    interpret: (filtres, nonGere) => {
      const r = startReading(filtres, nonGere, EVENT_KEYS)
      const { f, has, understood, skip } = r
      const values: EventsVoice = { ...EMPTY_EVENTS }
      if (has('type')) {
        const s = asText(f.type)
        const exact = ctx.types.find((t) => t.value === normalize(s))
        const m = exact ? { found: exact } : bestMatch(s, ctx.types, (t) => [t.label, t.value, ...(TYPE_ALIASES[t.value] ?? [])])
        if ('found' in m) {
          values.type = m.found.value
          understood.push({ key: 'type', label: m.found.label.toLowerCase() })
        } else skip(`type ${quote(s)}`, 'valeur inconnue')
      }
      if (has('annee')) {
        const s = asText(f.annee)
        if (ctx.years.includes(s)) {
          values.year = s
          understood.push({ key: 'annee', label: `en ${s}` })
        } else skip(`année ${quote(s)}`, /^\d{4}$/.test(s) ? 'aucun événement cette année-là' : 'pas une année')
      }
      if (has('mesEvenements') && isTrue(f.mesEvenements)) {
        values.mine = true
        understood.push({ key: 'mesEvenements', label: 'créés par moi' })
      }
      if (has('recherche')) {
        const n = readName(f.recherche, ctx.names)
        if ('q' in n) {
          values.q = n.q
          understood.push({ key: 'recherche', label: n.label })
        } else if (n.none) skip(`recherche ${quote(n.none)}`, 'aucun événement de ce nom ou à ce lieu')
      }
      return { values, understood, notFound: r.notFound, unsupported: r.unsupported }
    },
  }
}

export function eventsVoicePage(ctx: EventsVoiceContext): VoicePage<EventsVoice> {
  return {
    id: 'evenements',
    mode: 'filtres_evenements',
    rules: eventsRules(ctx),
    schema: () => ({
      recherche: 'nom de l’événement ou lieu, tel que dit',
      type: ctx.types.map((t) => `${t.value} (${t.label.toLowerCase()})`).join(', '),
      annee: 'année de l’événement, entier',
      mesEvenements: 'true : seulement les événements que j’ai créés',
    }),
    current: (v) => {
      const o: Record<string, string | number | boolean> = {}
      if (v.type) o.type = v.type
      if (v.year) o.annee = Number(v.year)
      if (v.mine) o.mesEvenements = true
      if (v.q.trim()) o.recherche = NAME_PLACEHOLDER
      return o
    },
    hint: 'les tournois de 2025 », « le match à Toulon », « seulement les miens », « efface tout',
  }
}

// ---------- Groupes ----------

export type GroupsVoice = { q: string; scope: string; sex: string; dept: string; region: string; year: string }
export const EMPTY_GROUPS: GroupsVoice = { q: '', scope: '', sex: '', dept: '', region: '', year: '' }

export type GroupsVoiceContext = Places & {
  scopes: { value: string; label: string }[]
  /** Noms des groupes que le compte voit (retrouvés ici, jamais envoyés). */
  names: string[]
  /** Années d'âge des groupes. */
  years: string[]
}

const GROUP_KEYS = ['recherche', 'portee', 'sexe', 'region', 'departement', 'annee']
const SCOPE_ALIASES: Record<string, string[]> = { federation: ['FFHB', 'national', 'nationaux', 'France'], ligue: ['ligues', 'régional', 'régionaux'], comite: ['comités', 'départemental', 'départementaux'] }

export function groupsRules(ctx: GroupsVoiceContext): FilterRules<GroupsVoice> {
  return {
    empty: EMPTY_GROUPS,
    fields: { recherche: ['q'], portee: ['scope'], sexe: ['sex'], region: ['region', 'dept'], departement: ['dept'], annee: ['year'] },
    keyText: { recherche: 'recherche', portee: 'portée', sexe: 'garçons / filles', region: 'ligue', departement: 'comité', annee: 'année d’âge' },
    aliases: {
      recherche: 'recherche', nom: 'recherche', noms: 'recherche', texte: 'recherche', portee: 'portee', niveau: 'portee', sexe: 'sexe', genre: 'sexe',
      mixte: 'sexe', region: 'region', ligue: 'region', departement: 'departement', dept: 'departement', comite: 'departement', territoire: 'region',
      annee: 'annee', annees: 'annee', age: 'annee', generation: 'annee',
    },
    interpret: (filtres, nonGere) => {
      const r = startReading(filtres, nonGere, GROUP_KEYS)
      const { f, has, understood, skip } = r
      const values: GroupsVoice = { ...EMPTY_GROUPS }
      if (has('portee')) {
        const s = asText(f.portee)
        const exact = ctx.scopes.find((x) => x.value === normalize(s))
        const m = exact ? { found: exact } : bestMatch(s, ctx.scopes, (x) => [x.label, x.value, ...(SCOPE_ALIASES[x.value] ?? [])])
        if ('found' in m) {
          values.scope = m.found.value
          understood.push({ key: 'portee', label: m.found.label })
        } else skip(`portée ${quote(s)}`, 'valeur inconnue')
      }
      if (has('sexe')) {
        const s = normalize(asText(f.sexe))
        const v = s.startsWith('mixte') ? 'mixte' : parseSex(f.sexe)
        if (v) {
          values.sex = v
          understood.push({ key: 'sexe', label: v === 'mixte' ? 'mixtes' : SEX_TEXT[v] })
        } else skip(`sexe ${quote(f.sexe)}`, 'valeur inconnue')
      }
      // Territoire : pas pour la Fédération ; une ligue n'a pas de comité.
      if (values.scope === 'federation') {
        for (const k of ['region', 'departement']) if (has(k)) skip(`${k === 'region' ? 'ligue' : 'comité'} ${quote(f[k])}`, 'les groupes de la Fédération n’ont pas de territoire')
      } else {
        if (values.scope === 'ligue' && has('departement')) skip(`comité ${quote(f.departement)}`, 'les groupes de ligue n’ont pas de comité')
        const g = values.scope === 'ligue' ? { ...f, departement: undefined } : f
        const place = readPlace(g, ctx, { ...r, f: g, has: (k) => g[k] !== undefined && r.has(k) }, { dept: (c) => (values.dept = c), region: (id) => (values.region = id) }, undefined, {
          dept: 'comité',
          region: 'ligue',
        })
        // Comité choisi : sa ligue, comme dans le menu.
        if (place.dept && !place.region) values.region = ctx.regionOfDept?.(place.dept) ?? ''
      }
      if (has('annee')) {
        const s = asText(f.annee)
        if (ctx.years.includes(s)) {
          values.year = s
          understood.push({ key: 'annee', label: `année ${s}` })
        } else skip(`année ${quote(s)}`, /^\d{4}$/.test(s) ? 'aucun groupe de cette année' : 'pas une année')
      }
      if (has('recherche')) {
        const n = readName(f.recherche, ctx.names)
        if ('q' in n) {
          values.q = n.q
          understood.push({ key: 'recherche', label: n.label })
        } else if (n.none) skip(`groupe ${quote(n.none)}`, 'aucun groupe de ce nom')
      }
      return { values, understood, notFound: r.notFound, unsupported: r.unsupported }
    },
    afterAdd: (values, added, it) => {
      if (added.has('departement') && !added.has('region')) values.region = it.values.region
      if (added.has('region') && !added.has('departement') && values.dept && ctx.regionOfDept?.(values.dept) !== values.region) values.dept = ''
      if (values.scope === 'federation') values.region = values.dept = ''
      if (values.scope === 'ligue') values.dept = ''
    },
  }
}

export function groupsVoicePage(ctx: GroupsVoiceContext): VoicePage<GroupsVoice> {
  return {
    id: 'groupes',
    mode: 'filtres_groupes',
    rules: groupsRules(ctx),
    schema: () => ({
      recherche: 'nom du groupe tel que dit',
      portee: ctx.scopes.map((x) => `${x.value} (${x.label.toLowerCase()})`).join(', '),
      sexe: 'M (garçons), F (filles) ou mixte',
      region: 'ligue (région) : nom tel que dit',
      departement: 'comité (département) : numéro ou nom tel que dit',
      annee: 'année d’âge (année de naissance), entier',
    }),
    current: (v) => {
      const o: Record<string, string | number | boolean> = {}
      if (v.scope) o.portee = v.scope
      if (v.sex) o.sexe = v.sex
      if (v.region) o.region = ctx.regions.find((x) => x.id === v.region)?.name ?? v.region
      if (v.dept) o.departement = v.dept
      if (v.year) o.annee = Number(v.year)
      if (v.q.trim()) o.recherche = NAME_PLACEHOLDER
      return o
    },
    hint: 'les groupes de filles du Var », « ceux de 2011 », « Intercomités », « efface tout',
  }
}
