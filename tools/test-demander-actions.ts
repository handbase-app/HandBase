// Test des actions de « Demander » (src/askAction.ts, partie pure de la carte de validation src/components/AskAction.tsx) :
//  1. règles locales (sans IA) : actions reconnues, actions interdites, phrases qui restent des filtres ;
//  2. rapprochement des noms sur l'appareil : « Steve Bacher » → « Stef bascher », « Détection VAR 2013 » → « Détection
//     test var 2013 » (à confirmer), nom trop éloigné → rien ; créateurs des listes Groupes et Événements (confirmation) ;
//  3. plan rendu par le modèle : accepté seulement s'il est valable ; plan illisible, action inconnue ou interdite rejetés ;
//  4. carte : étapes, plus de 200 joueurs, aucun joueur, droits manquants, déjà dedans ; groupe créé ; journal sans nom ;
//  5. parcours complet sur un jeu fictif (recette relue, joueurs calculés sur l'appareil) ;
//  6. exemples des consignes du mode « action » (supabase/functions/transcrire/index.ts) acceptés par l'appli ;
//  7. confidentialité : seuls la phrase, le schéma et la page partent au mode « action ».
// Jeu fictif : aucun nom réel.
//
//   npx jiti tools/test-demander-actions.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  actionDetail,
  BIG,
  buildCard,
  detectAction,
  groupNameFrom,
  matchName,
  nameScore,
  newGroupFields,
  parsePlan,
  type AskPlan,
  type CardInput,
} from '../src/askAction'
import { matchPerson } from '../src/listQuery'
import { readGroupsRecipe } from '../src/groupQuery'
import { readEventsRecipe } from '../src/eventQuery'
import { buildIndex, buildQuestionSchema, interpretRecipe, recipeChips, type QCriterion, type QPlayer, type QuestionContext, type Names } from '../src/recipe'
import { listRecipe, selectPlayers } from '../src/playerQuery'
import { understandAction, type Endpoint } from '../src/dictation/transcribe'

const plan = (p: string, page?: string) => {
  const d = detectAction(p, page)
  assert.ok(d && d.kind === 'plan', `action locale attendue : ${p} → ${JSON.stringify(d)}`)
  return d.plan
}

// ---------- 1. Règles locales ----------
{
  let p = plan("Trouve-moi tous les gauchers du Var de plus d'1,80 m et crée-moi un groupe avec")
  assert.equal(p.action, 'creer_groupe')
  assert.equal(p.playersPhrase, "tous les gauchers du Var de plus d'1,80 m")
  p = plan('Crée un groupe avec les gauchers de 2011')
  assert.deepEqual([p.action, p.playersPhrase, p.name], ['creer_groupe', 'les gauchers de 2011', undefined])
  p = plan('crée-moi un groupe appelé « Gauchers 2011 » avec les gauchers de 2011')
  assert.equal(p.name, 'Gauchers 2011')
  p = plan('Ajoute les 2011 du Var au groupe Pôle Fictif')
  assert.deepEqual([p.action, p.target, p.playersPhrase], ['ajouter_groupe', 'Pôle Fictif', 'les 2011 du Var'])
  p = plan('mets les gardiennes du Var dans le tournoi de Fictiville')
  assert.deepEqual([p.action, p.target], ['ajouter_evenement', 'tournoi de Fictiville'])
  p = plan('trouve les gauchers et ajoute-les au groupe Intercomités')
  assert.deepEqual([p.action, p.target, p.playersPhrase], ['ajouter_groupe', 'Intercomités', 'les gauchers'])
  // Cas B (page Événements) : ouvrir l'événement et y filtrer les joueurs.
  p = plan('Donne-moi la liste des gauchers dans l’événement Détection VAR 2013.', 'evenements')
  assert.deepEqual([p.action, p.target, p.playersPhrase], ['ouvrir_evenement', 'Détection VAR 2013', 'les gauchers'])
  p = plan('les gardiennes du groupe Pôle Fictif')
  assert.deepEqual([p.action, p.target, p.playersPhrase], ['ouvrir_groupe', 'Pôle Fictif', 'les gardiennes'])
  // Cas A (page Groupes) : filtre par créateur, fait par la liste.
  p = plan('Montre-moi tous les groupes que Steve Bacher a créés.', 'groupes')
  assert.deepEqual([p.action, p.creators, p.list], ['filtrer_createur', ['Steve Bacher'], 'groupes'])
  assert.deepEqual(plan('les événements créés par Paul').list, 'evenements')
  // Actions interdites : refusées sans appel.
  for (const t of ['supprime le groupe Pôle Fictif', 'retire les gauchers du groupe Intercomités', 'modifie la fiche de Martin', 'crée un compte pour Paul', 'change le rôle de Paul', 'vide l’événement Stage de rentrée'])
    assert.deepEqual(detectAction(t), { kind: 'interdite' }, t)
  // Ce qui reste un filtre ou une commande de liste (comme avant).
  for (const t of ['les gauchers de 2011', 'enlève la taille', 'efface tout et montre les groupes que je suis', 'les groupes que j’ai créés', 'les joueurs vus au tournoi de Cannes', 'les joueurs du tournoi de Fictiville', 'les tournois du groupe X', 'ajoute ceux vus au tournoi de Cannes', 'fais un événement avec les 2011 du Var', 'combien de gauchers dans le Var ?', 'retire le filtre de l’événement'])
    assert.equal(detectAction(t), null, t)
  // Liste Joueurs : « les gauchers dans l'événement X » reste un filtre de la liste (recette « evenements »).
  assert.equal(detectAction('les gauchers dans l’événement Stage de rentrée', 'joueurs'), null)
  // Tournure d'action que les règles ne lisent pas : le modèle décide.
  assert.deepEqual(detectAction('peux-tu me faire un nouveau groupe rapidement avec mes coups de cœur'), { kind: 'modele' })
}

