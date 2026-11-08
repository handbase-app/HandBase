// Test de la vie fictive des Pôles Espoirs (tools/seed-activite-poles.ts, tools/poles-saison.ts), parties pures : une base
// « comme celle de la maison » fabriquée depuis le jeu national (tools/seed-hand.ts), avec des périodes de pôle en désordre
// (anciens effectifs tirés au hasard, sorties aux motifs variés) et des fiches modifiées par de vrais comptes. Effectifs
// (12 à 20, quatre classes, ~3/4 entrés en 3e, territoire, fiches figées jamais touchées, plan stable), wellness (taux de
// réponse variés, jours demandés, douleurs bien formées comme hb_wl_douleurs, fatigue après les grosses journées), séances
// (durée toujours là, rien pendant les vacances), tests, avis, journal, SQL (gardes, rejouable, rien d'ouvert à l'écriture
// dans l'extrait), déterminisme. Aucune base, aucun réseau ; données fictives.
//
//   npx jiti tools/test-seed-activite-poles.ts
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { playerClub, playerDepartment } from '../src/perimeter'
import type { PolePeriod } from '../src/db'
import { POLE_SITES } from '../src/poles'
import { SPORT_CONTENT } from '../src/sportContent'
import { cleanPains, completionRate } from '../src/wellness'
import { buildSeed, FAMOUS } from './seed-hand'
import { fold } from './seed-volley'
import { ANNEE_SORTIS, ANNEES_POLE, appliquerPlan, ciblesClasses, planifierPoles, regionOfDept, tailleSite } from './poles-saison'
import {
  candidats,
  dow,
  ecrireSql,
  enVacances,
  extraitSql,
  jourDemande,
  preparer,
  sqlFiches,
  sqlGroupes,
  sqlRetour,
  sqlTestsAvis,
  sqlWellness,
  staffDuPole,
  TESTS_ACTIVITE,
  VACANCES,
  verifySql,
  type Entree,
  type Joueur,
} from './seed-activite-poles'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

// ---------- Une base « comme celle de la maison » ----------

const file = readFileSync(new URL(`../public/${SPORT_CONTENT.handball.demoCriteria}`, import.meta.url), 'utf8')
const seed = buildSeed(file)
const FIN = '2026-11-08'
const h = (s: string) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16) / 2 ** 32
const sites = POLE_SITES
const joueurs: Joueur[] = []
for (const p of seed.players) {
  if (p.year < ANNEE_SORTIS || p.year > ANNEES_POLE[0]) continue
  // Effectifs d'avant en désordre (comme supabase/maintenance/demo_poles_espoirs.sql) : 3 % des 2009-2012 au hasard sur un
  // site du bon sexe, entrés en 2023-2025, une partie sortis avec des motifs variés ; les périodes du jeu national effacées.
  let poles: PolePeriod[] | undefined
  if (p.year >= 2009 && h(`desordre:${p.id}`) < 0.03) {
    const cand = sites.filter((s) => s.sex === p.sex && s.regions.includes(p.region))
    if (cand.length) {
      const s = cand[Math.floor(h(`site:${p.id}`) * cand.length)]
      const from = `${2023 + Math.floor(h(`from:${p.id}`) * 3)}-09-01`
      poles = [{ regionId: s.regions[0], site: s.site, from, ...(h(`sorti:${p.id}`) < 0.2 ? { to: '2025-04-15', exitReason: 'abandon' as const } : {}) }]
    }
  }
  const fige = h(`fige:${p.id}`) < 0.002
  joueurs.push({
    id: p.id, sexe: p.sex, naissance: p.birthDate, annee: p.year, dept: playerDepartment(p.data as { clubCode?: string }) ?? '',
    club: playerClub(p.data as { clubCode?: string }) ?? '', ...(p.pos ? { poste: p.pos } : {}), ...(poles ? { poles } : {}),
    fige, mesures: seed.measured.has(p.i) ? 1 : 0, testsReels: poles && h(`tests:${p.id}`) < 0.5 ? 12 : 0, avis: 0, compte: h(`compte:${p.id}`) < 0.001,
  })
}
const units = seed.tables.units.filter((r) => r.data.levelId === 'niveau-pole').map((r) => r.data as { id: string; name: string; poleSite: string; poleSex: string })
const groupesSeed = seed.tables.groups.filter((r) => r.data.poleUnitId)
const entree: Entree = {
  joueurs,
  unites: units.map((u) => ({ id: u.id, nom: u.name, site: sites.find((s) => s.sex === u.poleSex && fold(s.site) === fold(u.poleSite))! })),
  // Seulement 4 groupes Pôle (comme à la maison) : les autres sont à créer.
  groupes: groupesSeed.slice(0, 4).map((g) => ({ id: g.id, uniteId: g.data.poleUnitId as string, wellness: false, supprime: false })),
  criteres: seed.grid.subjective.map((c) => ({ id: c.id, category: c.category, ...(c.positions ? { positions: c.positions } : {}), quick: !!c.quick })),
  tests: new Set(TESTS_ACTIVITE),
  createur: { id: '00000000-0000-0000-0000-00000000fed0', nom: 'Compte national (essai)' },
  derniers: new Map(),
  joursMesures: new Map(),
}
for (const r of seed.tables.measurements) {
  const d = r.data as { playerId: string; criterionId: string; date: string; value: number }
  const m = entree.derniers.get(d.playerId) ?? new Map()
  const cur = m.get(d.criterionId)
  if (!cur || cur.date < d.date) m.set(d.criterionId, { date: d.date, valeur: d.value })
  entree.derniers.set(d.playerId, m)
  if (d.date >= '2026-09-01') entree.joursMesures.set(d.playerId, (entree.joursMesures.get(d.playerId) ?? new Set()).add(d.date))
}
const byId = new Map(joueurs.map((j) => [j.id, j]))
const a = preparer(entree, { fin: FIN })

