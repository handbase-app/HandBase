/*
 * NIVEAU DE CHARGE DU SERVEUR ET RÈGLES ADAPTATIVES : la partie PURE (ni Dexie, ni React, ni Supabase), testée par
 * tools/test-charge.ts ; branchée dans src/sync.ts (mesure, direct, filet, envoi de la file) et src/presence.ts (signe de vie).
 *
 * POURQUOI (séries 8 et 9 du 30/10) : le jour J réaliste tient à 10 000 appareils, mais dans le scénario dur (tout le monde
 * note toutes les 30 s) la base sature entre 6 000 et 10 000 appareils, Realtime dépasse sa mémoire et redémarre, et les
 * appareils dont le direct est coupé relancent « quoi de neuf ? » toutes les 60 s au lieu de 5 min : boule de neige.
 * Chaque appareil estime donc un NIVEAU (calme, chargé, saturé) et, en charge, se fait plus discret sur ce qui peut attendre
 * (relectures après un signal, « vu », traces, filet de sécurité), SANS JAMAIS RETARDER une notation ou une évaluation.
 *
 * LE NIVEAU, estimé par l'appareil lui-même (LoadMeter) :
 *  - chaque requête vers la base (src/retry.ts, onResult) est un indice : refus (429, 503 de refus explicite), autre 503 /
 *    504 / 408, délai dépassé, réponse lente (au-delà de lentMs, très lente au-delà de tresLentMs) ; chaque indice vaut des
 *    POINTS (poids ci-dessous), gardés pendant fenetreMs ; un Retry-After long (≥ retryAfterSatureMs) vaut « saturé » d'un
 *    coup, un Retry-After moyen (≥ retryAfterChargeMs) au moins « chargé » ;
 *  - montée IMMÉDIATE : dès que les points de la fenêtre atteignent le seuil d'entrée d'un niveau ;
 *  - retour au calme PROGRESSIF (hystérésis) : un niveau est gardé tant que les points restent au-dessus de son seuil de
 *    SORTIE (plus bas que celui d'entrée) ; il ne descend que d'UN cran après calmeAvantDescenteMs sans indice suffisant, puis
 *    encore un cran après la même durée : saturé → chargé → calme prend au moins 2 × calmeAvantDescenteMs. Pas de va-et-vient.
 * INDICES V2 (série 10, scénario dur : les règles ne s'étaient presque jamais déclenchées : chaque requête restait sous 2 s,
 * la saturation était dans leur NOMBRE et dans la distribution du direct) :
 *  - durée d'une synchronisation entière (envoi, « quoi de neuf ? », relectures ; hors premier chargement et gros envois) :
 *    plus de syncLongueMs (10 s) 1 point, plus de syncTresLongueMs (30 s) 2 points ;
 *  - retard du direct (réception − heure du signal : heure serveur des lignes portées, sinon heure d'envoi) : plus de
 *    retardMs (10 s) 1 point, plus de retardTresMs (60 s) 2 points ; mesuré au-delà du plus petit retard vu depuis le
 *    lancement (une horloge d'appareil en avance ne fait pas croire à une charge ; plus de retardBaseMaxMs d'avance : indice
 *    pas utilisé), au plus un
 *    indice par retardEspacementMs (une rafale de signaux en retard compte une fois), valeurs absurdes ignorées ;
 *  - annonce du serveur portée aussi par la réponse du registre (supabase/061, champ k), toutes les 5 minutes, même là où
 *    les messages envoyés par la base ne sont pas distribués (tâche hb_surveiller_charge, non activée par défaut).
 * ANNONCE DU SERVEUR (facultative) : message « charge » sur le canal commun hb:commun, { niveau: 'calme' | 'charge' |
 * 'sature', ttl?: secondes } (tools/annoncer-charge.mjs). Le niveau annoncé est un PLANCHER jusqu'à son échéance (ttl,
 * annonceTtlMs par défaut, annonceMaxMs au plus) ; « calme » retire le plancher (les indices de l'appareil restent). À
 * l'échéance, le retour est progressif comme ci-dessus. Un message forgé (tout compte du staff peut émettre sur hb:commun)
 * ne peut que ralentir l'appareil au plus annonceMaxMs, jamais retarder une notation : effet borné.
 *
 * LES RÈGLES (fonctions pures, seuils réglables dans CHARGE_REGLES, un seul endroit) :
 *  - direct décalé : regroupement des signaux 1,5 s (calme), 5 s (chargé), 10 s (saturé) ; étalement des canaux larges
 *    10, 20, 30 s ;
 *  - « vu » et traces (journal des questions) regroupés : l'envoi de la file attend 0,5 s (calme), 10 s (chargé), 30 s
 *    (saturé) quand elle ne contient QUE cela ; une notation, une évaluation ou toute autre modification part toujours après
 *    0,5 s (et emporte le reste avec elle) ; signe de vie 30 s, 60 s, 120 s (serveur sans 061) ; avec 061, le signe de vie
 *    part avec « quoi de neuf ? » (src/presence.ts), et une requête à part seulement toutes les 10, 20, 30 min s'il n'est pas
 *    parti entre-temps ;
 *  - filet de sécurité, direct abonné : 5 min (calme), 15 min (chargé ou saturé) ;
 *  - filet, direct COUPÉ (ou pas encore abonné) : 60 s, puis 2 min, puis 5 min (et 5 min ensuite), chaque délai allongé au
 *    hasard de 0 à 25 % ; en charge, on part plus haut (chargé : 2 min, saturé : 5 min). Le compte repart de zéro quand le
 *    direct revient.
 * Photos, vidéos, exports, statistiques et assistant : pas différés (noté pour plus tard : ils ne passent pas par la base, ou
 * par le stockage seulement, et les différer demanderait de toucher plusieurs écrans).
 */

