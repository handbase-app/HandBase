// Filet du catalogue des demandes (tools/catalogue-demandes.ts) : chaque phrase passe dans les règles locales de
// « Demander », sans IA ni réseau, comme dans l'appli (detectAction de src/askAction.ts ; depuis l'en-tête, routeAsk de
// src/demander.ts ; dans une liste, la phrase relue d'abord par correctQuestionPhrase de src/questionRescue.ts) :
//  - phrase classée « comprise en local » : lue, et JUSTE (action, cible, nom du groupe, partie « joueurs », étape suivante) ;
//  - phrase laissée au modèle : 'modele' (mode « action ») ou null (pas une action : mode « question » de la page) ;
//  - refus (supprimer, retirer, modifier, comptes) : 'interdite' ; action pas encore prévue : 'inconnue' (message local) ;
//  - question depuis l'en-tête : la bonne page (Joueurs, Événements, Groupes, Bilan, recherche d'un nom).
// La partie « joueurs » d'une action lue en local part ensuite au mode « question » (non testable ici).
// Couverture (tableau par classe, par personne, par type) : RAPPORT=1 npx jiti tools/test-catalogue-demandes.ts
// (RAPPORT=1 seul : n'échoue pas, affiche ; sans RAPPORT : vérifie tout).
//
//   npx jiti tools/test-catalogue-demandes.ts
import assert from 'node:assert/strict'
import { buildCard, detectAction, matchTarget, UNPLANNED_TEXT, type AskPlan, type Detected } from '../src/askAction'
import { routeAsk, type AskContext } from '../src/demander'
import { correctQuestionPhrase } from '../src/questionRescue'
import { applySportConfig, resolveSportConfig } from '../src/sportConfig'
import { ATTENDU_LABEL, CATALOGUE, normCat, PERSONA_LABEL, type Attendu, type Demande, type Persona, type Vers } from './catalogue-demandes'

const RAPPORT = !!process.env.RAPPORT

// Noms de l'appareil (fictifs) : pour les propositions « Ouvrir l'événement / le groupe » de l'en-tête.
const ctx: AskContext = {
  players: [
    { id: 'p1', name: 'Hugo Exemple' },
    { id: 'p2', name: 'Jade Fictive' },
    { id: 'p3', name: 'Léo Fictif' },
  ],
  events: [
    { id: 'e1', name: 'Intercomité de décembre' },
    { id: 'e2', name: 'Stage de Toussaint' },
    { id: 'e3', name: 'Tournoi de Fictiville' },
    { id: 'e4', name: 'Stage de février' },
  ],
  groups: [
    { id: 'g1', name: 'Intercomité 2011' },
    { id: 'g2', name: 'Pôle Fictiville' },
    { id: 'g3', name: 'Repérés 2011' },
    { id: 'g4', name: 'U15 Fictiville' },
  ],
}

export type Classe = 'local_juste' | 'non_prevue_dite' | 'refus_ok' | 'mistral_action' | 'mistral_question' | 'pas_vu' | 'travers' | 'refus_tort'
export const CLASSE_LABEL: Record<Classe, string> = {
  local_juste: 'compris en local, juste',
  non_prevue_dite: 'pas encore prévu, dit en local',
  refus_ok: 'refus correct',
  mistral_action: 'part chez Mistral (action)',
  mistral_question: 'part chez Mistral (question)',
  pas_vu: 'pas vu comme une action',
  travers: 'compris de TRAVERS',
  refus_tort: 'refus à tort',
}

/** Page de la première proposition de l'en-tête. */
function routeVers(phrase: string): Vers | undefined {
  const r = routeAsk(phrase, ctx).find((x) => x.kind !== 'action')
  if (!r) return undefined
  return r.kind === 'players' || r.kind === 'select'
    ? 'joueurs'
    : r.kind === 'events' || r.kind === 'open-event'
      ? 'evenements'
      : r.kind === 'groups' || r.kind === 'open-group'
        ? 'groupes'
        : r.kind === 'bilan'
          ? 'bilan'
          : 'nom'
}