// ---------- Effectifs ----------

t('effectifs : 51 sites, 12 à 20 jeunes, quatre classes (3e et 2de les plus nombreuses), ~3/4 entrés en 3e', () => {
  assert.equal(a.plan.sites.length, 51)
  assert.deepEqual(ciblesClasses(12), [3, 4, 3, 2])
  assert.equal(ciblesClasses(17).reduce((x, y) => x + y, 0), 17)
  let e3 = 0
  let tot = 0
  for (const sp of a.plan.sites) {
    const k = sp.membres.filter((c) => !c.fige)
    assert.ok(sp.membres.length >= 12 && sp.membres.length <= 20, `${sp.key} : ${sp.membres.length}`)
    assert.equal(sp.taille, tailleSite(sp.site))
    const cl = ANNEES_POLE.map((y) => sp.membres.filter((c) => c.annee === y).length)
    assert.ok(cl.every((x) => x >= 2), `${sp.key} ${cl}`)
    assert.ok(Math.max(cl[0], cl[1]) >= Math.max(cl[2], cl[3]), `${sp.key} ${cl}`)
    for (const c of k) {
      const from = (a.plan.ecritures.get(c.id)?.poles ?? c.poles)![0].from!
      assert.ok(from === `${c.annee + 14}-09-01` || (c.annee !== ANNEES_POLE[0] && from === `${c.annee + 15}-09-01`), `${c.annee} ${from}`)
      if (from === `${c.annee + 14}-09-01`) e3++
      tot++
    }
    assert.ok(sp.sortis.length >= 2 && sp.sortis.length <= 4)
    const gb = sp.membres.filter((c) => c.poste === 'GB').length
    assert.ok(gb >= 1 && gb <= 3, `${sp.key} gardiens ${gb}`)
  }
  assert.ok(e3 / tot > 0.68 && e3 / tot < 0.82, `entrés en 3e ${e3}/${tot}`)
})