// ---------- 2. Rapprochement des noms ----------
{
  const people = [{ name: 'Stef bascher' }, { name: 'Paul Fictif' }, { name: 'Anne Exemple' }]
  const m = matchName('Steve Bacher', people)
  assert.equal(m.kind, 'approx')
  assert.equal(m.kind === 'approx' && m.best.name, 'Stef bascher')
  assert.ok(nameScore('Steve Bacher', 'Stef bascher') >= 0.72)
  const events = [
    { id: 'e1', name: 'Détection test var 2013', date: '2026-10-01' },
    { id: 'e2', name: 'Détection test var 2012', date: '2026-09-01' },
    { id: 'e3', name: 'Stage de rentrée', date: '2026-08-28' },
  ]
  const e = matchName('Détection VAR 2013', events)
  assert.equal(e.kind, 'approx', 'nom pas exact : à confirmer')
  assert.equal(e.kind === 'approx' && e.best.id, 'e1')
  assert.ok(e.kind === 'approx' && !e.choices.some((x) => x.id === 'e2'), 'une autre année n’est pas proposée')
  // Nom exact (accents et majuscules près) : appliqué sans question.
  assert.deepEqual(matchName('detection TEST var 2013', events), { kind: 'exact', item: events[0] })
  assert.deepEqual(matchName('le stage de rentrée', events), { kind: 'exact', item: events[2] })
  // Trop éloigné : aucune proposition.
  assert.deepEqual(matchName('Tournoi de Lyon', events), { kind: 'none' })
  assert.deepEqual(matchName('Zorglub Quintal', people), { kind: 'none' })
  assert.deepEqual(matchName('', people), { kind: 'none' })
  // Même nom chaque année : à choisir, le plus récent d'abord.
  const same = [{ id: 'a', name: 'Tournoi de Cannes', date: '2025-11-02' }, { id: 'b', name: 'Tournoi de Cannes', date: '2026-10-04' }]
  const s = matchName('tournoi de Cannes', same)
  assert.ok(s.kind === 'approx' && s.best.id === 'b' && s.choices.length === 2)
  // Créateurs des listes : comme avant d'abord (« Paul » → « Paul Fictif »), sinon nom approchant à confirmer.
  const names = people.map((p) => p.name)
  assert.deepEqual(matchPerson('Paul', names), { found: 'Paul Fictif' })
  assert.deepEqual(matchPerson('Steve Bacher', names), { confirm: ['Stef bascher'] })
  assert.deepEqual(matchPerson('Zorglub', names), { none: true })
  const geo = { regions: [], depts: [] }
  const gr = readGroupsRecipe({ createurs: ['Steve Bacher'] }, [], { today: '2026-10-20', names: [], creators: names, geo })
  assert.deepEqual(gr.f, {}, 'rien n’est appliqué avant la confirmation')
  assert.deepEqual(gr.confirm, [{ key: 'creators', said: 'Steve Bacher', choices: ['Stef bascher'] }])
  const er = readEventsRecipe({ createurs: ['Steve Bacher'] }, [], { today: '2026-10-20', names: [], places: [], creators: names, geo })
  assert.equal(er.confirm?.[0].choices[0], 'Stef bascher')
  assert.deepEqual(readGroupsRecipe({ createurs: ['Anne'] }, [], { today: '2026-10-20', names: [], creators: names, geo }).f, { creators: ['Anne Exemple'] })
}

