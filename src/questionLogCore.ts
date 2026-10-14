import { nameKey } from './nameMatch'

/*
 * « Journal des questions avancées » : fonctions pures (testées dans tools/test-journal-questions.ts).
 * Chaque passage de « Poser une question » en mode avancé (src/components/SqlAnswer.tsx) laisse une entrée : la FORME de la
 * question (phrase anonymisée), ce que la recette n'a pas su faire, la requête écrite par l'assistant (anonymisée), le
 * statut et le nombre de lignes. JAMAIS le résultat ni aucune donnée de joueur. Ces entrées servent à écrire de nouvelles
 * recettes (src/recipe.ts) : « Copier pour Claude » les donne, groupées, en Markdown compact.
 *
 * ANONYMISATION (sur l'appareil, avant tout stockage) :
 *  - Un mot est comparé sans accents ni majuscules, mot entier (src/nameMatch.ts), aux prénoms et noms de famille des
 *    fiches joueurs de l'appareil. S'il en est un, il devient « [prénom] » ou « [nom] » : selon l'usage le plus fréquent
 *    dans les fiches ; à égalité (ambigu), « [nom] ».
 *  - Noms composés : « Jean-Pierre » (toutes les parties sont des prénoms ou des noms) devient un seul « [prénom] » ; mais un
 *    mot composé dont une partie n'est pas un nom reste tel quel (« martin-pêcheur », même si Martin est un nom).
 *  - Mots courants : règle choisie pour éviter les faux positifs, en trois niveaux.
 *     1. Petits mots (de, la, le, du, en, et…) : jamais remplacés (particules comprises : « [prénom] de la [nom] »).
 *     2. Vocabulaire de l'appli (clubs, départements, régions, postes, critères de l'appareil, mots du handball et des
 *        questions : joueur, club, gardien, taille, France…) : gardés, sauf collés à un nom reconnu (« Lucas Paris »).
 *     3. Mots courants qui sont aussi des noms ou prénoms (rose, blanc, petit, pierre, berger… : liste COMMON) : remplacés
 *        seulement s'ils sont écrits avec une majuscule ailleurs qu'en début de phrase, ou collés à un nom reconnu.
 *        « en maillot blanc » reste ; « les joueurs Blanc », « Lucas Blanc » sont anonymisés. Deux mots des niveaux 2 et 3
 *        collés, tous deux avec une majuscule, dont un du niveau 3 (« Marin Pivot ») : anonymisés aussi (nom complet).
 *  - Licences : un nombre d'au moins 6 chiffres d'un tenant, ou des groupes de chiffres (séparés par des espaces, points ou
 *    tirets) qui font ensemble au moins 8 chiffres, devient « [licence] ». Années (2010, « 2010-2011 »), départements,
 *    tailles : gardés.
 *  - SQL : seuls les textes entre apostrophes, les identifiants entre guillemets et les commentaires sont relus (les mots du
 *    SQL lui-même ne sont pas des données) ; un texte comparé à une colonne prenom ou nom (`prenom = 'x'`,
 *    `sans_accents(nom) LIKE '%x%'`, `nom IN ('x', 'y')`) est remplacé en entier, quel qu'il soit. Licences : partout.
 */

export type QuestionStatus = 'ok' | 'erreur_sql' | 'refuse' | 'delai' | 'reseau' | 'sans_requete' | 'annule' | 'erreur'

export const STATUS_LABEL: Record<QuestionStatus, string> = {
  ok: 'Réponse calculée',
  erreur_sql: 'Erreur SQL',
  refuse: 'Refusée par le contrôle',
  delai: 'Délai dépassé',
  reseau: 'Erreur réseau',
  sans_requete: 'Pas de requête proposée',
  annule: 'Annulée',
  erreur: 'Autre erreur',
}