t('effectifs : clubs du territoire du pôle (régions du site), un jeune sur un seul pôle, plusieurs jeunes de certains clubs', () => {
  const vus = new Set<string>()
  let memeClub = 0
  for (const sp of a.plan.sites) {
    const clubs = new Map<string, number>()
    for (const c of sp.membres) {
      assert.ok(!vus.has(c.id), 'un seul pôle')
      vus.add(c.id)
      if (!c.fige) assert.ok(sp.site.regions.includes(regionOfDept(c.dept)!), `${sp.key} : ${c.dept}`)
      assert.equal(c.sexe, sp.site.sex)
      clubs.set(c.club!, (clubs.get(c.club!) ?? 0) + 1)
    }
    if ([...clubs.values()].some((x) => x >= 2)) memeClub++
  }
  assert.ok(memeClub >= 25, `sites avec au moins deux jeunes d'un même club : ${memeClub}`)
})

t('effectifs : fiches figées jamais écrites ; sorties en fin de cursus seulement ; anciens motifs négatifs retirés', () => {
  for (const id of a.plan.ecritures.keys()) assert.ok(!byId.get(id)!.fige)
  for (const [id, w] of a.plan.ecritures) {
    const j = byId.get(id)!
    for (const x of w.poles ?? []) {
      if (x.to || x.exitReason) assert.ok(x.to === '2026-06-30' && x.exitReason === 'fin_cursus' && j.annee === ANNEE_SORTIS, JSON.stringify(x))
      assert.ok(x.regionId && x.site && x.from)
    }
  }
  const restes = appliquerPlan(candidats(entree), a.plan).filter((c) => !c.fige && (c.poles ?? []).some((x) => x.exitReason && x.exitReason !== 'fin_cursus'))
  assert.equal(restes.length, 0)
})

t('effectifs : relancer le plan sur son résultat ne change rien ; membres actuels gardés de préférence', () => {
  const apres = appliquerPlan(candidats(entree), a.plan)
  const b = planifierPoles(apres, { jour: FIN })
  assert.equal(b.ecritures.size, 0, [...b.ecritures.keys()].slice(0, 3).join(','))
  const actuels = joueurs.filter((j) => !j.fige && j.poles?.some((x) => !x.to) && ANNEES_POLE.includes(j.annee) && j.poste)
  const gardes = actuels.filter((j) => a.plan.sites.some((s) => s.membres.some((c) => c.id === j.id)))
  assert.ok(gardes.length / actuels.length > 0.5, `${gardes.length} / ${actuels.length}`)
})

// ---------- Groupes ----------