// ---------- 3. Plan rendu par le modèle ----------
{
  const ok = parsePlan({ action: 'creer_groupe', nom: 'Gauchers Var 1,80 m+', joueurs: { population: { lateralite: 'gaucher' }, sortie: { type: 'nombre' } }, inconnu: 1, nonGere: [] })
  assert.ok(ok.ok)
  assert.deepEqual(ok.ok && ok.plan, { action: 'creer_groupe', name: 'Gauchers Var 1,80 m+', players: { population: { lateralite: 'gaucher' } }, nonGere: [] })
  // Plans invalides : rejetés.
  for (const bad of [null, 'creer_groupe', [], {}, { action: 42 }, { action: '' }]) assert.equal(parsePlan(bad).ok, false, JSON.stringify(bad))
  const r = (v: unknown) => {
    const c = parsePlan(v)
    return c.ok ? 'ok' : c.reason
  }
  assert.equal(r({ action: 'creer_evenement' }), 'inconnue')
  assert.equal(r({ action: 'envoyer_courriel' }), 'interdite')
  // Actions interdites : rejetées, quel que soit le reste.
  for (const a of ['supprimer', 'supprimer_groupe', 'retirer_joueurs', 'modifier_fiche', 'interdite', 'creer_compte', 'changer_role', 'vider_evenement']) assert.equal(r({ action: a, cible: 'Pôle Fictif' }), 'interdite', a)
  assert.equal(r({ action: 'aucune' }), 'aucune')
  // Cible manquante.
  assert.equal(r({ action: 'ajouter_groupe', joueurs: {} }), 'cible_absente')
  assert.equal(r({ action: 'filtrer_createur', liste: 'groupes' }), 'cible_absente')
  // Trop gros : rejeté.
  assert.equal(r({ action: 'creer_groupe', joueurs: { population: { noms: ['x'.repeat(9000)] } } }), 'illisible')
  // Textes bornés et nettoyés ; « nom » seulement pour un groupe à créer ; la cible n'est pas un critère.
  const t = parsePlan({ action: 'ajouter_groupe', cible: 'Pôle\u0000 Fictif ' + 'x'.repeat(200), nom: 'X', joueurs: { population: { groupes: ['Pôle Fictif'], annee: 2011 } } })
  assert.ok(t.ok && !t.plan.name && t.plan.target!.length === 80 && !t.plan.target!.includes('\u0000'))
  const u = parsePlan({ action: 'ajouter_groupe', cible: 'Pôle Fictif', joueurs: { population: { groupes: ['Pôle Fictif'], annee: 2011 } } })
  assert.deepEqual(u.ok && u.plan.players, { population: { annee: 2011 } })
  const v = parsePlan({ plan: { action: 'filtrer_createur', createurs: 'Paul', liste: 'événements' } })
  assert.deepEqual(v.ok && [v.plan.creators, v.plan.list], [['Paul'], 'evenements'])
}