/** Contenu d'une entrée du journal (table hb_question_log, supabase/043_journal_questions.sql). */
export interface QuestionLogFields {
  /** Moment de la question (ISO). */
  at: string
  /** Auteur : posé par le serveur à la création (compte et nom affiché) ; l'appareil met les siens en attendant. */
  authorId?: string
  authorName?: string
  /** Bascule automatique (la recette ne savait rien répondre) ou bouton « Essayer en mode avancé ». */
  how: 'auto' | 'button'
  /** Phrase anonymisée. */
  phrase: string
  /** Ce que la recette n'a pas su faire (« Pas pris en compte »), anonymisé. */
  recipeMissing?: string[]
  /** Ce que le mode avancé lui-même n'a pas su faire (nonGere), anonymisé. */
  modelMissing?: string[]
  /** Requête écrite par l'assistant (anonymisée) ; sqlRetry : la requête corrigée au 2e essai. */
  sql?: string
  sqlRetry?: string
  status: QuestionStatus
  /** Précision sur l'échec (message du contrôle ou de SQLite, code d'erreur), anonymisée. */
  detail?: string
  /** Nombre de lignes du résultat (500 au plus), jamais les lignes. */
  rows?: number
  /** Affichage proposé (nombre, joueurs, tableau, carte). */
  display?: string
  /** « Transformée en recette » : cochée par un administrateur. */
  recipeDone?: boolean
}

export type QuestionLogRow = QuestionLogFields & { id: string; updatedAt?: number; deleted?: boolean }

// ---------- Anonymisation ----------

export const PLACEHOLDER = { first: '[prénom]', last: '[nom]', licence: '[licence]' } as const

/** Niveau 1 : petits mots, jamais remplacés. */
const SMALL = new Set(
  (
    'a à au aux avec ce ces cet cette d de des du dans en et est il ils elle elles je j l la le les leur leurs lui ma me mes moi mon ' +
    'n ne ni nos notre nous on ont ou où par pas pour qu que qui quoi s sa sans se ses si son sont sur t ta te tes ton tu un une vos ' +
    'votre vous y van von der den da di do dos del della el al ben bin ibn mac mc o'
  ).split(' '),
)

/** Niveau 2 : vocabulaire de l'appli et des questions (complété par les clubs, lieux, postes et critères de l'appareil). */
const VOCAB = new Set(
  (
    'combien quel quels quelle quelles qui liste lister montre montrer affiche donne donner trouve cherche tous toutes tout ' +
    'joueur joueurs joueuse joueuses jeune jeunes garcon garcons fille filles homme hommes femme femmes masculin feminin ' +
    'club clubs equipe equipes staff groupe groupes evenement evenements match matchs tournoi tournois stage stages entrainement ' +
    'poste postes gardien gardiens ailier ailiers arriere arrieres demi centre pivot pivots droit droite gauche gaucher gauchers ' +
    'droitier droitiers ambidextre lateralite taille tailles grand grands poids age ans annee annees ne nes nee nees naissance ' +
    'region regions departement departements comite comites ligue ligues pole poles espoir espoirs france national nationale ' +
    'nord sud est ouest centre ile outre mer mesure mesures test tests avis note notes moyenne moyennes meilleur meilleurs ' +
    'plus moins entre depuis avant apres saison saisons mois semaine jour vu vus revoir licence licences licencie licencies ' +
    'repere reperes profil profils critere criteres vitesse detente saut sauts tir tirs defense attaque vision duel carte ' +
    'nombre total classement classe trie tri par premier premiers dernier derniers u13 u14 u15 u16 u17 u18 u19 u20 cadet cadets ' +
    'cadette cadettes minime minimes junior juniors senior seniors janvier fevrier mars avril mai juin juillet aout septembre ' +
    'octobre novembre decembre lundi mardi mercredi jeudi vendredi samedi dimanche'
  ).split(' '),
)

/**
 * Niveau 3 : mots courants qui sont aussi des noms ou prénoms fréquents (liste non exhaustive) : remplacés seulement avec
 * une majuscule hors début de phrase, ou collés à un nom reconnu.
 */
const COMMON = new Set(
  (
    'rose blanc blanche noir noire petit petite grand grande gros long court roux rousse brun brune vert verte bon bonne fort ' +
    'doux sage juste joli jolie fleur lune soleil claire clair olive prune marine ange roi reine pierre bois roche rocher fontaine ' +
    'riviere vallee vigne colin merle pinson mouton loup renard lievre poulain berger boucher boulanger marchand meunier ' +
    'chevalier charpentier masson page baron comte prince bailly marin moulin chene poirier pommier noel pascal toussaint ' +
    'avril janvier juin martial constant fidele aime desire victoire prudence patience gloire espoir august auguste'
  ).split(' '),
)