export type Niveau = 'calme' | 'charge' | 'sature'
export const NIVEAUX: readonly Niveau[] = ['calme', 'charge', 'sature']
const rang = (n: Niveau) => NIVEAUX.indexOf(n)
const deRang = (r: number): Niveau => NIVEAUX[Math.max(0, Math.min(NIVEAUX.length - 1, r))]

/** Seuils et délais : TOUS les réglages de la charge, ici seulement. */
export const CHARGE_REGLES = {
  // ----- Estimation -----
  /** Durée pendant laquelle un indice compte. */
  fenetreMs: 60_000,
  /** Réponse lente / très lente (une page de 1 000 lignes sur un réseau mobile moyen prend ~1 s). */
  lentMs: 4_000,
  tresLentMs: 15_000,
  /** Points d'un indice. */
  points: {
    /** 429, ou 503 de refus explicite (Retry-After, x-envoy-overloaded) : le serveur dit qu'il est plein. */
    refus: 2,
    /** Autre 503, 504, 408, délai dépassé de l'appareil. */
    erreur: 2,
    /** Coupure réseau en ligne (statut 0 sans délai dépassé) : peut-être le réseau mobile, compte peu. */
    coupure: 0.5,
    lent: 1,
    tresLent: 2,
    /** Synchronisation entière longue / très longue (indices v2). */
    syncLongue: 1,
    syncTresLongue: 2,
    /** Retard du direct / grand retard (indices v2). */
    retard: 1,
    retardTres: 2,
  },
  /** Synchronisation entière longue / très longue. */
  syncLongueMs: 10_000,
  syncTresLongueMs: 30_000,
  /** Retard du direct (réception − heure du signal, au-delà du plus petit retard vu) : retard / grand retard. */
  retardMs: 10_000,
  retardTresMs: 60_000,
  /** Plus petit retard vu retiré (horloge de l'appareil en avance) jusqu'à cette valeur ; au-delà, l'indice n'est pas utilisé. */
  retardBaseMaxMs: 120_000,
  /** Retard au-delà (ou avance au-delà, négatif) : horloge fausse, ignoré. */
  retardIgnoreMs: 30 * 60_000,
  /** Au plus un indice de retard par cette durée. */
  retardEspacementMs: 5_000,
  /** Seuils d'ENTRÉE (points dans la fenêtre) : chargé, saturé. */
  entree: { charge: 4, sature: 10 },
  /** Seuils de SORTIE (en dessous, le niveau peut redescendre d'un cran après calmeAvantDescenteMs). */
  sortie: { charge: 1, sature: 4 },
  /** Temps sans indice suffisant avant de descendre d'un cran. */
  calmeAvantDescenteMs: 120_000,
  /** Retry-After à partir duquel le niveau monte d'office (au moins chargé / saturé). */
  retryAfterChargeMs: 2_000,
  retryAfterSatureMs: 10_000,
  /** Annonce du serveur : durée par défaut et au plus. */
  annonceTtlMs: 5 * 60_000,
  annonceMaxMs: 15 * 60_000,
  // ----- Règles -----
  /** Regroupement des signaux reçus en direct avant relecture. */
  regroupementMs: { calme: 1_500, charge: 5_000, sature: 10_000 } as Record<Niveau, number>,
  /** Étalement au hasard des relectures signalées sur un canal large (commun, staff, tout). */
  largeHasardMs: { calme: 10_000, charge: 20_000, sature: 30_000 } as Record<Niveau, number>,
  /** Envoi de la file quand elle contient une notation, une évaluation ou toute autre modification : toujours ce délai. */
  envoiImmediatMs: 500,
  /** Envoi de la file quand elle ne contient que des « vu » et des traces. */
  envoiDiscretMs: { calme: 500, charge: 10_000, sature: 30_000 } as Record<Niveau, number>,
  /** Signe de vie (hb_ping), serveur sans 061. */
  signeDeVieMs: { calme: 30_000, charge: 60_000, sature: 120_000 } as Record<Niveau, number>,
  /**
   * Signe de vie avec 061 : il part avec chaque « quoi de neuf ? » du registre (toutes les 5 min) ; une requête hb_ping à part
   * seulement s'il n'est pas parti depuis ce délai.
   */
  signeDeVieRegistreMs: { calme: 10 * 60_000, charge: 20 * 60_000, sature: 30 * 60_000 } as Record<Niveau, number>,
  /** Écran Membres ouvert (administrateur) : « qui est là ? » sur le canal du staff, toutes les… */
  presenceDemandeMs: 45_000,
  /** Un appareil répond (hb_ping) seulement si son dernier signe de vie date d'au moins… */
  presenceRepondreMinMs: 30_000,
  /** … après un délai au hasard jusqu'à (pas tous à la même seconde). */
  presenceHasardMs: 10_000,
  /** Registre (061) : filet de 059 (empreintes) une fois par… (et quand le registre n'est pas complet). */
  filetRareMs: 24 * 60 * 60_000,
  /** Registre (061) : vérification des lignes plus visibles et du périmètre une fois par… (et quand les canaux changent). */
  verifRegistreMs: 24 * 60 * 60_000,
  /**
   * Registre (061) : filet rare et vérifications du jour, au plus tôt entre ces deux délais après le lancement (au hasard) :
   * jamais dans la vague des ouvertures du matin.
   */
  rareEtalementMs: [5 * 60_000, 30 * 60_000] as readonly [number, number],
  /** Filet de sécurité, direct abonné. */
  filetDirectMs: { calme: 5 * 60_000, charge: 15 * 60_000, sature: 15 * 60_000 } as Record<Niveau, number>,
  /** Filet, direct coupé : délais successifs (le dernier se répète). */
  filetCoupeMs: [60_000, 2 * 60_000, 5 * 60_000] as readonly number[],
  /** Filet, direct coupé : premier palier selon le niveau (indice dans filetCoupeMs). */
  filetCoupeDepart: { calme: 0, charge: 1, sature: 2 } as Record<Niveau, number>,
  /** Hasard ajouté au filet, direct coupé : jusqu'à cette part du délai. */
  filetHasard: 0.25,
  /**
   * Vérification des lignes plus visibles (identifiants des staffs, groupes, « à revoir », événements : hb_events?select=id
   * et les autres ; src/sync.ts, forgetHidden) : intervalle pendant l'utilisation, selon le niveau.
   */
  verifVisiblesMs: { calme: 10 * 60_000, charge: 30 * 60_000, sature: 60 * 60_000 } as Record<Niveau, number>,
  /** Vérification faite il y a moins que cela (lancement précédent) : pas refaite avant cette échéance. */
  verifVisiblesRepriseMs: 60 * 60_000,
  /** Au lancement, première vérification au hasard entre ces deux délais : jamais pendant l'ouverture, étalée. */
  verifVisiblesEtalementMs: [30_000, 180_000] as readonly [number, number],
}
export type ChargeRegles = typeof CHARGE_REGLES