type Sortie = 'local' | 'modele' | null | 'interdite' | 'inconnue'
const sortieOf = (d: Detected | null, q = false): Sortie =>
  // Question « les événements créés par Paul » depuis l'en-tête : filtre par créateur, routé comme une recherche.
  !d || (q && d.kind === 'plan' && d.plan.action === 'filtrer_createur') ? null : d.kind === 'plan' ? 'local' : (d.kind as Sortie)

/** Écarts entre le plan lu et la lecture juste (vide : juste). */
function ecarts(d: Demande, det: Detected | null): string[] {
  const l = d.lecture
  if (!l || !det || det.kind !== 'plan') return ['pas de plan local']
  // Champs ajoutés par les corrections (étape suivante, joueurs affichés) : lus sans les exiger du type.
  const p = det.plan as typeof det.plan & { then?: { action: string; target: string }; current?: boolean }
  const out: string[] = []
  if (p.action !== l.action) out.push(`action ${p.action} (attendu ${l.action})`)
  if (l.action === 'filtrer_createur') return out
  if (normCat(p.target) !== normCat(l.cible)) out.push(`cible « ${p.target ?? ''} » (attendu « ${l.cible ?? ''} »)`)
  if (normCat(p.name) !== normCat(l.nom)) out.push(`nom « ${p.name ?? ''} » (attendu « ${l.nom ?? ''} »)`)
  if (l.courants) {
    if (!p.current) out.push(`joueurs « ${p.playersPhrase ?? ''} » (attendu : la liste affichée)`)
  } else if (normCat(p.playersPhrase) !== normCat(l.joueurs)) out.push(`joueurs « ${p.playersPhrase ?? ''} » (attendu « ${l.joueurs ?? ''} »)`)
  const pt = p.then ? `${p.then.action} ${normCat(p.then.target)}` : ''
  const lt = l.puis ? `${l.puis.action} ${normCat(l.puis.cible)}` : ''
  if (pt !== lt) out.push(`ensuite « ${pt} » (attendu « ${lt} »)`)
  return out
}

export function classer(d: Demande): { classe: Classe; det: Detected | null; vers?: Vers; detail: string } {
  const said = d.page ? correctQuestionPhrase(d.phrase) : d.phrase
  const det = detectAction(said, d.page)
  const s = sortieOf(det)
  const vers = d.page ? undefined : routeVers(said)
  const plan = det?.kind === 'plan' ? det.plan : null
  const detail = plan ? JSON.stringify({ a: plan.action, cible: plan.target, nom: plan.name, joueurs: plan.playersPhrase, ...((plan as { then?: unknown }).then ? { ensuite: (plan as { then?: unknown }).then } : {}) }) : String(s)
  const k = (classe: Classe) => ({ classe, det, vers, detail })
  switch (d.attendu) {
    case 'question': {
      // Filtre par créateur : depuis l'en-tête, routé comme une recherche ; dans sa liste, fait par la liste.
      if (s === null || plan?.action === 'filtrer_createur') {
        if (d.page) return k('mistral_question')
        if (vers !== d.vers) return { ...k('travers'), detail: `page ${vers} (attendu ${d.vers})` }
        return k(vers === 'nom' ? 'local_juste' : 'mistral_question')
      }
      return k(s === 'interdite' ? 'refus_tort' : 'travers')
    }
    case 'non_prevue':
      return k(s === 'inconnue' ? 'non_prevue_dite' : s === 'modele' ? 'mistral_action' : s === null ? 'pas_vu' : s === 'interdite' ? 'refus_tort' : 'travers')
    case 'refus':
      return k(s === 'interdite' ? 'refus_ok' : s === 'modele' ? 'mistral_action' : s === 'local' ? 'travers' : 'pas_vu')
    default: {
      if (s === 'modele') return k('mistral_action')
      if (s === null) return k('pas_vu')
      if (s === 'interdite') return k('refus_tort')
      if (s === 'inconnue') return k('travers')
      if (!d.lecture) return { ...k('travers'), detail: `plan local inattendu ${detail}` }
      const e = ecarts(d, det)
      return e.length ? { ...k('travers'), detail: e.join(' ; ') } : k('local_juste')
    }
  }
}