/** Clé de comparaison d'un mot (sans accents ni majuscules, comme la recherche par nom). */
const keyOf = (w: string) => nameKey(w).replace(/ /g, '')

export interface AnonymizerInput {
  /** Fiches joueurs de l'appareil (prénom et nom seulement). */
  players: { firstName?: string; lastName?: string }[]
  /** Mots à garder (clubs, départements, régions, postes, critères…) : niveau 2. */
  keep?: string[]
}

export interface Anonymizer {
  text: (s: string) => string
  sql: (s: string) => string
}

type Tier = 'small' | 'vocab' | 'common' | 'none'

/**
 * Remplace les numéros de licence : un nombre d'au moins 6 chiffres d'un seul tenant, ou des groupes séparés par des espaces,
 * points ou tirets qui font ensemble au moins 8 chiffres (licence dite par morceaux : « 638 301 500 1234 »). Années seules
 * ou en liste (« 2010 2011 », « 2010-2011 ») et petits nombres (« 180 185 ») : gardés.
 */
export function maskLicences(s: string): string {
  return s.replace(/(?<![\p{L}\d_])\d+(?:[ .-]\d+)*(?![\p{L}\d_])/gu, (m) => {
    const groups = m.split(/[ .-]/)
    if (groups.length === 1) return m.length >= 6 ? PLACEHOLDER.licence : m
    if (groups.every((g) => /^(19|20)\d\d$/.test(g))) return m
    if (groups.join('').length >= 8) return PLACEHOLDER.licence
    return m.replace(/\d{6,}/g, PLACEHOLDER.licence)
  })
}