t('groupes : un groupe Pôle créé pour chaque unité qui n\'en a pas, wellness activé, créateur donné ; clé posée sur les autres', () => {
  assert.equal(a.nouveauxGroupes.length, 47)
  for (const g of a.nouveauxGroupes) {
    assert.equal(g.data.wellness, true)
    assert.equal(g.data.createdBy, entree.createur!.id)
    assert.deepEqual(g.data.playerIds, [])
  }
  assert.equal(a.groupesWellness.length, 4)
  const sql = sqlGroupes(a)
  assert.match(sql, /where not exists \(select 1 from public\.hb_groups g where g\.data ->> 'poleUnitId' = v\.unite/)
  assert.match(sql, /on conflict \(id\) do nothing/)
})

// ---------- Wellness et séances ----------

t('wellness : quelques jeunes à 100 %, la plupart à 75-99 %, quelques-uns à 40-70 % (jours demandés seulement)', () => {
  const taux = [...a.vies.values()].map((v) => {
    const r = completionRate(v.reponses.filter((x) => !enVacances(x.jour)).map((x) => x.jour), '2026-09-01', FIN)
    const demandes = r.requested - 10 // 10 jours de semaine de vacances
    assert.equal(v.demandes, demandes)
    return v.reponses.filter((x) => jourDemande(x.jour)).length / v.demandes
  })
  const full = taux.filter((x) => x === 1).length / taux.length
  const most = taux.filter((x) => x >= 0.75 && x < 1).length / taux.length
  const low = taux.filter((x) => x >= 0.4 && x <= 0.7).length / taux.length
  assert.ok(full > 0.04 && full < 0.15, `100 % : ${full}`)
  assert.ok(most > 0.65, `75-99 % : ${most}`)
  assert.ok(low > 0.05 && low < 0.2, `40-70 % : ${low}`)
  // Réponses hors des jours demandés : rares (week-end, vacances), jamais comptées.
  const hors = a.wellness.filter((w) => !jourDemande(w.jour)).length / a.wellness.length
  assert.ok(hors > 0 && hors < 0.03, `${hors}`)
})

t('wellness : quatre notes entières 1-10, des notes basses, douleurs bien formées (comme hb_wl_douleurs), des épisodes qui baissent', () => {
  let basses = 0
  for (const w of a.wellness) {
    assert.deepEqual(Object.keys(w.scores).sort(), ['energie', 'fraicheur', 'humeur', 'sommeil'])
    for (const v of Object.values(w.scores)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 10)
    basses += Object.values(w.scores).filter((v) => v <= 4).length
    assert.equal(w.douleur, w.douleurs.length > 0)
    if (w.douleur) assert.deepEqual(cleanPains(w.douleurs), w.douleurs, JSON.stringify(w.douleurs))
  }
  assert.ok(basses / (a.wellness.length * 4) > 0.03, `notes ≤ 4 : ${basses}`)
  const types = new Set(a.wellness.flatMap((w) => w.douleurs.map((d) => d.type)))
  for (const x of ['courbatures', 'contracture', 'gene', 'douleur', 'coup']) assert.ok(types.has(x as never), x)
  assert.ok(a.wellness.some((w) => w.douleurs.some((d) => d.zone === 'cheville' && d.texte === 'Entorse')))
  assert.ok(a.wellness.some((w) => w.douleurs.length >= 3))
  // Une contracture : l'intensité baisse au fil des jours.
  const c = a.wellness.filter((w) => w.douleurs.some((d) => d.type === 'contracture' && d.zone === 'ischios'))
  const parJoueur = new Map<string, number[]>()
  for (const w of c) parJoueur.set(w.player_id, [...(parJoueur.get(w.player_id) ?? []), w.douleurs.find((d) => d.type === 'contracture')!.intensite])
  const baisse = [...parJoueur.values()].filter((xs) => xs.length >= 3 && xs[0] > xs[xs.length - 1]).length
  assert.ok(baisse >= 5, `contractures qui baissent : ${baisse}`)
})

t('wellness : fatigue le lendemain des grosses journées (fraîcheur plus basse le lundi après un match, courbatures)', () => {
  const match = (pid: string, lundi: string) =>
    a.vies.get(pid)!.seances.some((s) => s.type === 'match' && s.jour < lundi && s.jour >= new Date(Date.parse(`${lundi}T12:00:00Z`) - 2 * 864e5).toISOString().slice(0, 10))
  const lundis = a.wellness.filter((w) => dow(w.jour) === 1 && match(w.player_id, w.jour))
  assert.ok(lundis.length > 1000, `${lundis.length}`)
  const mercredis = a.wellness.filter((w) => dow(w.jour) === 3)
  const moy = (xs: typeof a.wellness) => xs.reduce((s, w) => s + w.scores.fraicheur, 0) / xs.length
  assert.ok(moy(lundis) < moy(mercredis) - 0.2, `${moy(lundis)} / ${moy(mercredis)}`)
  const cb = (xs: typeof a.wellness) => xs.filter((w) => w.douleurs.some((d) => d.type === 'courbatures')).length / xs.length
  assert.ok(cb(lundis) > cb(mercredis), `${cb(lundis)} / ${cb(mercredis)}`)
})

t('séances : RPE 1-10 et durée toujours là (1-600), 6 par jour au plus, rien pendant les vacances ni le jour de fin', () => {
  const parJour = new Map<string, number>()
  for (const s of a.seances) {
    assert.ok(Number.isInteger(s.rpe) && s.rpe >= 1 && s.rpe <= 10)
    assert.ok(Number.isInteger(s.duree) && s.duree >= 1 && s.duree <= 600)
    assert.ok(!enVacances(s.jour) && s.jour < FIN && s.jour >= '2026-09-01', s.jour)
    assert.ok(s.at.slice(0, 10) <= FIN)
    const k = `${s.player_id}:${s.jour}`
    parJour.set(k, (parJour.get(k) ?? 0) + 1)
  }
  assert.ok(Math.max(...parJour.values()) <= 6)
  assert.ok(a.seances.some((s) => dow(s.jour) === 6 || dow(s.jour) === 0), 'matchs du week-end')
  const matchs = a.seances.filter((s) => dow(s.jour) % 6 === 0)
  assert.ok(matchs.reduce((x, s) => x + s.rpe, 0) / matchs.length > 6.5)
  const durees = a.seances.map((s) => s.duree).sort((x, y) => x - y)
  assert.ok(durees[Math.floor(durees.length * 0.1)] >= 45 && durees[Math.floor(durees.length * 0.9)] <= 120, `${durees[Math.floor(durees.length * 0.1)]} ${durees[Math.floor(durees.length * 0.9)]}`)
  assert.deepEqual(VACANCES, ['2026-10-17', '2026-11-01'])
})

t('déterminisme : même entrée, même SQL ; prolonger la période ne change pas les jours déjà écrits', () => {
  const b = preparer(entree, { fin: FIN })
  assert.equal(sqlWellness(b), sqlWellness(a))
  assert.equal(sqlFiches(b), sqlFiches(a))
  const c = preparer(entree, { fin: '2026-11-10' })
  const key = (w: { player_id: string; jour: string }) => `${w.player_id}:${w.jour}`
  const avant = new Map(a.wellness.map((w) => [key(w), JSON.stringify(w)]))
  for (const w of c.wellness) if (w.jour <= FIN && avant.has(key(w))) assert.equal(JSON.stringify(w), avant.get(key(w)))
  assert.ok(c.wellness.some((w) => w.jour === '2026-11-09'))
})

// ---------- Tests et avis ----------

t('tests : seulement une partie des tests et des jeunes à chaque séance, jamais un jour déjà mesuré, valeurs plausibles', () => {
  const parSeance = new Map<string, Set<string>>()
  for (const r of a.mesures) {
    const d = r.data as { playerId: string; criterionId: string; date: string; value: number }
    assert.ok(!entree.joursMesures.get(d.playerId)?.has(d.date))
    assert.ok(!enVacances(d.date) && d.date < FIN)
    parSeance.set(d.date, (parSeance.get(d.date) ?? new Set()).add(d.playerId))
    if (d.criterionId === 'taille') assert.ok(d.value > 140 && d.value < 210, `${d.value}`)
    if (d.criterionId === 'sprint_10') assert.ok(d.value > 1.5 && d.value < 2.6, `${d.value}`)
    if (d.criterionId === 'vift') assert.ok(d.value > 12 && d.value < 23, `${d.value}`)
    assert.ok(r.scope && r.scope[0])
  }
  const parJeune = new Map<string, Set<string>>()
  for (const r of a.mesures) parJeune.set(`${r.data.playerId}:${r.data.date}`, (parJeune.get(`${r.data.playerId}:${r.data.date}`) ?? new Set()).add(r.data.criterionId as string))
  assert.ok([...parJeune.values()].every((s) => s.size < TESTS_ACTIVITE.length), 'jamais tout')
  const membres = new Set(a.vies.keys())
  const testes = new Set(a.mesures.map((r) => r.data.playerId as string))
  assert.ok(testes.size / membres.size > 0.85 && testes.size <= membres.size)
})

t('avis : grille du poste (gardiens à part), notes 1-5, textes positifs ou « À travailler : », pas tout le monde à chaque fois', () => {
  const crit = new Map(entree.criteres.map((c) => [c.id, c]))
  for (const r of a.avis) {
    const d = r.data as { playerId: string; scores: Record<string, number>; strengths?: string; improvements?: string; review: string; contextType: string }
    const j = byId.get(d.playerId)!
    for (const [k, v] of Object.entries(d.scores)) {
      assert.ok(Number.isInteger(v) && v >= 1 && v <= 5)
      const c = crit.get(k)!
      assert.ok(!c.positions?.length || (j.poste && c.positions.includes(j.poste)), `${k} pour ${j.poste}`)
    }
    if (d.improvements) assert.match(d.improvements, /^À travailler : /)
    if (d.strengths) assert.doesNotMatch(d.strengths, /\b(pas|faible|nul|insuffisant|mauvais|lent)\b/i)
    assert.equal(d.review, 'validated')
    assert.equal(d.contextType, 'autre')
  }
  const notes = new Set(a.avis.map((r) => r.data.playerId))
  assert.ok(notes.size / a.vies.size > 0.6 && notes.size < a.vies.size)
  for (const s of POLE_SITES) for (const x of staffDuPole(s)) assert.ok(!FAMOUS.has(fold(x.nom)))
  assert.doesNotMatch(JSON.stringify(a.avis), /retenu|refus|exclu|abandon|insuffisant|médiocre|mauvais|décevant/i)
})

t('journal : notes courtes et positives ou neutres, humeurs connues, une partie partagée', () => {
  assert.ok(a.journal.length > 50)
  for (const x of a.journal) {
    assert.ok(x.text.length <= 300 && ['motive', 'content', 'fier', 'concentre', 'serein', 'pensif', 'decu', 'fatigue'].includes(x.mood))
    assert.equal(x.id.length, 11)
  }
  const part = a.journal.filter((x) => x.shared).length / a.journal.length
  assert.ok(part > 0.25 && part < 0.65)
  assert.equal(new Set(a.journal.map((x) => x.id)).size, a.journal.length)
})

// ---------- SQL ----------

t('SQL : gardes (vrai compte, extrait, marque), rejouable, retour arrière, un seul fichier sans begin/commit, extrait en lecture seule', () => {
  const f = sqlFiches(a)
  assert.match(f, /data \? 'updatedBy'/)
  assert.match(f, /hb_audit a where a\.table_name = 'players'/)
  assert.match(f, /changée depuis l''extrait : laissée/)
  assert.match(f, /set local session_replication_role = replica/)
  const ta = sqlTestsAvis(a)
  assert.match(ta, /where t\.data ->> 'demoSeed' = 'poles-2026' and not \(t\.data \? 'updatedBy'\)/)
  assert.match(sqlWellness(a), /where t\.user_id is null/)
  const x = extraitSql()
  assert.match(x, /begin transaction read only/)
  assert.doesNotMatch(x, /\b(insert|update|delete|truncate|drop|alter)\b/i)
  assert.doesNotMatch(x, /firstName|lastName/)
  const r = sqlRetour(a)
  assert.match(r, /coalesce\(p\.data -> 'poles', 'null'::jsonb\) = coalesce\(t\.apres, 'null'::jsonb\)/)
  assert.match(r, /w\.user_id is null/)
  assert.match(r, /x\.data ->> ''demoSeed'' = %L and not x\.deleted and not \(x\.data \? ''updatedBy''\)/)
  const v = verifySql(FIN)
  assert.match(v, /md5\(prosrc\) hb_upsert/)
  const dir = mkdtempSync(join(tmpdir(), 'test-seed-activite-poles-'))
  const files = ecrireSql(a, dir)
  const tout = readFileSync(`${dir}/activite-poles.sql`, 'utf8')
  assert.doesNotMatch(tout, /^\s*(begin|commit|rollback)\s*;/im)
  assert.doesNotMatch(tout, /\\ir /)
  assert.ok(files.includes('apply.sql') && files.includes('03_reglage_wellness_demo_retour.sql') && files.includes('07_retour_arriere.sql'))
  assert.match(readFileSync(`${dir}/03_reglage_wellness_demo.sql`, 'utf8'), /'actif', true, 'demo', true/)
  rmSync(dir, { recursive: true, force: true })
})

console.log(`\n${n} tests OK`)
