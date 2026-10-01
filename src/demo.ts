import { db, type Evaluation, type HBEvent, type Measurement, type Player, type Position } from './db'

/*
 * Données de démonstration : joueurs FICTIFS (profil U18), observateurs, événements et avis.
 * Tous les identifiants commencent par « demo- » pour pouvoir les effacer proprement.
 * Les données ne sont pas mises dans la file de synchro : elles restent sur l'appareil.
 */

const PREFIX = 'demo-'

// Générateur pseudo-aléatoire déterministe (mêmes données à chaque chargement).
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let rand = rng(2026)
const between = (a: number, b: number) => a + rand() * (b - a)
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

const FIRST = ['Lucas', 'Hugo', 'Nathan', 'Enzo', 'Théo', 'Mathis', 'Noah', 'Tom', 'Louis', 'Ethan', 'Jules', 'Maël', 'Rayan', 'Adam', 'Sacha', 'Evan', 'Nolan', 'Timéo', 'Axel', 'Baptiste', 'Kylian', 'Yanis', 'Gabin', 'Robin']
const LAST = ['Martin', 'Bernard', 'Robert', 'Richard', 'Durand', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefebvre', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Blanc', 'Guerin', 'Boyer', 'Faure']
const CLUBS = ['HBC Rhône Sud', 'Entente Drôme-Ardèche', 'AS Vallée Bleue', 'Handball Collines']

// Gabarit typique par poste : [taille min, taille max]
const HEIGHT: Record<Position, [number, number]> = {
  GB: [184, 196],
  AG: [171, 181],
  AD: [171, 181],
  ARG: [185, 197],
  ARD: [184, 195],
  DC: [176, 187],
  PIV: [187, 199],
}
// Répartition d'un effectif de 24
const ROSTER: Position[] = ['GB', 'GB', 'GB', 'AG', 'AG', 'AG', 'AD', 'AD', 'AD', 'ARG', 'ARG', 'ARG', 'ARG', 'ARD', 'ARD', 'ARD', 'DC', 'DC', 'DC', 'DC', 'PIV', 'PIV', 'PIV', 'PIV']

const OBSERVERS = [
  { name: 'Coach Paul', bias: 0, noise: 0.5 },
  { name: 'Julie (adjointe)', bias: 0.3, noise: 0.6 },
  { name: 'Marc (recruteur)', bias: -0.4, noise: 0.8 },
  { name: 'Sophie (CTF)', bias: 0.1, noise: 0.5 },
  { name: 'Karim (entr. gardiens)', bias: -0.1, noise: 0.6 },
]

const EVENTS: Omit<HBEvent, 'updatedAt'>[] = [
  { id: PREFIX + 'ev-1', name: 'Stage de rentrée', type: 'entrainement', date: '2026-08-28', place: 'Valence' },
  { id: PREFIX + 'ev-2', name: 'J1 — Rhône Sud vs Collines', type: 'match', date: '2026-09-13', place: 'Montélimar' },
  { id: PREFIX + 'ev-3', name: 'Tournoi de la Drôme', type: 'tournoi', date: '2026-09-20', place: 'Romans' },
  { id: PREFIX + 'ev-4', name: 'J3 — Vallée Bleue vs Rhône Sud', type: 'match', date: '2026-09-27', place: 'Privas' },
]

const GAPS = ['Chaîne P. G ++ / RE hanche', 'Dorsiflexion cheville D limitée', 'Épaule RI G à travailler', 'Squat overhead : buste penché', '', '', '']
const STRENGTHS = ['Très bonne lecture du jeu', 'Puissant au tir de loin', 'Excellent sur le premier pas', 'Gros volume de course', 'Leader naturel, parle beaucoup', 'Bon jeu à deux avec le pivot', 'Solide en défense 1-1']
const IMPROVE = ['Repli défensif trop lent', 'Choix de tir précipité', 'Disparaît en fin de match', 'Communication défensive', 'Gestion des émotions après une erreur', 'Jeu sans ballon à développer']

const GB_STRENGTHS = ['Réflexes impressionnants', 'Très bon placement sur les tirs à 9 m', 'Relance rapide et précise', 'Organise bien sa défense']
const GB_IMPROVE = ['Relance trop lente', 'Sorties sur les ailiers', 'Lecture des tirs en appui', 'Communication avec la défense']

const SUBJ_FIELD = ['vision', 'decision', 'lecture', 'sans_ballon', 'efficacite_tir', 'duel', 'passe', 'collectif', 'agressivite', 'placement_def', 'comm_def', 'interceptions', 'engagement', 'pression', 'leadership', 'attitude', 'concentration']
const SUBJ_GB = ['gb_placement', 'gb_reflexes', 'gb_lecture', 'gb_relance', 'gb_presence', 'engagement', 'pression', 'leadership', 'attitude', 'concentration']
const QUICK = new Set(['vision', 'decision', 'efficacite_tir', 'agressivite', 'engagement', 'pression', 'gb_placement', 'gb_reflexes'])