/** Tables dont l'envoi peut attendre (« vu », traces) ; tout le reste (notations, évaluations…) part tout de suite. */
export const DISCRET_TABLES: readonly string[] = ['seen', 'question_log']

// ---------- Règles ----------

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 0.999999)

/** Regroupement d'un signal reçu (ms) : niveau, et étalement au hasard sur un canal large. */
export function regroupement(niveau: Niveau, large: boolean, rnd: () => number = Math.random, r: ChargeRegles = CHARGE_REGLES): number {
  return r.regroupementMs[niveau] + (large ? Math.floor(clamp01(rnd()) * r.largeHasardMs[niveau]) : 0)
}

/**
 * Délai avant d'envoyer la file (tables des éléments en attente) : une seule table hors DISCRET_TABLES (notation, évaluation,
 * fiche…) et c'est envoiImmediatMs, quel que soit le niveau ; que des « vu » et des traces : envoiDiscretMs du niveau.
 */
export function delaiEnvoi(tables: Iterable<string>, niveau: Niveau, r: ChargeRegles = CHARGE_REGLES): number {
  let any = false
  for (const t of tables) {
    any = true
    if (!DISCRET_TABLES.includes(t)) return r.envoiImmediatMs
  }
  return any ? r.envoiDiscretMs[niveau] : r.envoiImmediatMs
}