// ---------- 4. Carte ----------
{
  const p = (action: AskPlan['action'], extra: Partial<AskPlan> = {}): AskPlan => ({ action, nonGere: [], ...extra })
  const base: CardInput = { plan: p('creer_groupe'), criteria: ['gauchers', 'Var (83)', 'taille ≥ 180 cm'], count: 23, groupName: 'Gauchers Var 1,80 m+', allowed: true }
  let c = buildCard(base)
  assert.deepEqual(c.steps, ['Chercher : gauchers · Var (83) · taille ≥ 180 cm → 23 joueurs', 'Créer le groupe « Gauchers Var 1,80 m+ » avec ces 23 joueurs (visible par moi seul, modifiable ensuite)'])
  assert.ok(c.canAccept && !c.warnings.length)
  assert.equal(buildCard({ ...base, gender: 'F' }).steps[0], 'Chercher : gauchers · Var (83) · taille ≥ 180 cm → 23 joueuses')
  // Plus de 200 joueurs : avertissement (Accepter reste proposé).
  c = buildCard({ ...base, count: BIG + 1 })
  assert.ok(c.canAccept && c.warnings.some((w) => /Plus de 200 joueurs/.test(w)))
  // Droits manquants : la carte le dit, pas d'« Accepter ».
  c = buildCard({ ...base, plan: p('ajouter_groupe', { target: 'Pôle Fictif' }), target: { name: 'Pôle Fictif' }, allowed: false, deniedWhy: 'Tu ne peux pas ajouter de joueurs à ce groupe (ni créateur ni participant).' })
  assert.equal(c.canAccept, false)
  assert.equal(c.blocked, 'Tu ne peux pas ajouter de joueurs à ce groupe (ni créateur ni participant).')
  assert.equal(buildCard({ ...base, allowed: false }).blocked, 'Ton rôle ne permet pas cette action.')
  // Rien à faire.
  assert.equal(buildCard({ ...base, count: 0 }).canAccept, false)
  assert.equal(buildCard({ ...base, noCriteria: true }).canAccept, false, 'aucun critère compris : jamais « tous les joueurs » d’office')
  assert.equal(buildCard({ ...base, groupName: '  ' }).canAccept, false)
  c = buildCard({ ...base, plan: p('ajouter_evenement', { target: 'Stage' }), target: { name: 'Stage de rentrée' }, already: 3 })
  assert.equal(c.steps[1], 'Ajouter ces 23 joueurs à l’événement « Stage de rentrée » (3 déjà dedans)')
  assert.equal(buildCard({ ...base, plan: p('ajouter_groupe', { target: 'X' }), target: { name: 'X' }, already: 23 }).canAccept, false)
  // Ouvrir avec un filtre : rien n'est écrit ; liste vide signalée.
  c = buildCard({ ...base, plan: p('ouvrir_evenement', { target: 'Détection VAR 2013' }), target: { name: 'Détection test var 2013' }, criteria: ['gauchers'], count: 3 })
  assert.deepEqual(c.steps, ['Chercher dans l’événement « Détection test var 2013 » : gauchers → 3 joueurs', 'Ouvrir l’événement et n’afficher que ces joueurs'])
  assert.ok(c.canAccept)
  assert.ok(buildCard({ ...base, plan: p('ouvrir_groupe', { target: 'X' }), target: { name: 'X' }, count: 0 }).warnings.some((w) => /liste sera vide/.test(w)))
  // Ce que la recette n'a pas pris en compte.
  assert.ok(buildCard({ ...base, unsupported: ['jouent en Nationale 2'] }).warnings.includes('Pas pris en compte : jouent en Nationale 2'))

  // Groupe créé : champs obligatoires déduits des joueurs.
  assert.deepEqual(newGroupFields([{ sex: 'M', year: '2011', dept: '83', region: 'r-sud' }, { sex: 'M', year: '2011', dept: '83', region: 'r-sud' }]), { sex: 'M', scope: 'comite', department: '83', regionId: 'r-sud', years: ['2011'] })
  assert.deepEqual(newGroupFields([{ sex: 'F', year: '2011', dept: '83', region: 'r-sud' }, { sex: 'M', year: '2012', dept: '13', region: 'r-sud' }]), { sex: 'mixte', scope: 'ligue', regionId: 'r-sud' })
  assert.deepEqual(newGroupFields([{ sex: 'F', dept: '83', region: 'r-sud' }, { sex: 'F', dept: '35', region: 'r-bre' }]), { sex: 'F', scope: 'federation' })
  assert.equal(groupNameFrom(['gauchers', 'Var (83)']), 'Gauchers · Var (83)')
  assert.equal(groupNameFrom([]), 'Nouveau groupe')
  assert.ok(groupNameFrom(['x'.repeat(100)]).length <= 60)
  // Journal : l'action, le nombre, ce qu'en a fait l'entraîneur ; jamais de nom.
  assert.equal(actionDetail('creer_groupe', 'acceptee', 23), 'Action proposée : créer un groupe · 23 joueurs · acceptée')
  assert.equal(actionDetail('ouvrir_evenement', 'annulee', 1), 'Action proposée : ouvrir un événement filtré · 1 joueur · annulée')
  assert.equal(actionDetail('interdite', 'refusee'), 'Action proposée : action interdite · refusée (interdite)')
}