export function buildAnonymizer({ players, keep = [] }: AnonymizerInput): Anonymizer {
  const firstCount = new Map<string, number>()
  const lastCount = new Map<string, number>()
  const add = (m: Map<string, number>, full?: string) => {
    for (const t of nameKey(full ?? '').split(' ')) if (t.length >= 2 && /^[a-z]+$/.test(t)) m.set(t, (m.get(t) ?? 0) + 1)
  }
  for (const p of players) {
    add(firstCount, p.firstName)
    add(lastCount, p.lastName)
  }
  const keepSet = new Set<string>()
  for (const k of keep) for (const t of nameKey(k).split(' ')) if (t) keepSet.add(t)

  const tierOf = (k: string): Tier => (SMALL.has(k) ? 'small' : VOCAB.has(k) || keepSet.has(k) ? 'vocab' : COMMON.has(k) ? 'common' : 'none')
  const isName = (k: string) => k.length >= 2 && (firstCount.has(k) || lastCount.has(k))
  const labelOf = (k: string): 'first' | 'last' => ((firstCount.get(k) ?? 0) > (lastCount.get(k) ?? 0) ? 'first' : 'last')

  /** Texte libre (phrase, « pas pris en compte », message d'erreur, contenu d'un texte SQL). */
  function text(s: string): string {
    if (!s) return s
    // Mots (chaînes de lettres reliées par des traits d'union) et séparateurs.
    const re = /[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*/gu
    type Tok = { start: number; end: number; raw: string; name: boolean; strong: boolean; weakTier: Tier; cap: boolean; sentenceStart: boolean; label: 'first' | 'last' }
    const toks: Tok[] = []
    let m: RegExpExecArray | null
    let lastEnd = 0
    while ((m = re.exec(s))) {
      const raw = m[0]
      const between = s.slice(lastEnd, m.index)
      const sentenceStart = toks.length === 0 || /[.!?]\s*$/.test(between)
      const parts = raw.split('-').map(keyOf)
      const allNames = parts.every((k) => isName(k) && tierOf(k) !== 'small')
      const tiers = parts.map(tierOf)
      const strong = allNames && tiers.some((t) => t === 'none')
      // Chaîne entièrement faite de mots courants (niveau 2 ou 3) qui sont aussi des noms : le niveau le plus prudent.
      const weakTier: Tier = !allNames || strong ? 'none' : tiers.includes('vocab') ? 'vocab' : 'common'
      toks.push({
        start: m.index,
        end: m.index + raw.length,
        raw,
        name: strong,
        strong,
        weakTier,
        cap: /^\p{Lu}/u.test(raw),
        sentenceStart,
        label: parts.every((k) => labelOf(k) === 'first') ? 'first' : 'last',
      })
      lastEnd = m.index + raw.length
    }
    // Niveau 3 : majuscule hors début de phrase.
    for (const t of toks) if (t.weakTier === 'common' && t.cap && !t.sentenceStart) t.name = true
    // Deux mots courants qui sont des noms, collés et tous deux avec une majuscule, dont un du niveau 3 (« Marin Pivot ») :
    // un nom complet.
    toks.forEach((t, i) => {
      const o = toks[i + 1]
      if (!o || t.weakTier === 'none' || o.weakTier === 'none' || !t.cap || !o.cap || !/^\s+$/.test(s.slice(t.end, o.start))) return
      if (t.weakTier === 'common' || o.weakTier === 'common') t.name = o.name = true
    })
    // Collé à un nom reconnu (seulement des espaces entre les deux) : niveaux 2 et 3 deviennent des noms.
    for (let changed = true; changed; ) {
      changed = false
      toks.forEach((t, i) => {
        if (t.name || t.weakTier === 'none') return
        const near = (j: number) => {
          const o = toks[j]
          if (!o?.name) return false
          const gap = j < i ? s.slice(o.end, t.start) : s.slice(t.end, o.start)
          return /^\s+$/.test(gap)
        }
        if (near(i - 1) || near(i + 1)) {
          t.name = true
          changed = true
        }
      })
    }
    let out = ''
    let at = 0
    for (const t of toks) {
      if (!t.name) continue
      out += s.slice(at, t.start) + PLACEHOLDER[t.label]
      at = t.end
    }
    out += s.slice(at)
    return maskLicences(out)
  }

  /** Requête SQL : textes, identifiants entre guillemets et commentaires relus ; licences partout. */
  function sql(q: string): string {
    if (!q) return q
    const re = /'(?:[^']|'')*'?|"(?:[^"]|"")*"?|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g
    let out = ''
    let code = '' // code déjà lu, textes remplacés par « ? » (pour reconnaître « prenom = »)
    let at = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(q))) {
      const before = q.slice(at, m.index)
      out += maskLicences(before)
      code += before
      const tok = m[0]
      if (tok.startsWith("'")) {
        const closed = tok.length > 1 && tok.endsWith("'")
        const inner = tok.slice(1, closed ? -1 : undefined)
        const col = /\b(prenom|nom|first_?name|last_?name)\b\s*\)*\s*(?:collate\s+nocase\s*)?(?:=|==|<>|!=|\blike\b|\bglob\b|\bin\s*\((?:\s*\?\s*,)*)\s*(?:(?:lower|upper|sans_accents)\s*\(\s*)?$/i.exec(code)
        const forced = col ? (/^(prenom|first_?name)$/i.test(col[1]) ? PLACEHOLDER.first : PLACEHOLDER.last) : null
        const body = forced ? inner.replace(/[\p{L}\p{M}][\p{L}\p{M}'’\- ]*[\p{L}\p{M}]|[\p{L}\p{M}]/gu, forced) : text(inner)
        out += `'${maskLicences(body)}${closed ? "'" : ''}`
        code += '?'
      } else if (tok.startsWith('"')) {
        out += text(tok)
        code += '"x"'
      } else {
        out += text(tok)
        code += ' '
      }
      at = m.index + tok.length
    }
    out += maskLicences(q.slice(at))
    return out
  }

  return { text, sql }
}

// ---------- Regroupement des phrases semblables ----------

/** Clé de regroupement : sans accents ni majuscules, sans petits mots, nombres remplacés par #, pluriels simples retirés. */
export function similarKey(phrase: string): string {
  return nameKey(phrase)
    .replace(/[^a-z0-9[\] ]+/g, ' ')
    .replace(/\d+/g, '#')
    .split(' ')
    .filter((w) => w && !SMALL.has(w))
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w))
    .join(' ')
}

export interface QuestionGroup<T extends QuestionLogRow = QuestionLogRow> {
  key: string
  /** Entrées, la plus récente d'abord. */
  entries: T[]
  /** Formulations distinctes, la plus fréquente d'abord. */
  phrases: { phrase: string; count: number }[]
  /** Toutes « transformées en recette ». */
  done: boolean
  last: string
}