/** Intervalle du signe de vie (registre : 061 passé, le signe de vie part avec « quoi de neuf ? »). */
export const delaiSigneDeVie = (niveau: Niveau, r: ChargeRegles = CHARGE_REGLES, registre = false) =>
  registre ? r.signeDeVieRegistreMs[niveau] : r.signeDeVieMs[niveau]

/**
 * « Qui est là ? » (écran Membres d'un administrateur) : l'appareil répond par un signe de vie s'il est affiché, si le serveur
 * est calme et si son dernier signe de vie date d'au moins presenceRepondreMinMs (sinon il est déjà « en ligne »). Un message
 * forgé ne fait donc jamais plus d'un signe de vie par appareil toutes les 30 s (ce que faisait chaque appareil avant 061).
 */
export function doitRepondrePresence(now: number, dernier: number, niveau: Niveau, visible: boolean, r: ChargeRegles = CHARGE_REGLES): boolean {
  return visible && niveau === 'calme' && now - dernier >= r.presenceRepondreMinMs
}

/** Délai au hasard avant de répondre à « qui est là ? ». */
export const delaiReponsePresence = (rnd: () => number = Math.random, r: ChargeRegles = CHARGE_REGLES) => Math.floor(clamp01(rnd()) * r.presenceHasardMs)

/**
 * Heure d'un signal reçu en direct (ms) : la plus récente heure serveur des lignes qu'il porte (horloge du serveur), sinon son
 * heure d'envoi (v, horloge de l'appareil qui écrit) ; null : aucune heure lisible.
 */