// ---------- 5. Parcours complet sur un jeu fictif ----------
const TODAY = '2026-10-20'
const POSITIONS = [
  { id: 'GB' as const, label: 'Gardien' },
  { id: 'PIV' as const, label: 'Pivot' },
  { id: 'DC' as const, label: 'Demi-centre' },
]
const CRITERIA: QCriterion[] = [{ id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm' }]
const ctx: QuestionContext = {
  regions: [{ id: 'region-sud', name: 'Région Sud' }],
  depts: [
    { code: '83', name: 'Var' },
    { code: '13', name: 'Bouches-du-Rhône' },
  ],
  regionOfDept: () => 'region-sud',
  positions: POSITIONS,
  clubs: [],
  groups: [{ id: 'g1', name: 'Pôle Fictif' }],
  events: [{ id: 'e1', name: 'Détection test var 2013', date: '2026-10-01' }],
  criteria: CRITERIA,
  today: TODAY,
}
{
  type P = QPlayer & { dept: string }
  const mk = (id: string, laterality: 'gaucher' | 'droitier', dept: string, sex: 'M' | 'F' = 'M'): P => ({ id, firstName: `Prénom${id}`, lastName: `Fictif${id}`, birthDate: '2013-03-01', sex, club: 'Club fictif', laterality, dept })
  const players = [mk('1', 'gaucher', '83'), mk('2', 'gaucher', '83'), mk('3', 'droitier', '83'), mk('4', 'gaucher', '13'), mk('5', 'gaucher', '83')]
  const heights: Record<string, number> = { '1': 185, '2': 178, '3': 190, '4': 186, '5': 182 }
  const ix = buildIndex<P>({
    players,
    sights: [],
    evals: [],
    measures: Object.entries(heights).map(([playerId, value]) => ({ playerId, criterionId: 'taille', value, date: '2026-09-01' })),
    criteria: CRITERIA,
    groups: [{ id: 'g1', playerIds: ['1'] }],
    events: [{ id: 'e1', playerIds: ['1', '2', '3'] }],
    deptOf: (p) => p.dept,
    regionOf: () => 'region-sud',
    today: TODAY,
  })
  const names: Names = { region: () => 'Région Sud', dept: (c) => (c === '83' ? 'Var (83)' : c), club: (k) => k, group: () => 'groupe', event: () => 'événement', criterion: () => 'Taille', position: (x) => x, today: TODAY }
  // « Trouve-moi tous les gauchers du Var de plus d'1,80 m et crée-moi un groupe avec » : 2 joueurs, groupe proposé.
  const raw = { population: { lateralite: 'gaucher', departements: ['Var'], tailleMin: 180 } }
  const it = interpretRecipe(raw, [], ctx)
  assert.deepEqual([it.notes, it.unsupported], [[], []])
  const found = selectPlayers(ix, { recipe: listRecipe(it.recipe), q: '' }, (p) => p.lastName.toLowerCase(), () => []).list
  assert.deepEqual(found.map((p) => p.id).sort(), ['1', '5'])
  const chips = recipeChips(it.recipe, names).map((c) => c.label)
  const card = buildCard({ plan: { action: 'creer_groupe', nonGere: [] }, criteria: chips, count: found.length, groupName: groupNameFrom(chips), allowed: true })
  assert.ok(card.canAccept)
  assert.match(card.steps[0], /→ 2 joueurs$/)
  // Cas B : les gauchers de l'événement (retrouvé par son nom approchant) : seulement ceux de sa liste.
  const m = matchName('Détection VAR 2013', ctx.events)
  assert.ok(m.kind === 'approx' && m.best.id === 'e1')
  const r2 = listRecipe(interpretRecipe({ population: { lateralite: 'gaucher' } }, [], ctx).recipe)
  r2.pop.events = ['e1']
  assert.deepEqual(selectPlayers(ix, { recipe: r2, q: '' }, (p) => p.lastName, () => []).list.map((p) => p.id).sort(), ['1', '2'])
}

// ---------- 6. Exemples des consignes du mode « action » ----------
{
  const src = readFileSync(new URL('../supabase/functions/transcrire/index.ts', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('const CONSIGNES_ACTION'), src.indexOf('async function planAction'))
  const examples = [...block.matchAll(/^« (.+?) » → (\{.*\})$/gm)]
  assert.ok(examples.length >= 9, `exemples trouvés : ${examples.length}`)
  for (const [, phrase, json] of examples) {
    const raw = JSON.parse(json)
    const c = parsePlan(raw)
    if (raw.action === 'interdite') assert.ok(!c.ok && c.reason === 'interdite', phrase)
    else if (raw.action === 'aucune') assert.ok(!c.ok && c.reason === 'aucune', phrase)
    else {
      assert.ok(c.ok, `${phrase} : ${JSON.stringify(c)}`)
      if (c.plan.players) {
        const it = interpretRecipe(c.plan.players, c.plan.nonGere, { ...ctx, positions: [...POSITIONS, { id: 'ARG' as const, label: 'Arrière gauche' }] })
        assert.deepEqual(it.notes, [], `${phrase} : recette relue sans note`)
      }
      // Les règles locales lisent la même action (quand elles la reconnaissent).
      const d = detectAction(phrase, 'evenements')
      if (d?.kind === 'plan') assert.equal(d.plan.action, c.plan.action, phrase)
    }
  }
}

// ---------- 7. Confidentialité : ce qui part au mode « action » ----------
await (async () => {
  let sent = ''
  let url = ''
  const ep: Endpoint = {
    url: 'https://exemple.invalid/functions/v1/transcrire',
    headers: { Authorization: 'Bearer x' },
    fetch: (async (u: string, init: RequestInit) => {
      url = u
      sent = String(init.body)
      return new Response(JSON.stringify({ plan: { action: 'creer_groupe', joueurs: {} }, ms: 5 }), { status: 200 })
    }) as typeof fetch,
  }
  const schema = buildQuestionSchema({ ...ctx, regions: [], depts: [], clubs: [], groups: [], events: [] })
  const ans = await understandAction(ep, 'Crée un groupe avec les gauchers', schema, undefined, 'groupes')
  assert.ok(url.endsWith('?mode=action'))
  assert.deepEqual(Object.keys(JSON.parse(sent)).sort(), ['page', 'phrase', 'schema'])
  for (const secret of ['Pôle Fictif', 'Détection test var 2013', 'Stef bascher', 'Fictif1']) assert.ok(!sent.includes(secret), `rien de l’appareil ne part : ${secret}`)
  assert.deepEqual(ans.plan, { action: 'creer_groupe', joueurs: {} })
  // Erreur du serveur : message clair, jamais de plan.
  const bad: Endpoint = { ...ep, fetch: (async () => new Response(JSON.stringify({ error: 'mode_inconnu' }), { status: 400 })) as typeof fetch }
  await assert.rejects(understandAction(bad, 'crée un groupe', schema), (e: Error & { code?: string }) => e.code === 'mode_inconnu')
})()

console.log('test-demander-actions : OK')
