// Nextar, serveur MCP : nextar_joueur, HISTORIQUE D'UN JOUEUR désigné par son code J-…, en fonction PURE (Source aux droits du
// compte : périmètre du coach par les règles de lecture, tout pour un administrateur).
//
// Sortie EN CODES, comme nextar_lire : profil (code, sexe, année et trimestre de naissance, département, poste), mesures par
// test en série datée [{ valeur, date, evenement }] avec l'évolution (première → dernière valeur, écart, nombre de points),
// « vus » (événement : libellé, date, type), avis dans le temps (moyenne par événement — ou par jour hors événement — et par
// critère : notes chiffrées seulement). JAMAIS un nom, un club, un commentaire, l'auteur d'un avis ni la date de naissance
// complète (la Source ne la rend pas : année et trimestre seulement).
// Code inconnu, mal recopié, hors périmètre : la même réponse (« introuvable dans ton périmètre »), sans rien dire de plus.
// Code partagé par deux fiches : refus, sans choisir. Fiche fondue ou hors cadre : dit comme tel, sans historique.
// Événement d'une mesure : celui du même jour où le joueur est inscrit (même règle que adminTraces.ts, evenementsDe).

import { codeJoueur, codeValide, indexCodes, normaliserCode } from './partage/codesJoueurs.ts'
import { BORNES, clip, critere, isDate, num, type AvisSrv, type CritereSrv, type DeptsJoueurs, type EvenementSrv, type Reglages, type Source } from './outils.ts'

export interface JoueurInput {
  code?: string
  /** Tests à rendre (identifiants ou libellés de nextar_contexte), ou « toutes » (défaut). */
  tests?: string[] | 'toutes'
  /** Période (AAAA-MM-JJ, bornes comprises) des mesures, avis et « vus ». */
  depuis?: string
  jusqu_a?: string
}

export const INTROUVABLE = 'Code introuvable dans ton périmètre (inconnu, mal recopié, ou joueur que ton compte ne voit pas). Les codes viennent de nextar_lire.'
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const CONTEXTES: Record<string, string> = { unss: 'UNSS', club: 'club', match: 'match', selection: 'sélection', video: 'vidéo', autre: 'autre' }