export async function loadDemo() {
  await clearDemo()
  rand = rng(2026)
  const now = Date.now()
  const players: Player[] = []
  const measurements: Measurement[] = []
  const evaluations: Evaluation[] = []
  /** Niveau « réel » caché de chaque joueur par critère, dont les avis s'inspirent. */
  const level = new Map<string, Record<string, number>>()

  ROSTER.forEach((pos, i) => {
    const id = `${PREFIX}p-${i + 1}`
    const club = CLUBS[i % CLUBS.length]
    const lat = pos === 'AD' || (pos === 'ARD' && rand() < 0.7) ? 'gaucher' : rand() < 0.08 ? 'ambidextre' : 'droitier'
    const year = rand() < 0.5 ? 2009 : 2010
    players.push({
      id,
      firstName: FIRST[i],
      lastName: LAST[(i * 7) % LAST.length],
      birthDate: `${year}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
      sex: 'M',
      position: pos,
      team: 'U18 Nationale',
      license: String(5800000 + Math.floor(rand() * 99999)),
      category: '-18 nat',
      club,
      boarding: rand() < 0.35,
      laterality: lat,
      gaps: pick(GAPS) || undefined,
      notes: rand() < 0.3 ? 'Joueur fictif généré pour la démonstration.' : undefined,
      updatedAt: now,
    })

    // ----- Mesures factuelles : juin (fin de saison) puis septembre (rentrée) -----
    const [hMin, hMax] = HEIGHT[pos]
    const h = between(hMin, hMax)
    // Parents biologiques cohérents avec le gabarit du joueur ; la moitié des tailles sont déclarées.
    const father = Math.round(clamp(h - 2 + between(-6, 6), 165, 200))
    Object.assign(players[players.length - 1], {
      fatherHeight: father,
      fatherHeightSource: rand() < 0.5 ? 'mesuree' : 'declaree',
      motherHeight: Math.round(clamp(father - 13 + between(-7, 7), 150, 185)),
      motherHeightSource: rand() < 0.5 ? 'mesuree' : 'declaree',
    })
    const athletic = between(-1, 1) // qualité athlétique globale
    const t1 = {
      taille: round(h - between(0.5, 1.5), 1),
      poids: round(h - 100 + between(-12, 4) + (pos === 'PIV' ? 8 : 0), 1),
      taille_assise: round(h * between(0.505, 0.53), 1),
      empan: round(between(20, 25) + (h - 180) * 0.05, 1),
      envergure: Math.round(h + between(-1, 7)),
      sprint_10: round(1.82 - athletic * 0.08 + between(-0.03, 0.03), 2),
      sprint_30: round(4.35 - athletic * 0.18 + between(-0.05, 0.05), 2),
      t_test: round(9.2 - athletic * 0.4 + between(-0.15, 0.15), 2),
      vift: round(19 + athletic * 1.5 + between(-0.5, 0.5), 1),
      saut_bilateral: round(2.45 + athletic * 0.2 + between(-0.08, 0.08), 2),
      saut_largeur_g: round(2.2 + athletic * 0.15 + between(-0.08, 0.08), 2),
      saut_largeur_d: round(2.2 + athletic * 0.15 + between(-0.08, 0.08), 2),
      medball_conc: round(5.6 + athletic * 0.6 + (h - 185) * 0.03 + between(-0.3, 0.3), 2),
      medball_plio: round(5.4 + athletic * 0.6 + (h - 185) * 0.03 + between(-0.3, 0.3), 2),
      dorsi_g: Math.round(between(8, 15)),
      dorsi_d: Math.round(between(8, 15)),
    }
    const scores = {
      explosivite: clamp(Math.round(3 + athletic * 1.6 + between(-0.6, 0.6)), 1, 5),
      puissance: clamp(Math.round(3 + athletic * 1.2 + (h - 185) * 0.06 + between(-0.6, 0.6)), 1, 5),
      vitesse: clamp(Math.round(3 + athletic * 1.5 + between(-0.6, 0.6)), 1, 5),
      detente: clamp(Math.round(3 + athletic * 1.4 + between(-0.6, 0.6)), 1, 5),
      tir: clamp(Math.round(3 + between(-1.5, 1.8)), 1, 5),
      chaine_post_g: Math.round(between(0.5, 3.4)),
      chaine_post_d: Math.round(between(0.5, 3.4)),
      epaule_g: Math.round(between(0.8, 3.4)),
      epaule_d: Math.round(between(0.8, 3.4)),
      hanche_ri: Math.round(between(0, 2.4)),
      hanche_re: Math.round(between(0, 2.4)),
      ohs: Math.round(between(0.5, 3.4)),
      trunk_pu: Math.round(between(0.8, 3.4)),
      stab_rot: Math.round(between(0.8, 3.4)),
      adducteur: Math.round(between(0.8, 3.4)),
    }
    const add = (criterionId: string, value: number, date: string) =>
      measurements.push({ id: `${id}-${criterionId}-${date}`, playerId: id, criterionId, value, date, author: 'Préparateur (démo)', updatedAt: now })

    for (const [k, v] of Object.entries({ ...t1, ...scores })) add(k, v, '2026-06-15')
    // Rentrée : petite progression (croissance, travail estival)
    const prog = between(0, 1)
    const t2: Record<string, number> = {
      taille: round(t1.taille + between(0.3, 1.5), 1),
      poids: round(t1.poids + between(-0.5, 2.5), 1),
      sprint_10: round(t1.sprint_10 - prog * 0.04, 2),
      sprint_30: round(t1.sprint_30 - prog * 0.08, 2),
      t_test: round(t1.t_test - prog * 0.2, 2),
      vift: round(t1.vift + prog * 0.8, 1),
      saut_bilateral: round(t1.saut_bilateral + prog * 0.07, 2),
      medball_conc: round(t1.medball_conc + prog * 0.25, 2),
      dorsi_g: t1.dorsi_g + Math.round(prog),
      dorsi_d: t1.dorsi_d + Math.round(prog),
    }
    for (const [k, v] of Object.entries(t2)) add(k, v, '2026-09-21')

    // ----- Niveau « réel » pour les avis subjectifs -----
    const base = between(2.4, 4.2)
    const lv: Record<string, number> = {}
    for (const c of [...SUBJ_FIELD, ...SUBJ_GB]) lv[c] = base + between(-0.9, 0.9)
    level.set(id, lv)
  })

  // ----- Avis subjectifs -----
  for (const ev of EVENTS) {
    // Chaque événement : 3 ou 4 observateurs présents, ~12 joueurs vus
    const present = OBSERVERS.filter(() => rand() < 0.75).slice(0, 4)
    if (present.length < 2) present.push(OBSERVERS[0], OBSERVERS[1])
    const seen = players.filter(() => rand() < 0.55)
    for (const p of seen) {
      const crits = p.position === 'GB' ? SUBJ_GB : SUBJ_FIELD
      for (const o of present) {
        // L'entraîneur des gardiens ne note que les gardiens ; les autres ne voient pas tout.
        if (o.name.startsWith('Karim') && p.position !== 'GB') continue
        if (rand() < 0.2) continue
        const full = rand() < 0.4
        const sc: Record<string, number> = {}
        for (const c of crits) {
          if (!full && !QUICK.has(c)) continue
          if (rand() < 0.1) continue // critère non observé
          // Quelques désaccords marqués pour illustrer les divergences
          const disagree = rand() < 0.06 ? (rand() < 0.5 ? -1.8 : 1.8) : 0
          sc[c] = clamp(Math.round(level.get(p.id)![c] + o.bias + disagree + (rand() - 0.5) * 2 * o.noise), 1, 5)
        }
        const vals = Object.values(sc)
        if (!vals.length) continue
        evaluations.push({
          id: `${PREFIX}e-${ev.id}-${p.id}-${o.name.split(' ')[0]}`,
          playerId: p.id,
          eventId: ev.id,
          observer: o.name,
          date: ev.date,
          scores: sc,
          overall: clamp(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length + (rand() - 0.5)), 1, 5),
          minutesObserved: ev.type === 'tournoi' ? Math.round(between(40, 120)) : Math.round(between(15, 60)),
          strengths: rand() < 0.5 ? pick(p.position === 'GB' ? GB_STRENGTHS : STRENGTHS) : undefined,
          improvements: rand() < 0.45 ? pick(p.position === 'GB' ? GB_IMPROVE : IMPROVE) : undefined,
          updatedAt: now,
        })
      }
    }
  }

  await db.transaction('rw', [db.players, db.measurements, db.events, db.evaluations], async () => {
    await db.players.bulkPut(players)
    await db.measurements.bulkPut(measurements)
    await db.events.bulkPut(EVENTS.map((e) => ({ ...e, updatedAt: now })))
    await db.evaluations.bulkPut(evaluations)
  })
  return { players: players.length, measurements: measurements.length, events: EVENTS.length, evaluations: evaluations.length }
}

export async function clearDemo() {
  const isDemo = (x: { id: string }) => x.id.startsWith(PREFIX)
  await db.transaction('rw', [db.players, db.measurements, db.events, db.evaluations, db.outbox], async () => {
    for (const t of [db.players, db.measurements, db.events, db.evaluations] as const) {
      const ids = (await t.toArray()).filter(isDemo).map((x) => x.id)
      await t.bulkDelete(ids)
    }
    await db.outbox.filter((o) => o.rowId.startsWith(PREFIX)).delete()
  })
}