export function heureSignal(v: unknown, heuresLignes: readonly unknown[] = []): number | null {
  let best: number | null = null
  for (const h of heuresLignes) {
    const t = typeof h === 'string' ? Date.parse(h) : NaN
    if (Number.isFinite(t) && (best === null || t > best)) best = t
  }
  if (best !== null) return best
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

/** Points d'une synchronisation entière de `ms` (indices v2). */
export function indiceSync(ms: number, r: ChargeRegles = CHARGE_REGLES): number {
  if (!Number.isFinite(ms)) return 0
  return ms >= r.syncTresLongueMs ? r.points.syncTresLongue : ms >= r.syncLongueMs ? r.points.syncLongue : 0
}

/** Points d'un retard du direct déjà corrigé du plus petit retard vu (indices v2). */
export function indiceRetard(excesMs: number, r: ChargeRegles = CHARGE_REGLES): number {
  if (!Number.isFinite(excesMs)) return 0
  return excesMs >= r.retardTresMs ? r.points.retardTres : excesMs >= r.retardMs ? r.points.retard : 0
}

/**
 * Délai du filet de sécurité après une synchronisation complète. live : direct abonné ; coupes : synchronisations complètes
 * faites depuis que le direct est coupé (0 : la première) ; hasard : tirage dans [0, 1) gardé pour ce cycle (direct coupé
 * seulement).
 */
export function delaiFilet(live: boolean, niveau: Niveau, coupes: number, hasard: number, r: ChargeRegles = CHARGE_REGLES): number {
  if (live) return r.filetDirectMs[niveau]
  const steps = r.filetCoupeMs
  const i = Math.min(steps.length - 1, Math.max(0, Math.floor(coupes)) + r.filetCoupeDepart[niveau])
  return Math.round(steps[i] * (1 + r.filetHasard * clamp01(hasard)))
}

/**
 * Vérification des lignes plus visibles : instant de la PREMIÈRE vérification d'un lancement. Au plus tôt dans 30 s à 3 min
 * (au hasard : ni pendant l'ouverture, ni tous les appareils à la même seconde le matin) ; et pas avant une heure après la
 * dernière vérification faite (derniere : son heure, gardée sur l'appareil ; null : jamais, ou illisible).
 * POURQUOI (série 9) : les identifiants des événements visibles (hb_events?select=id), relus à CHAQUE lancement, coûtaient à
 * eux seuls autant de temps de base qu'un « quoi de neuf ? » (1 192 s au palier de 10 000 jour J).
 */
export function premiereVerifVisibles(now: number, derniere: number | null, rnd: () => number = Math.random, r: ChargeRegles = CHARGE_REGLES): number {
  const [min, max] = r.verifVisiblesEtalementMs
  const etale = now + min + Math.floor(clamp01(rnd()) * (max - min))
  const reprise = derniere !== null && Number.isFinite(derniere) && derniere <= now ? derniere + r.verifVisiblesRepriseMs : -Infinity
  return Math.max(etale, reprise)
}

/** Vérification suivante, après une vérification faite maintenant. */
export const prochaineVerifVisibles = (now: number, niveau: Niveau, r: ChargeRegles = CHARGE_REGLES) => now + r.verifVisiblesMs[niveau]

// ---------- Annonce du serveur ----------

export interface Annonce {
  niveau: Niveau
  ttlMs: number
}

/** Lit un message « charge » ({ niveau, ttl? en secondes }) ; null s'il est mal formé. Accents acceptés (chargé, saturé). */
export function lireAnnonce(payload: unknown, r: ChargeRegles = CHARGE_REGLES): Annonce | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = payload as { niveau?: unknown; ttl?: unknown }
  if (typeof p.niveau !== 'string') return null
  const n = p.niveau
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (!(NIVEAUX as readonly string[]).includes(n)) return null
  const ttl = typeof p.ttl === 'number' && Number.isFinite(p.ttl) && p.ttl > 0 ? p.ttl * 1000 : r.annonceTtlMs
  return { niveau: n as Niveau, ttlMs: Math.min(ttl, r.annonceMaxMs) }
}

// ---------- Estimation ----------

/** Une requête vers la base : statut (0 : coupure ou délai dépassé), durée, Retry-After, refus explicite, délai dépassé. */
export interface Observation {
  status: number
  ms: number
  retryAfterMs?: number | null
  refused?: boolean
  timeout?: boolean
}

/** Points d'une observation (0 : rien d'anormal) et niveau minimum qu'elle impose (Retry-After long). */
export function indice(o: Observation, r: ChargeRegles = CHARGE_REGLES): { pts: number; min: Niveau } {
  let pts = 0
  if (o.status === 429 || (o.status === 503 && o.refused)) pts += r.points.refus
  else if (o.status === 503 || o.status === 504 || o.status === 408 || (o.status === 0 && o.timeout)) pts += r.points.erreur
  else if (o.status === 0) pts += r.points.coupure
  // Une réponse en erreur arrivée tard ne compte pas deux fois ; une réponse lente (même 200) est un indice.
  if (pts === 0 && o.status !== 0) {
    if (o.ms >= r.tresLentMs) pts += r.points.tresLent
    else if (o.ms >= r.lentMs) pts += r.points.lent
  }
  const ra = o.retryAfterMs ?? null
  const min: Niveau = ra !== null && ra >= r.retryAfterSatureMs ? 'sature' : ra !== null && ra >= r.retryAfterChargeMs ? 'charge' : 'calme'
  return { pts, min }
}

/**
 * Estimateur du niveau (voir l'en-tête). Horloge injectée (tests) ; aucun minuteur : le niveau est recalculé à chaque
 * observation et à chaque lecture.
 */