export async function outilJoueur(src: Source, reg: Reglages, input: JoueurInput = {}) {
  void reg
  const c = normaliserCode(String(input.code ?? ''))
  if (!c) return { erreur: 'Donne le code du joueur (« J- » puis 7 signes), tel que rendu par nextar_lire.' }
  if (!codeValide(c)) return { erreur: `${INTROUVABLE} Le signe de contrôle de « ${c} » est faux : vérifie la recopie.` }
  if ((input.depuis && !isDate(input.depuis)) || (input.jusqu_a && !isDate(input.jusqu_a))) return { erreur: 'depuis / jusqu_a : dates AAAA-MM-JJ.' }
  if (input.depuis && input.jusqu_a && input.depuis > input.jusqu_a) return { erreur: 'La période commence après sa fin.' }
  // Retrouver la fiche parmi celles que le compte voit (ses droits : rien d'autre n'est lu).
  const lu = await src.fichesVisibles(BORNES.fichesCodes)
  const candidats = indexCodes(lu.fiches.map((f) => f.id)).get(c) ?? []
  if (!candidats.length) return { erreur: INTROUVABLE, ...(lu.tronque ? { avertissements: [`Plus de ${BORNES.fichesCodes} fiches visibles : la recherche du code est partielle.`] } : {}) }
  if (candidats.length > 1) return { erreur: `Le code ${c} est partagé par ${candidats.length} fiches : impossible de choisir sans risque. Ouvre la fiche dans l’appli.`, code_partage: true }
  const id = candidats[0]
  const fiche = lu.fiches.find((f) => f.id === id)!
  if (fiche.fondue) return { erreur: `La fiche ${c} a été fondue dans une autre : demande son nouveau code à nextar_lire.` }
  if (fiche.horsCadre) return { erreur: `La fiche ${c} est hors cadre : pas d’historique rendu.` }
  const p = await src.joueur(id)
  if (!p) return { erreur: INTROUVABLE }
  const depts: DeptsJoueurs = new Map([[id, p.dept]])
  const dans = (d?: string) => !!d && (!input.depuis || d >= input.depuis) && (!input.jusqu_a || d.slice(0, 10) <= input.jusqu_a)
  const [crits, ms, av, vs, evs] = await Promise.all([src.criteres(), src.mesures([id], depts), src.avis([id], depts), src.vus([id], depts), src.evenements({ archives: true })])
  // Événements cités (avis, vus) et absents de la liste : lus par identifiant.
  const connus = new Map<string, EvenementSrv>(evs.map((e) => [e.id, e]))
  const manquants = [...new Set([...av.map((a) => a.eventId), ...vs.map((v) => v.eventId)].filter((x): x is string => !!x && !connus.has(x)))].slice(0, 500)
  if (manquants.length) for (const e of await src.evenementsParIds(manquants)) connus.set(e.id, e)
  const libelleEv = (e?: EvenementSrv) => (e ? clip(e.name, 120) || 'Événement' : undefined)
  const avertissements: string[] = []

  // Mesures : série datée par test (la plus ancienne d'abord), événement du même jour où il est inscrit.
  const vivants = crits.filter((x) => !x.deleted)
  const tests = vivants.filter((x) => (x.kind ?? 'factual') === 'factual')
  let voulus: CritereSrv[] | null = null
  if (Array.isArray(input.tests) && input.tests.length) {
    voulus = []
    for (const r of input.tests) {
      const t = critere(r, tests)
      if (!t) avertissements.push(`Test inconnu ignoré : « ${clip(r, 80)} ».`)
      else voulus.push(t)
    }
  }
  const parTest = new Map<string, { valeur: number | string; date: string; evenement?: string }[]>()
  for (const m of ms) {
    if (m.playerId !== id || !dans(m.date)) continue
    if (voulus && !voulus.some((t) => t.id === m.criterionId)) continue
    const ev = [...connus.values()].find((e) => e.date === m.date && (e.playerIds ?? []).includes(id))
    parTest.set(m.criterionId, [...(parTest.get(m.criterionId) ?? []), { valeur: typeof m.value === 'string' ? clip(m.value, 60) : m.value, date: m.date, ...(ev ? { evenement: libelleEv(ev) } : {}) }])
  }
  const ordreTest = (cid: string) => tests.find((t) => t.id === cid)?.order ?? 999
  const mesures = [...parTest]
    .sort((a, b) => ordreTest(a[0]) - ordreTest(b[0]) || a[0].localeCompare(b[0]))
    .map(([cid, pts]) => {
      const t = vivants.find((x) => x.id === cid)
      const serie = [...pts].sort((a, b) => a.date.localeCompare(b.date))
      const coupe = serie.length > BORNES.serieMax
      const rendue = coupe ? serie.slice(-BORNES.serieMax) : serie
      const premiere = serie[0]
      const derniere = serie[serie.length - 1]
      const a = num(premiere.valeur)
      const b = num(derniere.valeur)
      return {
        test_id: cid,
        libelle: clip(t ? (t.unit ? `${t.label} (${t.unit})` : t.label) : cid, 120),
        ...(t?.unit ? { unite: clip(t.unit, 20) } : {}),
        serie: rendue,
        evolution: {
          premiere: premiere.valeur,
          derniere: derniere.valeur,
          ...(Number.isFinite(a) && Number.isFinite(b) ? { ecart: round(b - a, 3) } : {}),
          nb_points: serie.length,
          premiere_date: premiere.date,
          derniere_date: derniere.date,
        },
        ...(coupe ? { tronque: true } : {}),
      }
    })

  // « Vus » : un par événement (le plus récent d'abord).
  const vusEv = [...new Set(vs.filter((v) => v.playerId === id).map((v) => v.eventId))]
    .map((eid) => connus.get(eid))
    .filter((e): e is EvenementSrv => !!e && ((!input.depuis && !input.jusqu_a) || dans(e.date)))
    .sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''))
  const vus = vusEv.slice(0, BORNES.vusMax).map((e) => ({ libelle: libelleEv(e)!, ...(e.date ? { date: e.date } : {}), ...(e.type ? { type: e.type } : {}) }))

  // Avis : moyenne par événement (hors événement : par jour et contexte) et par critère ; notes chiffrées seulement.
  const avisCrits = vivants.filter((x) => x.kind === 'subjective')
  const score5 = new Set(avisCrits.filter((x) => (x.scale ?? 'score5') === 'score5').map((x) => x.id))
  type Groupe = { ev?: EvenementSrv; contexte?: string; dates: string[]; nb: number; toutes: number[]; par: Map<string, number[]> }
  const groupes = new Map<string, Groupe>()
  for (const a of av as AvisSrv[]) {
    if (a.playerId !== id || !dans(a.date)) continue
    const ev = a.eventId ? connus.get(a.eventId) : undefined
    const k = a.eventId ? `e:${a.eventId}` : `j:${a.date ?? ''}:${a.contexte ?? ''}`
    const g: Groupe = groupes.get(k) ?? { ev, contexte: a.eventId ? undefined : a.contexte, dates: [], nb: 0, toutes: [], par: new Map() }
    g.nb++
    if (a.date) g.dates.push(a.date)
    for (const [cid, v] of Object.entries(a.scores ?? {})) {
      const n = num(v)
      if (!Number.isFinite(n) || !avisCrits.some((x) => x.id === cid)) continue
      g.par.set(cid, [...(g.par.get(cid) ?? []), n])
      if (score5.has(cid)) g.toutes.push(n)
    }
    groupes.set(k, g)
  }
  const moy = (xs: number[]) => round(xs.reduce((s, x) => s + x, 0) / xs.length)
  const avisTous = [...groupes.values()]
    .map((g) => ({ g, date: g.ev?.date ?? [...g.dates].sort()[0] ?? '' }))
    .sort((x, y) => x.date.localeCompare(y.date))
  const avis = avisTous.slice(-BORNES.avisGroupesMax).map(({ g, date }) => {
    const criteres: Record<string, number> = {}
    for (const [cid, xs] of g.par) criteres[cid] = moy(xs)
    return {
      ...(date ? { date } : {}),
      ...(g.ev ? { evenement: libelleEv(g.ev) } : { hors_evenement: true, ...(g.contexte && CONTEXTES[g.contexte] ? { contexte_avis: CONTEXTES[g.contexte] } : {}) }),
      nb: g.nb,
      ...(g.toutes.length ? { moyenne: moy(g.toutes) } : {}),
      ...(Object.keys(criteres).length ? { criteres } : {}),
    }
  })
  const legende: Record<string, string> = {}
  for (const x of avisCrits) if (avis.some((a) => a.criteres && x.id in a.criteres)) legende[x.id] = clip(x.label, 120)

  const code = codeJoueur(id)
  return {
    code,
    profil: {
      code,
      ...(p.sexe ? { sexe: p.sexe } : {}),
      ...(p.annee ? { annee: p.annee } : {}),
      ...(p.trimestre ? { trimestre: p.trimestre } : {}),
      ...(p.dept ? { departement: p.dept } : {}),
      ...(p.poste ? { poste: p.poste } : {}),
    },
    ...(input.depuis || input.jusqu_a ? { periode: { ...(input.depuis ? { depuis: input.depuis } : {}), ...(input.jusqu_a ? { jusqu_a: input.jusqu_a } : {}) } } : {}),
    mesures,
    vus,
    avis,
    ...(Object.keys(legende).length ? { legende } : {}),
    avertissements: [
      ...avertissements,
      ...(vusEv.length > vus.length ? [`${vusEv.length} événements « vus » : les ${BORNES.vusMax} plus récents sont rendus.`] : []),
      ...(avisTous.length > avis.length ? [`${avisTous.length} groupes d’avis : les ${BORNES.avisGroupesMax} plus récents sont rendus.`] : []),
      'Mesures : série datée par test (la plus ancienne d’abord), événement du même jour où le joueur est inscrit ; évolution = première → dernière valeur. Avis : moyenne par événement (hors événement : par jour) et par critère, notes de 1 à 5 pour la moyenne ; jamais un commentaire ni un auteur. Trimestre de naissance : 1 (janvier-mars) à 4 (octobre-décembre).',
    ],
  }
}