/** Regroupe les entrées (non supprimées) par phrase semblable ; groupes les plus récents d'abord. */
export function groupEntries<T extends QuestionLogRow>(rows: T[]): QuestionGroup<T>[] {
  const by = new Map<string, T[]>()
  for (const r of rows) {
    if (r.deleted) continue
    const k = similarKey(r.phrase) || r.phrase
    by.set(k, [...(by.get(k) ?? []), r])
  }
  const groups: QuestionGroup<T>[] = []
  for (const [key, list] of by) {
    const entries = [...list].sort((a, b) => b.at.localeCompare(a.at))
    const counts = new Map<string, number>()
    for (const e of entries) counts.set(e.phrase, (counts.get(e.phrase) ?? 0) + 1)
    groups.push({
      key,
      entries,
      phrases: [...counts].map(([phrase, count]) => ({ phrase, count })).sort((a, b) => b.count - a.count),
      done: entries.every((e) => e.recipeDone),
      last: entries[0].at,
    })
  }
  return groups.sort((a, b) => b.last.localeCompare(a.last))
}

// ---------- « Copier pour Claude » ----------

const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))]

/**
 * Texte Markdown compact des entrées À TRAITER (ni supprimées, ni transformées en recette), groupées par phrase semblable :
 * formulations et compteurs, ce que la recette n'a pas su faire, statuts, dernière requête (et sa correction). Rien d'autre.
 */
export function copyForClaude(rows: QuestionLogRow[], today = new Date().toISOString().slice(0, 10)): string {
  const todo = rows.filter((r) => !r.deleted && !r.recipeDone)
  const groups = groupEntries(todo)
  const out = [
    `# HandBase : questions passées en mode avancé (à transformer en recettes)`,
    `${todo.length} question${todo.length > 1 ? 's' : ''}, ${groups.length} forme${groups.length > 1 ? 's' : ''} différente${groups.length > 1 ? 's' : ''} · relevé du ${today}.`,
    `Phrases et requêtes anonymisées ([prénom], [nom], [licence]) ; aucun résultat ni donnée de joueur.`,
  ]
  if (!groups.length) return [...out, '', 'Rien à traiter.'].join('\n')
  groups.forEach((g, i) => {
    out.push('', `## ${i + 1}. « ${g.phrases[0].phrase} » ×${g.entries.length}`)
    if (g.phrases.length > 1) out.push(`- Autres formulations : ${g.phrases.slice(1).map((p) => `« ${p.phrase} »${p.count > 1 ? ` ×${p.count}` : ''}`).join(' ; ')}`)
    const recipe = uniq(g.entries.flatMap((e) => e.recipeMissing ?? []))
    if (recipe.length) out.push(`- Pas pris en compte par la recette : ${recipe.join(' ; ')}`)
    const model = uniq(g.entries.flatMap((e) => e.modelMissing ?? []))
    if (model.length) out.push(`- Pas géré en mode avancé : ${model.join(' ; ')}`)
    const st = new Map<QuestionStatus, number>()
    for (const e of g.entries) st.set(e.status, (st.get(e.status) ?? 0) + 1)
    out.push(`- Statut : ${[...st].map(([s, n]) => `${STATUS_LABEL[s] ?? s}${n > 1 ? ` ×${n}` : ''}`).join(', ')}`)
    const ref = g.entries.find((e) => e.status === 'ok') ?? g.entries[0]
    const facts = [ref.display && `affichage ${ref.display}`, ref.rows !== undefined && `${ref.rows} ligne${ref.rows > 1 ? 's' : ''}`].filter(Boolean)
    if (facts.length) out.push(`- ${ref.status === 'ok' ? 'Réponse' : 'Dernier essai'} : ${facts.join(', ')}`)
    const details = uniq(g.entries.filter((e) => e.status !== 'ok').map((e) => e.detail))
    if (details.length) out.push(`- Erreur : ${details.slice(0, 3).join(' ; ')}`)
    const finalSql = ref.sqlRetry || ref.sql
    if (finalSql) {
      if (ref.sqlRetry && ref.sql) out.push('- Requête (1er essai, refusée ou en erreur) :', '```sql', ref.sql.trim(), '```', '- Requête corrigée :')
      else out.push('- Requête :')
      out.push('```sql', finalSql.trim(), '```')
    }
  })
  return out.join('\n')
}