// ---------- Passage du catalogue ----------
const handball = resolveSportConfig([], 'handball')
const volley = resolveSportConfig([], 'volley')
const rows = CATALOGUE.map((d) => {
  applySportConfig(d.persona === 'volley' ? volley : handball)
  const c = classer(d)
  applySportConfig(handball)
  return { d, ...c }
})

// Phrases uniques (une même phrase peut figurer deux fois : en-tête et liste Joueurs).
assert.ok(CATALOGUE.length >= 240, `catalogue trop court : ${CATALOGUE.length}`)
for (const d of CATALOGUE) {
  assert.ok(d.doit.trim(), `« doit » vide : ${d.phrase}`)
  if (d.sortie === 'local') assert.ok(d.lecture, `lecture manquante : ${d.phrase}`)
  if (d.attendu === 'question') assert.ok(d.page || d.vers, `page attendue manquante : ${d.phrase}`)
}
// Dépôt public : aucun nom réel connu dans le catalogue.
assert.ok(!CATALOGUE.some((d) => /\b(stef|bascher|bacher)\b/i.test(d.phrase)), 'nom réel dans le catalogue')

if (RAPPORT) {
  const classes = Object.keys(CLASSE_LABEL) as Classe[]
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length
  console.log(`\n${rows.length} phrases\n`)
  console.log('Par personne :')
  for (const p of Object.keys(PERSONA_LABEL) as Persona[]) console.log(`  ${PERSONA_LABEL[p]} : ${count((r) => r.d.persona === p)}`)
  console.log('Par type attendu :')
  for (const a of Object.keys(ATTENDU_LABEL) as Attendu[]) console.log(`  ${ATTENDU_LABEL[a]} : ${count((r) => r.d.attendu === a)}`)
  console.log('\nCouverture :')
  for (const c of classes) console.log(`  ${CLASSE_LABEL[c]} : ${count((r) => r.classe === c)}`)
  console.log('\nPar type × classe :')
  for (const a of Object.keys(ATTENDU_LABEL) as Attendu[]) console.log(`  ${ATTENDU_LABEL[a].padEnd(26)} ${classes.map((c) => `${c}=${count((r) => r.d.attendu === a && r.classe === c)}`).join(' ')}`)
  for (const c of ['travers', 'pas_vu', 'refus_tort', 'mistral_action'] as Classe[]) {
    console.log(`\n--- ${CLASSE_LABEL[c]} ---`)
    for (const r of rows.filter((x) => x.classe === c)) console.log(`  [${r.d.attendu}${r.d.page ? ` · ${r.d.page}` : ''}] ${r.d.phrase}\n      → ${r.detail}`)
  }
  const ecartsSortie = rows.filter((r) => sortieOf(r.det, r.d.attendu === 'question') !== r.d.sortie || (r.d.sortie === 'local' && r.classe !== 'local_juste') || (r.d.vers && !r.d.page && r.vers !== r.d.vers && r.classe !== 'local_juste' && r.classe !== 'mistral_question'))
  console.log(`\nÉcarts au résultat attendu après corrections : ${ecartsSortie.length}`)
  for (const r of ecartsSortie) console.log(`  ${r.d.phrase} → ${r.detail} (attendu ${r.d.sortie})`)
} else {
  for (const r of rows) {
    const got = sortieOf(r.det, r.d.attendu === 'question')
    assert.equal(got, r.d.sortie, `${r.d.phrase}${r.d.page ? ` [${r.d.page}]` : ''} → ${r.detail}`)
    if (r.d.sortie === 'local') assert.equal(r.classe, 'local_juste', `${r.d.phrase} → ${r.detail}`)
    if (r.d.attendu === 'question' && !r.d.page) assert.equal(r.vers, r.d.vers, `${r.d.phrase} → page ${r.vers}`)
    assert.notEqual(r.classe, 'travers', `${r.d.phrase} → ${r.detail}`)
    // Action pas encore prévue : la bonne famille (le message dit comment faire aujourd'hui).
    if (r.d.sortie === 'inconnue') assert.equal(r.det?.kind === 'inconnue' && r.det.what, r.d.quoi, r.d.phrase)
  }
  // Jamais de marque négative proposée : le message « negatif » ne parle que de groupes.
  assert.ok(!/retenu|écarté|refusé/.test(UNPLANNED_TEXT.negatif))

  // ---------- Références relatives : « le prochain intercomité », « le dernier stage » (toujours à confirmer) ----------
  const events = [
    { id: 'a', name: 'Intercomité de juin', date: '2026-06-10' },
    { id: 'b', name: 'Intercomité de décembre', date: '2026-12-12' },
    { id: 'c', name: 'Intercomités de mai', date: '2027-05-08' },
    { id: 'd', name: 'Stage de Toussaint', date: '2026-10-25' },
    { id: 'e', name: 'Stage de février', date: '2027-02-20' },
    { id: 'f', name: 'Tournoi de Fictiville', date: '2026-09-14' },
  ]
  const TODAY = '2026-10-31'
  let mt = matchTarget('prochain intercomité', events, TODAY)
  assert.ok(mt.kind === 'approx' && mt.best.id === 'b' && mt.choices.map((x) => x.id).join() === 'b,c', 'à venir, le plus proche d’abord (pluriel compris)')
  mt = matchTarget('dernier stage', events, TODAY)
  assert.ok(mt.kind === 'approx' && mt.best.id === 'd' && mt.choices.length === 1, 'passé, le plus récent')
  mt = matchTarget('la prochaine détection', events, TODAY)
  assert.equal(mt.kind, 'none')
  assert.deepEqual(matchTarget('mon groupe Repérés 2011', [{ name: 'Repérés 2011' }], TODAY), { kind: 'exact', item: { name: 'Repérés 2011' } })
  assert.deepEqual(matchTarget('Stage de Toussaint', events, TODAY), { kind: 'exact', item: events[3] })

  // ---------- Carte en deux étapes (« crée un groupe … et ajoute-les à l'événement X ») ----------
  const p2 = (detectAction('Crée un groupe Stage février avec les gauchers nés en 2011 et ajoute-les à l’événement Stage de février') as { plan: AskPlan }).plan
  const base = { plan: p2, criteria: ['gauchers', '2011'], count: 12, groupName: 'Stage février', allowed: true }
  let c = buildCard({ ...base, then: { target: { name: 'Stage de février' }, already: 2, allowed: true } })
  assert.deepEqual(c.steps, [
    'Chercher : gauchers · 2011 → 12 joueurs',
    'Créer le groupe « Stage février » avec ces 12 joueurs (visible par moi seul, modifiable ensuite)',
    'Puis ajouter les mêmes à l’événement « Stage de février » (2 déjà dedans)',
  ])
  assert.ok(c.canAccept)
  c = buildCard({ ...base, then: { target: { name: 'Stage de février' }, allowed: false, deniedWhy: 'Cet événement est archivé : désarchive-le d’abord.' } })
  assert.equal(c.canAccept, false, 'deuxième étape impossible : rien n’est fait')
  assert.equal(c.blocked, 'Cet événement est archivé : désarchive-le d’abord.')
  assert.equal(buildCard({ ...base }).canAccept, false, 'droits de la deuxième étape inconnus : pas d’« Accepter »')

  // ---------- En-tête : libellés des nouvelles propositions ----------
  assert.equal(routeAsk('Exporte le groupe Repérés 2011', ctx)[0].label, 'Action pas encore prévue : comment faire')
  assert.equal(routeAsk('Crée un groupe avec les 2011 du Var et ajoute-les au prochain intercomité', ctx)[0].label, 'Préparer : créer un groupe, puis ajouter à « prochain intercomité »')
  // « ceux-là » hors de la liste Joueurs : plan « liste affichée » (la carte dira « dis-moi quels joueurs ») ; « les » seul : le modèle.
  assert.ok((detectAction('Ajoute ceux-là au groupe Repérés 2011') as { plan: AskPlan }).plan.current)
  assert.deepEqual(detectAction('Ajoute-les au groupe Repérés 2011'), { kind: 'modele' })
  assert.ok((detectAction('Ajoute-les au groupe Repérés 2011', 'joueurs') as { plan: AskPlan }).plan.current)
  console.log(`test-catalogue-demandes : ${rows.length} phrases vérifiées`)
}