export class LoadMeter {
  private obs: { at: number; pts: number; min: number }[] = []
  private lvl = 0
  /** Dernier instant où le niveau courant était justifié (indices au-dessus du seuil de sortie, ou plancher annoncé). */
  private soutenu = 0
  private plancher: { lvl: number; until: number } | null = null
  private readonly r: ChargeRegles
  private readonly now: () => number
  private readonly onChange?: (n: Niveau) => void

  constructor(opts: { regles?: ChargeRegles; now?: () => number; onChange?: (n: Niveau) => void } = {}) {
    this.r = opts.regles ?? CHARGE_REGLES
    this.now = opts.now ?? Date.now
    this.onChange = opts.onChange
  }

  /** Une requête terminée (chaque tentative compte). */
  note(o: Observation) {
    const { pts, min } = indice(o, this.r)
    if (pts > 0 || min !== 'calme') this.obs.push({ at: this.now(), pts, min: rang(min) })
    this.eval()
  }

  /** Synchronisation entière terminée en `ms` (indices v2 ; hors premier chargement et gros envois : à l'appelant). */
  noteSync(ms: number) {
    const pts = indiceSync(ms, this.r)
    if (pts > 0) this.obs.push({ at: this.now(), pts, min: 0 })
    this.eval()
  }

  /** Plus petit retard du direct vu depuis le lancement, et heure du dernier indice de retard. */
  private retardBase: number | null = null
  private dernierRetard = -Infinity

  /** Signal reçu en direct `ms` après son heure (réception − heure du signal ; indices v2). */
  noteRetard(ms: number) {
    if (!Number.isFinite(ms) || Math.abs(ms) > this.r.retardIgnoreMs) return
    this.retardBase = this.retardBase === null ? ms : Math.min(this.retardBase, ms)
    // Plus petit retard vu au-delà de retardBaseMaxMs : horloge de l'appareil fausse (ou ouverture déjà saturée) : cet indice
    // n'est pas utilisé (les autres, et l'annonce du serveur, restent).
    if (this.retardBase > this.r.retardBaseMaxMs) return this.eval()
    const exces = ms - Math.max(this.retardBase, 0)
    const pts = indiceRetard(exces, this.r)
    const t = this.now()
    if (pts > 0 && t - this.dernierRetard >= this.r.retardEspacementMs) {
      this.dernierRetard = t
      this.obs.push({ at: t, pts, min: 0 })
    }
    this.eval()
  }

  /** Message « charge » du serveur (déjà lu par lireAnnonce). */
  annonce(a: Annonce) {
    const t = this.now()
    this.plancher = a.niveau === 'calme' ? null : { lvl: rang(a.niveau), until: t + Math.min(a.ttlMs, this.r.annonceMaxMs) }
    this.eval()
  }

  /** Niveau actuel. */
  niveau(): Niveau {
    this.eval()
    return deRang(this.lvl)
  }

  /** Points dans la fenêtre (affichage, essais). */
  points(): number {
    this.prune(this.now())
    return this.obs.reduce((s, o) => s + o.pts, 0)
  }

  private prune(t: number) {
    const from = t - this.r.fenetreMs
    if (this.obs.length && this.obs[0].at < from) this.obs = this.obs.filter((o) => o.at >= from)
    if (this.plancher && this.plancher.until <= t) this.plancher = null
  }

  private eval() {
    const t = this.now()
    this.prune(t)
    const score = this.obs.reduce((s, o) => s + o.pts, 0)
    const minObs = this.obs.reduce((m, o) => Math.max(m, o.min), 0)
    const floor = this.plancher?.lvl ?? 0
    const parScore = score >= this.r.entree.sature ? 2 : score >= this.r.entree.charge ? 1 : 0
    const cible = Math.max(parScore, minObs, floor)
    const before = this.lvl
    if (cible > this.lvl) {
      this.lvl = cible
      this.soutenu = t
    } else if (this.lvl > 0) {
      const sortie = this.lvl === 2 ? this.r.sortie.sature : this.r.sortie.charge
      if (score >= sortie || minObs >= this.lvl || floor >= this.lvl) this.soutenu = t
      else if (t - this.soutenu >= this.r.calmeAvantDescenteMs) {
        // Un cran seulement ; le suivant attend de nouveau calmeAvantDescenteMs.
        this.lvl--
        this.soutenu = t
      }
    }
    if (this.lvl !== before) this.onChange?.(deRang(this.lvl))
  }
}
