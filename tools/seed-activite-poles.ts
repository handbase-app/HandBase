/*
 * Vie FICTIVE des Pôles Espoirs depuis la rentrée, sur une base EXISTANTE (la base hand de la maison, ou toute base de
 * démonstration) : effectifs de la saison (tools/poles-saison.ts), wellness du matin et « Ma séance » (supabase/073),
 * tests physiques, avis du staff du pôle, quelques notes du « journal du hand », groupes Pôle avec le wellness activé.
 * Proposé à la fédération à la place de MyCoach (Geoffroy, 08/11) : « c'est l'occasion de créer quelque chose qui ressemble ».
 *
 * On part des fiches TELLES QU'ELLES SONT : un extrait en lecture seule de la base (requête `extrait`, un document JSON, gardé
 * HORS du dépôt), puis ce programme écrit des fichiers SQL (HORS du dépôt), déterministes (tirages dérivés des identifiants,
 * identifiants stables) et rejouables (relancer ne change rien ; une ligne touchée par un vrai compte n'est jamais réécrite).
 * Ce que le SQL change :
 *  - fiches (hb_players) : SEULEMENT data.poles et data.boarding, et seulement si data.poles est encore celui de l'extrait
 *    et si la fiche n'a jamais été modifiée par un vrai compte (data.updatedBy, ou une ligne du journal hb_audit avec un
 *    compte) : sinon elle est laissée et comptée ;
 *  - groupes : un groupe Pôle pour chaque unité Pôle qui n'en a pas (créé au nom d'un compte encadrant national de la base,
 *    sinon d'un administrateur), clé « wellness » (et « wellnessSince ») posée sur TOUS les groupes Pôle (deux clés ajoutées,
 *    rien d'autre) ;
 *  - lignes NOUVELLES seulement : tests (hb_measurements), avis spontanés validés (hb_evaluations), wellness et séances
 *    (hb_wellness, hb_wellness_seances, 073), journal (hb_player_journal) ; marquées data.demoSeed = 'poles-2026' (ou
 *    user_id vide pour les tables du jeune) ; jamais par-dessus une ligne d'un vrai compte ;
 *  - comptes (Geoffroy, 09/11 : « comme si c'était vrai », aucun mode démonstration) : un VRAI compte joueur par jeune du
 *    pôle (auth.users, auth.identities, hb_profiles rôle joueur relié à la fiche, charte du joueur acceptée, journal), adresse
 *    j-<8 caractères>@nextar-essai.test, mot de passe commun : seule son empreinte bcrypt (pgcrypto) entre dans le SQL ; le
 *    mot de passe (JOUEURS_POLES_MDP) et l'empreinte (JOUEURS_POLES_MDP_BCRYPT) sont dans secrets/comptes-hand.env de
 *    nextar-serveur, la liste des comptes (adresse, site, classe, fiche ; aucun nom) écrite à côté.
 * Le réglage d'installation (hb_config « wellness » : { actif: true }, comme une installation réelle) est un fichier à part
 * (interrupteur et retour).
 * Vacances de la Toussaint : environ la moitié des jeunes restent actifs (club, stage, footing ; formeVacances), pour que le
 * rapport de charge aiguë / chronique à la reprise soit varié.
 * Données de santé FICTIVES seulement (aucun jeune réel) ; aucun nom réel ; marqueurs positifs ou neutres (sorties : « fin de
 * cursus ») ; jamais envoyé à une IA.
 *
 * Relancer :
 *   npx jiti tools/seed-activite-poles.ts extrait > <dossier>/extrait.sql      requête de l'extrait (lecture seule)
 *   psql … -X -q -t -A -f <dossier>/extrait.sql > <dossier>/extrait.json        (ou sur une sauvegarde restaurée)
 *   npx jiti tools/seed-activite-poles.ts <dossier>/extrait.json <dossier> [--jusqu-au AAAA-MM-JJ] [--comptes <secrets/comptes-hand.env>]
 *       → 01_poles_joueurs.sql, 02_groupes_wellness.sql, 03_reglage_wellness.sql (+ _retour), 04_tests_avis.sql,
 *         05_wellness_seances.sql, 06_journal.sql, 08_comptes_joueurs.sql (avec --comptes), activite-poles.sql (01 + 02 +
 *         04 + 05 + 06 + 08 en un seul fichier, pour outils/appliquer-sql.sh qui ajoute begin / commit),
 *         07_retour_arriere.sql, dry-run.sql / apply.sql (essai local avec \ir), verify.sql ; avec --comptes, aussi
 *         comptes-joueurs-poles.csv dans le dossier des secrets.
 *   Mot de passe commun et empreinte : tirés une fois (openssl rand, puis extensions.crypt(…, extensions.gen_salt('bf'))
 *   dans une base jetable), ajoutés à secrets/comptes-hand.env ; jamais affichés.
 * Tests : npx jiti tools/test-seed-activite-poles.ts
 */
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PolePeriod } from '../src/db'
import { accord } from '../src/gender'
import { chargeSummary, chargeTone } from '../src/wellness'
import { POLE_SITES, type PoleSite } from '../src/poles'
import { categoryOf, FAMOUS, RANGES, type Cat } from './seed-hand'
import { insideRepo } from './seed-rencontres'
import { clamp, FIRST_F, FIRST_M, fold, hash32, LASTNAMES, parisIso, rng } from './seed-volley'
import {
  ANNEE_SORTIS,
  ANNEES_POLE,
  planifierPoles,
  regionOfDept,
  siteKey,
  type Candidat,
  type Plan,
} from './poles-saison'

// ---------- Constantes ----------

export const MARQUE = 'poles-2026'
/** Nom porté par les fiches écrites (data.updatedByName) et le réglage. */
export const AUTEUR = 'Données fictives (pôles)'
/** Auteur des lignes d'origine de la base (import SQL) : pas un vrai compte. */
const SQL_ADMIN = 'Administration Supabase (SQL)'
export const DEBUT = '2026-09-01'
/** Domaine réservé aux essais (.test : jamais délivré, aucun courrier ne part) : celui des comptes de la pile hand. */
export const DOMAINE_COMPTES = 'nextar-essai.test'
/** Version de la charte du joueur acceptée d'office : PLAYER_CHARTER_VERSION de src/pages/Privacy.tsx (fichier React, pas
 * importé ici ; le test vérifie que les deux sont égales). */
export const PLAYER_CHARTER_VERSION = 2
export const FIN_DEFAUT = '2026-11-08'
/** Vacances de la Toussaint 2026 (toutes zones) : du samedi 17 octobre au lundi 2 novembre (reprise). */
export const VACANCES: [string, string] = ['2026-10-17', '2026-11-01']
const SEED = 'nextar-activite-poles-2026'

// ---------- Outils ----------

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
/** 0 = dimanche … 6 = samedi. */
export const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
export const enVacances = (day: string) => day >= VACANCES[0] && day <= VACANCES[1]
/** Jour où le wellness est demandé : lundi → vendredi, hors vacances. */
export const jourDemande = (day: string) => dow(day) >= 1 && dow(day) <= 5 && !enVacances(day)
const jours = (from: string, to: string) => {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Tirages d'une entité (flux propre à une clé : stable même si l'ordre de génération change). */
export class Tirage {
  private r: () => number
  constructor(...key: (string | number)[]) {
    this.r = rng(hash32(`${SEED}:${key.join(':')}`))
  }
  next = () => this.r()
  between = (a: number, b: number) => a + this.r() * (b - a)
  int = (a: number, b: number) => a + Math.floor(this.r() * (b - a + 1))
  chance = (p: number) => this.r() < p
  pick = <T>(xs: readonly T[]) => xs[Math.floor(this.r() * xs.length)]
  normal = () => {
    const u = Math.max(1e-12, this.r())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.r())
  }
  weighted = (ws: readonly number[]) => {
    const tot = ws.reduce((s, x) => s + x, 0)
    let x = this.r() * tot
    for (let i = 0; i < ws.length; i++) {
      x -= ws[i]
      if (x < 0) return i
    }
    return ws.length - 1
  }
}

/** Identifiant stable au format UUID (v5 : SHA-1 d'une clé), propre à ce jeu. */
export function uuidDe(key: string): string {
  const h = createHash('sha1').update(`nextar-activite-poles/${key}`).digest('hex')
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}
/** Identifiant court (journal du jeune : 11 caractères, comme l'appli). */
const idCourt = (key: string) => createHash('sha1').update(`nextar-activite-poles/${key}`).digest('base64url').slice(0, 11)

// ---------- Extrait de la base (lecture seule) ----------

/** Une fiche de l'extrait (tableau compact). */
export type JoueurBrut = [
  id: string,
  sexe: string | null,
  naissance: string | null,
  dept: string | null,
  club: string | null,
  poste: string | null,
  poles: PolePeriod[] | null,
  fige: number,
  mesures: number,
  testsReels: number,
  avis: number,
  compte: number,
  boarding: boolean | null,
  /** « Modifié par » de la fiche quand elle n'a jamais été modifiée par un vrai compte (libellé d'import, pas une personne) :
   * le retour arrière le remet. Absent des extraits d'avant le 09/11. */
  auteur?: string | null,
]
export interface Extrait {
  genere: string
  joueurs: JoueurBrut[]
  /** Unités Pôle : [id, nom, site, sexe, code]. */
  unites: [string, string, string | null, string | null, string | null][]
  /** Groupes Pôle : [id, unité, créateur, wellness, supprimé]. */
  groupes: [string, string, string | null, boolean, boolean][]
  /** Critères subjectifs : [id, catégorie, postes, rapide]. */
  criteres: [string, string | null, string[] | null, boolean][]
  /** Critères des tests physiques connus de la base. */
  tests: string[]
  /** Compte au nom duquel les nouveaux groupes Pôle sont créés : [id, nom] (encadrant national, sinon administrateur). */
  createur: [string, string] | null
  /** Dernière valeur par fiche et par test : [fiche, test, date, valeur]. */
  derniers: [string, string, string, number][]
  /** Jours où une fiche a déjà des tests depuis la rentrée : [fiche, jour]. */
  joursMesures: [string, string][]
}

/** Tests physiques que ce jeu sait écrire (valeurs plausibles par sexe et catégorie). */
export const TESTS_ACTIVITE = ['taille', 'poids', 'taille_assise', 'envergure', 'empan', 'sprint_10', 'sprint_30', 't_test', 'vift', 'cmj_hauteur', 'medball_conc'] as const
type TestId = (typeof TESTS_ACTIVITE)[number]

/** Requête de l'extrait : un document JSON sur une ligne (psql -X -q -t -A). Lecture seule. */
export function extraitSql(): string {
  const tests = TESTS_ACTIVITE.map((t) => `'${t}'`).join(', ')
  return `-- Extrait pour tools/seed-activite-poles.ts : LECTURE SEULE, un document JSON (psql -X -q -t -A -f extrait.sql > extrait.json).
-- Fiches des années ${ANNEE_SORTIS}-${ANNEES_POLE[0]} ou qui ont une période de pôle : identifiant, sexe, naissance, département et club (n° de club,
-- colonnes de périmètre), poste, périodes de pôle, modifiée par un vrai compte (data.updatedBy ou journal avec un compte),
-- « modifié par » d'une fiche jamais modifiée par un vrai compte (libellé d'import, remis par le retour arrière),
-- nombre de tests (hors taille déclarée de la licence), traces d'un vrai compte (tests saisis depuis juin, listes de ses
-- événements de la saison : ces fiches restent au pôle de préférence), avis, compte joueur relié (sauf les comptes joueurs
-- fictifs créés par ce jeu : app_metadata.demoSeed = '${MARQUE}'). Aucun nom.
-- Les lignes de ce jeu (demoSeed = '${MARQUE}') ne comptent pas comme des tests existants : relancer redonne les mêmes.
begin transaction read only;
with mes as (
  select m.data ->> 'playerId' pid, count(*) n, count(*) filter (where m.data ? 'createdBy' and m.data ->> 'date' >= '${DEBUT.slice(0, 4)}-06-01') reel
    from public.hb_measurements m
   where not m.deleted and coalesce(m.data ->> 'author', '') <> 'Licence FFHB (déclarée)' group by 1),
av as (select data ->> 'playerId' pid, count(*) n from public.hb_evaluations where not deleted group by 1),
evt as (select x.pid, count(*) n from public.hb_events e cross join lateral jsonb_array_elements_text(coalesce(e.data -> 'playerIds', '[]'::jsonb)) x(pid)
         where not e.deleted and e.data ? 'createdBy' and e.data ->> 'date' >= '${DEBUT}' group by 1),
aud as (select distinct row_id from public.hb_audit where table_name = 'players' and user_id is not null),
cpt as (select distinct pr.player_id from public.hb_profiles pr left join auth.users u on u.id = pr.user_id
         where pr.player_id is not null and coalesce(u.raw_app_meta_data ->> 'demoSeed', '') <> '${MARQUE}'),
j as (
  select p.id, p.data, p.scope_dept, p.scope_club, (p.data ? 'updatedBy' or a.row_id is not null) fige,
         coalesce(mes.n, 0) n_mes, coalesce(mes.reel, 0) + coalesce(evt.n, 0) n_reel, coalesce(av.n, 0) n_avis, c.player_id is not null compte
    from public.hb_players p left join mes on mes.pid = p.id left join av on av.pid = p.id left join evt on evt.pid = p.id
    left join aud a on a.row_id = p.id left join cpt c on c.player_id = p.id
   where not p.deleted and (p.data ? 'poles' or left(p.data ->> 'birthDate', 4) between '${ANNEE_SORTIS}' and '${ANNEES_POLE[0]}')),
fed as (select id from public.hb_units where not deleted and data ->> 'levelId' = 'niveau-federation')
select jsonb_build_object(
  'genere', now(),
  'joueurs', coalesce((select jsonb_agg(jsonb_build_array(id, data ->> 'sex', data ->> 'birthDate', scope_dept, scope_club, data ->> 'position',
               data -> 'poles', fige::int, n_mes, n_reel, n_avis, compte::int, data -> 'boarding',
               case when not fige then coalesce(data ->> 'updatedByName', '') end) order by id) from j), '[]'),
  'unites', coalesce((select jsonb_agg(jsonb_build_array(id, data ->> 'name', data ->> 'poleSite', data ->> 'poleSex', data ->> 'code') order by id)
               from public.hb_units where not deleted and data ->> 'levelId' = 'niveau-pole'), '[]'),
  'groupes', coalesce((select jsonb_agg(jsonb_build_array(id, data ->> 'poleUnitId', data ->> 'createdBy', coalesce(data -> 'wellness' = 'true'::jsonb, false), deleted) order by id)
               from public.hb_groups where coalesce(data ->> 'poleUnitId', '') <> ''), '[]'),
  'criteres', coalesce((select jsonb_agg(jsonb_build_array(id, data ->> 'category', data -> 'positions', coalesce(data ->> 'quick', '') = 'true') order by id)
               from public.hb_criteria where not deleted and data ->> 'kind' = 'subjective' and coalesce(data ->> 'active', 'true') <> 'false'), '[]'),
  'tests', coalesce((select jsonb_agg(id order by id) from public.hb_criteria where not deleted and id in (${tests})), '[]'),
  'createur', (select jsonb_build_array(pr.user_id, pr.full_name) from public.hb_profiles pr
                where pr.role in ('preparateur', 'admin')
                order by (pr.role = 'preparateur' and exists (select 1 from public.hb_assignments a where not a.deleted and a.data ->> 'userId' = pr.user_id::text
                           and a.data ->> 'unitId' in (select id from fed) and coalesce(a.data ->> 'role', '') <> 'observateur')) desc,
                         (pr.role = 'admin') desc, pr.created_at, pr.user_id limit 1),
  'derniers', coalesce((select jsonb_agg(jsonb_build_array(pid, crit, d, v)) from (
               select distinct on (m.data ->> 'playerId', m.data ->> 'criterionId') m.data ->> 'playerId' pid, m.data ->> 'criterionId' crit,
                      m.data ->> 'date' d, (m.data ->> 'value')::numeric v
                 from public.hb_measurements m join j on j.id = m.data ->> 'playerId'
                where not m.deleted and m.data ->> 'criterionId' in (${tests}) and jsonb_typeof(m.data -> 'value') = 'number'
                  and coalesce(m.data ->> 'demoSeed', '') <> '${MARQUE}'
                order by m.data ->> 'playerId', m.data ->> 'criterionId', m.data ->> 'date' desc) x), '[]'),
  'joursMesures', coalesce((select jsonb_agg(jsonb_build_array(pid, d)) from (
               select distinct m.data ->> 'playerId' pid, m.data ->> 'date' d from public.hb_measurements m join j on j.id = m.data ->> 'playerId'
                where not m.deleted and m.data ->> 'date' >= '${DEBUT}' and coalesce(m.data ->> 'demoSeed', '') <> '${MARQUE}') x), '[]')
)::text;
commit;
`
}

// ---------- Entrée normalisée ----------

export interface Joueur {
  id: string
  sexe: 'M' | 'F'
  naissance: string
  annee: number
  dept: string
  club: string
  poste?: string
  poles?: PolePeriod[]
  boarding?: boolean
  auteur?: string
  fige: boolean
  mesures: number
  testsReels: number
  avis: number
  compte: boolean
}
export interface Unite {
  id: string
  nom: string
  site: PoleSite
}
export interface Entree {
  joueurs: Joueur[]
  unites: Unite[]
  groupes: { id: string; uniteId: string; createur?: string; wellness: boolean; supprime: boolean }[]
  criteres: { id: string; category: string; positions?: string[]; quick: boolean }[]
  tests: Set<string>
  createur: { id: string; nom: string } | null
  derniers: Map<string, Map<string, { date: string; valeur: number }>>
  joursMesures: Map<string, Set<string>>
}

export function lireExtrait(x: Extrait): Entree {
  const joueurs: Joueur[] = []
  for (const r of x.joueurs) {
    const [id, sexe, naissance, dept, club, poste, poles, fige, mesures, testsReels, avis, compte, boarding, auteur] = r
    if ((sexe !== 'M' && sexe !== 'F') || !naissance || !/^\d{4}-\d{2}-\d{2}$/.test(naissance)) continue
    joueurs.push({
      id, sexe, naissance, annee: Number(naissance.slice(0, 4)), dept: dept ?? '', club: club ?? '', ...(poste ? { poste } : {}),
      ...(Array.isArray(poles) && poles.length ? { poles } : {}), ...(typeof boarding === 'boolean' ? { boarding } : {}),
      ...(typeof auteur === 'string' ? { auteur } : {}),
      fige: !!fige, mesures, testsReels, avis, compte: !!compte,
    })
  }
  const unites: Unite[] = []
  for (const [id, nom, site, sexe] of x.unites) {
    const s = POLE_SITES.find((p) => p.sex === sexe && fold(p.site) === fold(site ?? ''))
    if (s) unites.push({ id, nom, site: s })
  }
  const derniers = new Map<string, Map<string, { date: string; valeur: number }>>()
  for (const [pid, crit, date, valeur] of x.derniers) {
    const m = derniers.get(pid) ?? new Map()
    m.set(crit, { date, valeur: Number(valeur) })
    derniers.set(pid, m)
  }
  const joursMesures = new Map<string, Set<string>>()
  for (const [pid, d] of x.joursMesures) joursMesures.set(pid, (joursMesures.get(pid) ?? new Set()).add(d))
  return {
    joueurs,
    unites,
    groupes: x.groupes.map(([id, uniteId, createur, wellness, supprime]) => ({ id, uniteId, ...(createur ? { createur } : {}), wellness, supprime })),
    criteres: x.criteres.map(([id, category, positions, quick]) => ({ id, category: category ?? '', ...(positions?.length ? { positions } : {}), quick })),
    tests: new Set(x.tests),
    createur: x.createur ? { id: x.createur[0], nom: x.createur[1] } : null,
    derniers,
    joursMesures,
  }
}

// ---------- Effectifs ----------

/** Mérite d'une fiche existante : un peu de hasard propre, déjà mesurée ou vue, âge relatif, club fourni. */
export function candidats(e: Entree): Candidat[] {
  const parClub = new Map<string, number>()
  for (const j of e.joueurs) parClub.set(`${j.club}:${j.sexe}`, (parClub.get(`${j.club}:${j.sexe}`) ?? 0) + 1)
  return e.joueurs.map((j) => {
    const t = new Tirage('merite', j.id)
    const ra = (Date.parse(`${j.naissance}T12:00:00Z`) - Date.parse(`${j.annee}-01-01T12:00:00Z`)) / (365 * 864e5)
    const merite =
      0.7 * t.normal() + (j.mesures > 0 ? 0.5 : 0) + (j.avis > 0 ? 0.3 : 0) + (j.sexe === 'M' ? 0.6 : 0.45) * (0.5 - ra) + 0.7 * Math.log(1 + (parClub.get(`${j.club}:${j.sexe}`) ?? 0) / 6)
    return {
      id: j.id, sexe: j.sexe, annee: j.annee, dept: j.dept, region: regionOfDept(j.dept), ...(j.poste ? { poste: j.poste } : {}), club: j.club, merite,
      ...(j.poles ? { poles: j.poles } : {}), ...(j.boarding !== undefined ? { boarding: j.boarding } : {}), fige: j.fige, testsReels: j.testsReels,
    }
  })
}

// ---------- Staff fictif des pôles (aucun compte : noms inventés) ----------

export interface StaffPole {
  id: string
  nom: string
  role: 'entraineur' | 'preparateur'
}
export function staffDuPole(s: PoleSite): StaffPole[] {
  const out: StaffPole[] = []
  for (const role of ['entraineur', 'preparateur'] as const) {
    const t = new Tirage('staff', siteKey(s), role)
    let nom = ''
    do {
      const f = t.chance(role === 'entraineur' && s.sex === 'F' ? 0.5 : 0.3)
      nom = `${t.pick(f ? FIRST_F : FIRST_M)} ${t.pick(LASTNAMES)}`
    } while (FAMOUS.has(fold(nom)))
    out.push({ id: uuidDe(`staff:${siteKey(s)}:${role}`), nom, role })
  }
  return out
}

// ---------- Séances du pôle et matchs ----------

export interface Seance {
  jour: string
  rpe: number
  duree: number
  /** Notée par le jeune (sinon faite, mais pas notée). */
  notee: boolean
  /** Heure où elle a été notée (ISO). */
  at: string
  type: 'hand' | 'muscu' | 'tests' | 'match' | 'club' | 'reathle' | 'stage' | 'perso'
}

/** Semaine (lundi) d'un jour. */
const lundi = (day: string) => addDays(day, -((dow(day) + 6) % 7))
/** Intensité de la semaine : reprise en douceur, préparation physique de septembre, semaine avant les vacances, reprise. */
function facteurSemaine(day: string): { rpe: number; duree: number } {
  const l = lundi(day)
  if (l <= '2026-08-31') return { rpe: -1, duree: 0.85 }
  if (l <= '2026-09-14') return { rpe: 0.5, duree: 1.05 }
  if (l === '2026-10-12') return { rpe: -0.3, duree: 0.95 }
  if (l === '2026-11-02') return { rpe: -0.5, duree: 0.9 }
  return { rpe: 0, duree: 1 }
}

// ---------- Douleurs ----------

export interface Douleur {
  zone: string
  cote?: 'g' | 'd'
  type: 'courbatures' | 'gene' | 'douleur' | 'contracture' | 'coup' | 'autre'
  texte?: string
  intensite: number
}
interface Episode {
  debut: string
  jours: number
  pic: number
  zone: string
  cote?: 'g' | 'd'
  type: Douleur['type']
  texte?: string
  /** Jours sans douleur au milieu (tendinopathie : un jour sur deux à peu près). */
  intermittent?: boolean
  /** Longue blessure : séances adaptées (réathlétisation) pendant la première partie. */
  longue?: boolean
}
const PAIRES = new Set(['epaule', 'bras', 'coude', 'poignet', 'main', 'hanche', 'aine', 'fessiers', 'quadriceps', 'ischios', 'adducteurs', 'genou', 'tibia', 'mollet', 'achille', 'cheville', 'pied'])
/** Épisodes courants : endroit, ce que c'est, intensité au début, durée (jours), départ un lundi (après un match). */
const EPISODES: { w: number; zone: string; type: Douleur['type']; pic: [number, number]; jours: [number, number]; texte?: string; lundi?: boolean; intermittent?: boolean; gb?: boolean }[] = [
  { w: 16, zone: 'ischios', type: 'contracture', pic: [5, 7], jours: [4, 7] },
  { w: 8, zone: 'mollet', type: 'contracture', pic: [4, 6], jours: [3, 5] },
  { w: 14, zone: 'lombaires', type: 'gene', pic: [2, 3], jours: [3, 8] },
  { w: 12, zone: 'genou', type: 'douleur', pic: [3, 4], jours: [10, 20], intermittent: true },
  { w: 10, zone: 'quadriceps', type: 'coup', pic: [4, 5], jours: [2, 4], lundi: true },
  { w: 10, zone: 'cheville', type: 'douleur', pic: [5, 7], jours: [7, 12], texte: 'Entorse', lundi: true },
  { w: 8, zone: 'epaule', type: 'douleur', pic: [3, 4], jours: [5, 10] },
  { w: 6, zone: 'main', type: 'coup', pic: [3, 5], jours: [3, 6], gb: true },
  { w: 7, zone: 'adducteurs', type: 'gene', pic: [3, 3], jours: [5, 10] },
  { w: 5, zone: 'tibia', type: 'douleur', pic: [3, 4], jours: [7, 14] },
  { w: 4, zone: 'achille', type: 'gene', pic: [2, 3], jours: [5, 10] },
  { w: 3, zone: 'poignet', type: 'douleur', pic: [3, 4], jours: [3, 6] },
  { w: 3, zone: 'tete', type: 'coup', pic: [3, 3], jours: [1, 2], lundi: true },
]
const LONGUES: Omit<Episode, 'debut'>[] = [
  { zone: 'cheville', type: 'douleur', texte: 'Entorse (attelle)', pic: 6, jours: 32, longue: true },
  { zone: 'aine', type: 'douleur', texte: 'Pubalgie', pic: 5, jours: 38, longue: true },
  { zone: 'main', type: 'autre', texte: 'Fracture d’un doigt (attelle)', pic: 4, jours: 30, longue: true },
  { zone: 'lombaires', type: 'douleur', pic: 5, jours: 30, longue: true },
  { zone: 'genou', type: 'douleur', texte: 'Maladie d’Osgood-Schlatter', pic: 5, jours: 40, longue: true },
]
/** Intensité d'un épisode ce jour-là (0 : rien). */
export function intensiteEpisode(e: Episode, day: string, id: string): number {
  const t = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${e.debut}T12:00:00Z`)) / 864e5)
  if (t < 0 || t >= e.jours) return 0
  if (e.intermittent && t > 0 && new Tirage('inter', id, e.debut, day).chance(0.45)) return 0
  const v = Math.round(e.pic - (e.pic - 1) * (t / e.jours) ** 0.9)
  return Math.max(1, Math.min(10, v))
}

// ---------- Profil de chaque jeune ----------

export interface Profil {
  /** Probabilité de répondre un jour demandé (classe de remplissage). */
  remplissage: number
  classe: 'toujours' | 'souvent' | 'parfois'
  /** Probabilité de noter une séance faite. */
  notation: number
  base: Record<'energie' | 'fraicheur' | 'humeur' | 'sommeil', number>
  ecart: number
  episodes: Episode[]
  /** Heure habituelle de réponse (minutes après minuit, heure de Paris). */
  heure: number
}
export function profilDe(id: string, poste?: string): Profil {
  const t = new Tirage('profil', id)
  const u = t.next()
  const classe = u < 0.08 ? 'toujours' : u < 0.9 ? 'souvent' : 'parfois'
  const remplissage = classe === 'toujours' ? 1 : classe === 'souvent' ? t.between(0.8, 0.97) : t.between(0.48, 0.68)
  const notation = classe === 'toujours' ? t.between(0.9, 1) : classe === 'souvent' ? t.between(0.72, 0.95) : t.between(0.35, 0.6)
  const b = t.between(5.9, 7.6)
  const base = {
    energie: b + t.between(-0.4, 0.4),
    fraicheur: b - 0.2 + t.between(-0.5, 0.4),
    humeur: b + 0.3 + t.between(-0.4, 0.5),
    sommeil: b - 0.1 + t.between(-0.8, 0.6),
  }
  const ecart = t.between(0.6, 1.15)
  // Épisodes courts : 0 à 3, départ entre le 7 septembre et la mi-décembre (indépendant de la date de fin : prolonger la
  // période ne change pas les jours déjà écrits).
  const episodes: Episode[] = []
  const n = t.weighted([0.33, 0.4, 0.21, 0.06])
  const cands = EPISODES.filter((x) => !x.gb || poste === 'GB')
  for (let k = 0; k < n; k++) {
    const x = cands[t.weighted(cands.map((c) => c.w * (c.zone === 'epaule' && poste === 'GB' ? 0.3 : 1)))]
    let debut = addDays('2026-09-07', t.int(0, 100))
    if (x.lundi) debut = addDays(lundi(debut), 7)
    episodes.push({
      debut, jours: t.int(x.jours[0], x.jours[1]), pic: t.int(x.pic[0], x.pic[1]), zone: x.zone, type: x.type,
      ...(PAIRES.has(x.zone) ? { cote: t.chance(0.5) ? 'g' : 'd' } : {}), ...(x.texte ? { texte: x.texte } : {}), ...(x.intermittent ? { intermittent: true } : {}),
    })
  }
  // Une poignée de longues blessures (~3 %).
  if (t.chance(0.03)) {
    const x = t.pick(LONGUES)
    episodes.push({ ...x, debut: addDays('2026-09-14', t.int(0, 30)), ...(PAIRES.has(x.zone) ? { cote: t.chance(0.5) ? 'g' : 'd' } : {}) })
  }
  return { remplissage, classe, notation, base, ecart, episodes, heure: t.chance(0.1) ? t.int(12 * 60, 13 * 60) : t.int(6 * 60 + 35, 8 * 60 + 25) }
}

// ---------- Une journée ----------

export interface Reponse {
  jour: string
  scores: Record<'energie' | 'fraicheur' | 'humeur' | 'sommeil', number>
  douleurs: Douleur[]
  at: string
}
export interface VieJoueur {
  id: string
  reponses: Reponse[]
  seances: Seance[]
  /** Jours demandés (lundi → vendredi hors vacances) de la période. */
  demandes: number
}

const note = (x: number) => Math.max(1, Math.min(10, Math.round(x)))
const r5 = (x: number) => Math.max(5, Math.round(x / 5) * 5)

/** Programme du pôle : séances par jour de semaine (1 = lundi … 5 = vendredi). */
export function programmeSite(s: PoleSite) {
  const t = new Tirage('programme', siteKey(s))
  const mercrediLibre = t.chance(0.4)
  return {
    mercrediLibre,
    jours: {
      1: [{ type: 'hand' as const, duree: 100, rpe: 6 }],
      2: [{ type: 'muscu' as const, duree: 60, rpe: 5 }, { type: 'hand' as const, duree: 105, rpe: 7 }],
      3: mercrediLibre ? [] : [{ type: 'hand' as const, duree: 75, rpe: 5 }],
      4: [{ type: 'muscu' as const, duree: 60, rpe: 6 }, { type: 'hand' as const, duree: 105, rpe: 7 }],
      5: [{ type: 'hand' as const, duree: 80, rpe: 5 }],
    } as Record<number, { type: Seance['type']; duree: number; rpe: number }[]>,
  }
}

/** Jour des tests d'un site dans une fenêtre (jour de semaine, stable) ; aucun avant la date de fin si elle est dépassée. */
function jourDansFenetre(key: string, nom: string, a: string, b: string, fin: string): string | undefined {
  const ds = jours(a, b).filter((d) => dow(d) >= 1 && dow(d) <= 5 && dow(d) !== 3)
  const d = ds[hash32(`${key}:${nom}`) % ds.length]
  return d && d < fin ? d : undefined
}
export interface Calendrier {
  rentree?: string
  octobre?: string
  reprise?: string
}
export function calendrierTests(s: PoleSite, fin: string): Calendrier {
  const key = siteKey(s)
  return {
    rentree: jourDansFenetre(key, 'rentree', '2026-09-08', '2026-09-17', fin),
    octobre: jourDansFenetre(key, 'octobre', '2026-10-06', '2026-10-15', fin),
    reprise: jourDansFenetre(key, 'reprise', '2026-11-03', '2026-11-06', fin),
  }
}

/**
 * Vacances de la Toussaint (17 octobre → 1er novembre) : pas de pôle, mais environ la moitié des jeunes restent actifs, de
 * façon variée (Geoffroy, 09/11 : que le rapport charge aiguë / chronique à la reprise ne soit pas ~2 pour tout le monde) :
 *  - club (~22 %) : entraînements du club deux soirs par semaine et un match ou un tournoi certains week-ends ;
 *  - stage (~13 %) : un stage de 3 ou 4 jours (ligue ou club, deux séances par jour) une des deux semaines, plus un
 *    entraînement du club l'autre semaine ;
 *  - perso (~15 %) : footing, renforcement ou futsal entre copains, deux ou trois fois par semaine, plus léger ;
 *  - repos (~50 %) : rien.
 * Jamais pendant une longue blessure ni un jour malade ; reprise du championnat avec le club le dernier week-end pour une
 * partie des jeunes « club ».
 */
export type FormeVacances = 'repos' | 'club' | 'stage' | 'perso'
export function formeVacances(id: string): FormeVacances {
  const u = new Tirage('vacances', id).next()
  return u < 0.22 ? 'club' : u < 0.35 ? 'stage' : u < 0.5 ? 'perso' : 'repos'
}
function seancesVacances(j: Pick<Joueur, 'id' | 'club'>, d: string, forme: FormeVacances): Omit<Seance, 'notee' | 'at'>[] {
  if (forme === 'repos') return []
  const w = dow(d)
  const t = new Tirage('vacances-jour', j.id, d)
  const semaine2 = d >= '2026-10-24'
  const out: Omit<Seance, 'notee' | 'at'>[] = []
  const soirs = hash32(`soirs:${j.club}`) % 2 === 0 ? [2, 4] : [1, 3]
  const clubSoir = () => out.push({ jour: d, type: 'club', duree: r5(t.between(80, 110)), rpe: note(t.between(5.3, 7.2)) })
  if (forme === 'club') {
    // Deux soirs par semaine, et souvent une matinée de plus le vendredi (« stage club » des vacances).
    if ((soirs.includes(w) && t.chance(0.85)) || (w === 5 && t.chance(0.5))) clubSoir()
    // Week-end : tournoi ou match amical le premier, reprise du championnat pour certains le dernier (31/10 – 1/11).
    const we = lundi(d)
    const jourMatch = hash32(`${j.club}:${we}`) % 2 === 0 ? 6 : 0
    const tm = new Tirage('vacances-match', j.id, we)
    if (w === jourMatch && tm.chance(we === '2026-10-26' ? 0.6 : 0.45))
      out.push({ jour: d, type: 'match', duree: r5(tm.chance(0.35) ? tm.between(110, 150) : tm.between(65, 90)), rpe: note(tm.between(6.8, 8.8)) })
  } else if (forme === 'stage') {
    const ts = new Tirage('vacances-stage', j.id)
    const deuxieme = ts.chance(0.5)
    const debut = deuxieme ? '2026-10-26' : '2026-10-19'
    const n = ts.int(3, 4)
    const k = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${debut}T12:00:00Z`)) / 864e5)
    if (k >= 0 && k < n) {
      out.push({ jour: d, type: 'stage', duree: r5(t.between(80, 100)), rpe: note(t.between(5.5, 7)) })
      if (k < n - 1 || t.chance(0.5)) out.push({ jour: d, type: 'stage', duree: r5(t.between(80, 105)), rpe: note(t.between(6, 7.8)) })
    } else if (soirs.includes(w) && t.chance(semaine2 !== deuxieme ? 0.75 : 0.5)) clubSoir()
  } else {
    const jours = new Tirage('vacances-perso', j.id).chance(0.5) ? [1, 3, 5] : [2, 6]
    if (jours.includes(w) && t.chance(0.8))
      out.push({ jour: d, type: 'perso', duree: r5(t.between(40, 75)), rpe: note(t.between(4.5, 6.5)) })
  }
  return out
}

/**
 * Vie d'un jeune du 1er septembre à `fin` (inclus pour le wellness du matin ; les séances jusqu'à la veille) : séances faites
 * (le jeune en note la plupart), matchs du week-end avec son club, fatigue le lendemain des grosses journées (fraîcheur
 * plus basse, courbatures, surtout le lundi après un match), nuits courtes, petits coups de moins bien, épisodes de douleur
 * qui baissent jour après jour, longues blessures (séances adaptées).
 */
export function vieDe(j: Pick<Joueur, 'id' | 'poste' | 'club'>, s: PoleSite, fin: string, cal: Calendrier = calendrierTests(s, fin)): VieJoueur {
  const p = profilDe(j.id, j.poste)
  const prog = programmeSite(s)
  const faites = new Map<string, Seance[]>()
  const charge = (d: string) => (faites.get(d) ?? []).reduce((a, x) => a + x.rpe * x.duree, 0)
  const intensites = (d: string) => p.episodes.map((e) => ({ e, v: intensiteEpisode(e, d, j.id) })).filter((x) => x.v > 0)
  const malade = (d: string) => new Tirage('malade', j.id, d).chance(0.012)
  const testsLe = new Set([cal.rentree, cal.octobre, cal.reprise].filter(Boolean) as string[])
  const seances: Seance[] = []
  const vac = formeVacances(j.id)
  for (const d of jours(DEBUT, addDays(fin, -1))) {
    const t = new Tirage('seances', j.id, d)
    const actifs = intensites(d)
    const longue = actifs.find((x) => x.e.longue)
    if (enVacances(d)) {
      // Vacances : ce que le jeune fait de lui-même (club, stage, footing) ; rien s'il est blessé ou malade.
      const forte0 = actifs.some((x) => !x.e.longue && x.v >= 6)
      if (longue || forte0 || malade(d) || malade(addDays(d, -1))) continue
      const out = seancesVacances(j, d, vac).map((x) => ({ ...x, notee: false, at: '' }))
      out.forEach((x, k) => {
        const tn = new Tirage('note', j.id, d, k)
        // Pas de pôle pour le lui rappeler : il en note un peu moins.
        x.notee = tn.chance(p.notation * 0.85)
        const soir = tn.chance(0.7) || addDays(d, 1) > fin
        x.at = soir ? parisIso(d, tn.int(19, 22), tn.int(0, 59)) : parisIso(addDays(d, 1), tn.int(8, 11), tn.int(0, 50))
      })
      if (out.length) faites.set(d, out)
      seances.push(...out)
      continue
    }
    const longueDebut = longue && (Date.parse(`${d}T12:00:00Z`) - Date.parse(`${longue.e.debut}T12:00:00Z`)) / 864e5 < longue.e.jours * 0.6
    const forte = actifs.some((x) => !x.e.longue && x.v >= 6)
    const sick = malade(d) || malade(addDays(d, -1))
    const f = facteurSemaine(d)
    const out: Seance[] = []
    const w = dow(d)
    if (w >= 1 && w <= 5) {
      if (sick) continue
      if (longueDebut) {
        if (w !== 3) out.push({ jour: d, type: 'reathle', duree: r5(t.between(40, 60)), rpe: note(t.between(2, 4)), notee: false, at: '' })
      } else {
        for (const x of prog.jours[w]) {
          let type = x.type
          let duree = x.duree * f.duree + t.normal() * 8
          let rpe = x.rpe + f.rpe + t.normal() * 0.8
          if (testsLe.has(d) && type === 'hand') [type, duree, rpe] = ['tests', 90, 5.5 + t.normal() * 0.6]
          if (forte && type !== 'muscu') {
            if (t.chance(0.5)) continue
            rpe -= 2
            duree *= 0.7
          }
          if (longue) rpe -= 1
          out.push({ jour: d, type, duree: r5(duree), rpe: note(rpe), notee: false, at: '' })
        }
      }
    } else {
      // Week-end : match avec son club (à partir de la mi-septembre ; le samedi ou le dimanche selon le club et la journée).
      const we = lundi(d)
      const jourMatch = hash32(`${j.club}:${we}`) % 2 === 0 ? 6 : 0
      const championnat = d >= '2026-09-19'
      const amical = !championnat && d >= '2026-09-12'
      if (w === jourMatch && (championnat || amical) && !sick && !longue && !forte) {
        const tm = new Tirage('match', j.id, we)
        if (tm.chance(championnat ? 0.86 : 0.45))
          out.push({ jour: d, type: 'match', duree: r5(tm.between(70, 95)), rpe: note(tm.between(7, 9.4) + (tm.chance(0.15) ? 0.6 : 0)), notee: false, at: '' })
      }
      if (w === 6 && jourMatch === 0 && championnat && !sick && !longue && t.chance(0.22))
        out.push({ jour: d, type: 'club', duree: r5(t.between(75, 95)), rpe: note(t.between(5, 6.5)), notee: false, at: '' })
    }
    // Notées : le soir même (19 h – 22 h 30) ou le lendemain matin (« hier »), jamais après la date de fin.
    out.forEach((x, k) => {
      const tn = new Tirage('note', j.id, d, k)
      x.notee = tn.chance(p.notation)
      const soir = tn.chance(0.7) || addDays(d, 1) > fin
      x.at = soir ? parisIso(d, tn.int(19, 22), tn.int(0, 59)) : parisIso(addDays(d, 1), 7, tn.int(0, 50))
    })
    if (out.length) faites.set(d, out)
    seances.push(...out)
  }
  // Wellness du matin : jours demandés (lundi → vendredi hors vacances) ; parfois aussi le week-end ou en vacances (rare).
  const reponses: Reponse[] = []
  let demandes = 0
  for (const d of jours(DEBUT, fin)) {
    const demande = jourDemande(d)
    if (demande) demandes++
    const t = new Tirage('wellness', j.id, d)
    const sick = malade(d)
    const repond = demande ? t.chance(p.remplissage * (dow(d) === 1 ? 0.96 : 1)) : t.chance(0.02)
    if (!repond) continue
    // Fatigue : charge de la veille (le lundi : le week-end, match compris, plus coûteux : contacts, courses, duels).
    const veille = dow(d) === 1 ? 1.3 * (charge(addDays(d, -1)) + 0.8 * charge(addDays(d, -2))) : charge(addDays(d, -1))
    const fatigue = clamp((veille - 800) / 450, -1, 2.2)
    const apresMatch = dow(d) === 1 && [addDays(d, -1), addDays(d, -2)].some((x) => (faites.get(x) ?? []).some((s0) => s0.type === 'match'))
    const apresTests = testsLe.has(addDays(d, -1))
    const actifs = intensites(d)
    const muscu = actifs.filter((x) => ['contracture', 'coup', 'douleur'].includes(x.e.type)).reduce((m, x) => Math.max(m, x.v), 0)
    const nuitCourte = t.chance(dow(d) === 1 ? 0.13 : 0.07)
    const sommeil = p.base.sommeil + t.normal() * p.ecart * 0.8 - (dow(d) === 1 ? 0.4 : 0) - (nuitCourte ? t.between(2.5, 4) : 0)
    const coupDeMou = t.chance(0.03)
    const fraicheur = p.base.fraicheur - 1.0 * fatigue + t.normal() * p.ecart * 0.7 - 0.3 * muscu - (apresMatch ? 1.3 : 0) - (sick ? 1.5 : 0)
    const energie = p.base.energie - 0.45 * fatigue + 0.35 * (sommeil - p.base.sommeil) + t.normal() * p.ecart * 0.6 - (sick ? 3 : 0) - (coupDeMou ? 1.5 : 0)
    const humeur =
      p.base.humeur + 0.3 * (energie - p.base.energie) + t.normal() * p.ecart * 0.6 - (coupDeMou ? 2.5 : 0) - (actifs.some((x) => x.e.longue) ? 1 : 0) + (dow(d) === 5 ? 0.3 : 0)
    const douleurs: Douleur[] = []
    const vus = new Set<string>()
    const ajoute = (x: Douleur) => {
      const k = `${x.zone}:${x.cote ?? ''}`
      if (vus.has(k) || douleurs.length >= 8) return
      vus.add(k)
      douleurs.push(x)
    }
    for (const { e, v } of actifs) ajoute({ zone: e.zone, ...(e.cote ? { cote: e.cote } : {}), type: e.type, ...(e.texte ? { texte: e.texte } : {}), intensite: v })
    // Courbatures le lendemain des grosses journées, des tests, d'un match.
    const pc = 0.05 + 0.1 * Math.max(0, fatigue) + (apresMatch ? 0.22 : 0) + (apresTests ? 0.3 : 0)
    if (t.chance(Math.min(0.6, pc))) {
      const zones = ['quadriceps', 'ischios', 'mollet', 'fessiers', 'adducteurs']
      const z = t.weighted([0.4, 0.25, 0.15, 0.12, 0.08])
      const i = t.int(2, 4)
      const deux = t.chance(0.75)
      for (const c of deux ? (['d', 'g'] as const) : [t.chance(0.5) ? ('d' as const) : ('g' as const)]) ajoute({ zone: zones[z], cote: c, type: 'courbatures', intensite: Math.max(1, i - (c === 'g' && deux && t.chance(0.3) ? 1 : 0)) })
      if (t.chance(0.2)) {
        const z2 = zones[(z + 1 + t.int(0, 3)) % zones.length]
        ajoute({ zone: z2, cote: t.chance(0.5) ? 'd' : 'g', type: 'courbatures', intensite: t.int(2, 3) })
      }
    }
    const mins = p.heure + t.int(-20, 25)
    reponses.push({
      jour: d,
      scores: { energie: note(energie), fraicheur: note(fraicheur), humeur: note(humeur), sommeil: note(sommeil) },
      douleurs,
      at: parisIso(d, Math.floor(mins / 60), mins % 60),
    })
  }
  return { id: j.id, reponses, seances, demandes }
}

// ---------- Tests physiques ----------

const ARRONDI: Record<TestId, number> = {
  taille: 0.5, poids: 0.1, taille_assise: 0.5, envergure: 1, empan: 0.1, sprint_10: 0.01, sprint_30: 0.01, t_test: 0.01, vift: 0.5, cmj_hauteur: 0.1, medball_conc: 0.01,
}
const RANGE_KEY: Partial<Record<TestId, keyof (typeof RANGES)['M']['U15']>> = {
  taille: 'taille', poids: 'poids', taille_assise: 'assise', empan: 'empan', sprint_10: 'sprint10', sprint_30: 'sprint30', t_test: 'ttest', vift: 'vift', cmj_hauteur: 'cmj', medball_conc: 'mb',
}
/** Progression par mois et bruit d'une séance à l'autre (temps : on baisse en progressant). */
const EVOL: Record<TestId, { mois: number; bruit: number }> = {
  taille: { mois: 0.3, bruit: 0.3 }, poids: { mois: 0.3, bruit: 0.6 }, taille_assise: { mois: 0.15, bruit: 0.3 }, envergure: { mois: 0.3, bruit: 0.6 },
  empan: { mois: 0.02, bruit: 0.15 }, sprint_10: { mois: -0.008, bruit: 0.03 }, sprint_30: { mois: -0.015, bruit: 0.05 }, t_test: { mois: -0.04, bruit: 0.12 },
  vift: { mois: 0.15, bruit: 0.4 }, cmj_hauteur: { mois: 0.3, bruit: 1.1 }, medball_conc: { mois: 0.05, bruit: 0.15 },
}
const arrondir = (x: number, pas: number) => Math.round(Math.round(x / pas) * pas * 100) / 100

/** Valeur d'un test pour un jeune à une date : depuis sa dernière valeur connue, sinon dans la fourchette de sa catégorie. */
export function valeurTest(j: Pick<Joueur, 'id' | 'sexe' | 'annee'>, test: TestId, date: string, dernier?: { date: string; valeur: number }): number {
  const t = new Tirage('test', j.id, test, date)
  const ev = EVOL[test]
  if (dernier && Number.isFinite(dernier.valeur)) {
    const mois = (Date.parse(date) - Date.parse(dernier.date)) / (30.44 * 864e5)
    let v = dernier.valeur + ev.mois * mois + ev.bruit * t.normal()
    if (test === 'taille' || test === 'envergure' || test === 'taille_assise') v = Math.max(dernier.valeur, v)
    return arrondir(v, ARRONDI[test])
  }
  const cat: Cat = categoryOf(j.annee, date)
  const z = new Tirage('niveau-test', j.id).normal() * 0.7 + new Tirage('niveau-test', j.id, test).normal() * 0.5
  const u = clamp(0.5 + 0.22 * z, 0.03, 0.97)
  if (test === 'envergure') {
    const taille = valeurTest(j, 'taille', date)
    return arrondir(taille + (j.sexe === 'M' ? 3 : 2) + 2.5 * new Tirage('envergure', j.id).normal(), 1)
  }
  const [a, b] = RANGES[j.sexe][cat][RANGE_KEY[test]!]
  return arrondir(a + (b - a) * u + ev.bruit * 0.5 * t.normal(), ARRONDI[test])
}

// ---------- Avis ----------

type Txt = (g: 'M' | 'F') => string
const FORCES: Txt[] = [
  () => 'Très bonne intensité sur toute la séance',
  (g) => `Très ${accord('appliqué', g)} sur les exercices de tir`,
  () => 'Lit bien les espaces en attaque placée',
  () => 'Belle progression sur le jeu sans ballon',
  () => 'Communique beaucoup en défense',
  (g) => `${accord('Concentré', g)} et ${accord('disponible', g)} du début à la fin`,
  () => 'Prend des initiatives justes en contre-attaque',
  () => 'Bonne qualité de passe dans la course',
  () => 'Solide dans les duels défensifs',
  () => 'Tire profit du travail de musculation : appuis plus toniques',
  (g) => `Toujours ${accord('volontaire', g)}, entraîne le groupe`,
  () => 'Bon investissement dans la récupération et les soins',
]
const FORCES_GB: Txt[] = [
  () => 'Très bon placement sur les tirs de loin',
  () => 'Relances rapides et précises',
  () => 'Organise bien la défense devant lui',
  (g) => `Très ${accord('réactif', g)} sur les tirs à bout portant`,
]
const AXES = [
  'À travailler : le repli défensif après une perte de balle', 'À travailler : la variété des tirs', 'À travailler : la communication en défense',
  'À travailler : la régularité sur toute la séance', 'À travailler : les appuis avant le tir', 'À travailler : la lecture des décalages',
  'À travailler : le gainage pour stabiliser les duels', 'À travailler : rester positif après une erreur',
]
const AXES_GB = ['À travailler : les sorties sur les ailiers', 'À travailler : la relance longue', 'À travailler : les déplacements latéraux']

// ---------- Journal ----------

const JOURNAL: { texte: string; humeur: string }[] = [
  { texte: 'Bonne séance de tirs ce soir, je me sens de plus en plus à l’aise.', humeur: 'content' },
  { texte: 'Premier match de la saison avec le club, on a gagné ! J’ai marqué 4 buts.', humeur: 'fier' },
  { texte: 'Grosse semaine de préparation physique, les jambes sont lourdes mais ça va passer.', humeur: 'fatigue' },
  { texte: 'Objectif du mois : mieux communiquer en défense.', humeur: 'motive' },
  { texte: 'Séance vidéo intéressante sur nos replis défensifs.', humeur: 'concentre' },
  { texte: 'Contrôle de maths réussi, et entraînement au top derrière.', humeur: 'content' },
  { texte: 'Pas mon meilleur match, je retiens qu’il faut rester calme sur les fins de match.', humeur: 'pensif' },
  { texte: 'Les tests de vitesse se sont bien passés, j’ai gagné quelques centièmes.', humeur: 'fier' },
  { texte: 'Retour des vacances, content de retrouver le groupe.', humeur: 'motive' },
  { texte: 'J’ai bien récupéré ce week-end, prêt pour la semaine.', humeur: 'serein' },
  { texte: 'Travail spécifique au poste avec le coach : plein de choses à essayer.', humeur: 'motive' },
  { texte: 'Un peu de fatigue avec les devoirs, je vais mieux m’organiser.', humeur: 'pensif' },
  { texte: 'Défaite de peu avec le club, mais on a bien joué ensemble.', humeur: 'decu' },
  { texte: 'Bonne ambiance à l’internat cette semaine.', humeur: 'content' },
]

// ---------- Préparation de tout le jeu ----------

export interface Ligne {
  id: string
  data: Record<string, unknown>
  scope?: [string | null, string | null]
}
export interface LigneWellness {
  player_id: string
  jour: string
  scores: Record<string, number>
  douleur: boolean
  douleurs: Douleur[]
  at: string
}
export interface LigneSeance {
  id: string
  player_id: string
  jour: string
  rpe: number
  duree: number
  at: string
}
export interface LigneJournal {
  id: string
  player_id: string
  at: string
  text: string
  mood: string
  shared: boolean
}
/** Compte joueur fictif d'un jeune du pôle (vrai compte du service de connexion, relié à sa fiche). */
export interface CompteJoueur {
  user_id: string
  player_id: string
  email: string
  /** Site du pôle (« Site (F) ») et classe, pour la liste de Geoffroy (aucun nom). */
  site: string
  classe: string
  /** Créé et relié (heure ISO) : la veille de la rentrée du pôle. */
  at: string
}
/** Identifiant court et stable d'un compte : 8 caractères base32 (a-z, 2-7) tirés de la fiche ; aucun nom. */
export function emailCompte(playerId: string): string {
  const h = createHash('sha1').update(`nextar-activite-poles/compte:${playerId}`).digest()
  const A = 'abcdefghijklmnopqrstuvwxyz234567'
  let bits = 0
  let v = 0
  let out = ''
  for (const byte of h) {
    v = (v << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < 8) {
      out += A[(v >> (bits - 5)) & 31]
      bits -= 5
    }
    if (out.length >= 8) break
  }
  return `j-${out}@${DOMAINE_COMPTES}`
}
const CLASSES = ['3e', '2de', '1re', 'Tle']

export interface Activite {
  fin: string
  plan: Plan
  /** Fiches à écrire : identifiant, périodes avant (extrait), après (null : plus de pôle), internat. */
  fiches: { id: string; avant: PolePeriod[] | null; apres: PolePeriod[] | null; boarding?: boolean; boardingAvant?: boolean; auteurAvant?: string }[]
  figees: string[]
  nouveauxGroupes: Ligne[]
  groupesWellness: string[]
  sitesSansUnite: string[]
  mesures: Ligne[]
  avis: Ligne[]
  wellness: LigneWellness[]
  seances: LigneSeance[]
  journal: LigneJournal[]
  comptes: CompteJoueur[]
  vies: Map<string, VieJoueur>
}

export function preparer(e: Entree, opts: { fin?: string } = {}): Activite {
  const fin = opts.fin ?? FIN_DEFAUT
  const cands = candidats(e)
  const plan = planifierPoles(cands, { jour: fin })
  const byId = new Map(e.joueurs.map((j) => [j.id, j]))
  const fiches = [...plan.ecritures].map(([id, w]) => ({
    id, avant: byId.get(id)?.poles ?? null, apres: w.poles, ...(w.boarding !== undefined ? { boarding: w.boarding } : {}),
    ...(byId.get(id)?.boarding !== undefined ? { boardingAvant: byId.get(id)!.boarding } : {}),
    ...(byId.get(id)?.auteur !== undefined ? { auteurAvant: byId.get(id)!.auteur } : {}),
  }))
  const figees = e.joueurs.filter((j) => j.fige && j.poles).map((j) => j.id)
  const scope = (pid: string): [string | null, string | null] => {
    const j = byId.get(pid)
    return [j?.dept || null, j?.club || null]
  }
  // Groupes Pôle : un par unité qui n'en a pas ; la clé « wellness » sur tous.
  const nouveauxGroupes: Ligne[] = []
  const sitesSansUnite: string[] = []
  for (const s of POLE_SITES) if (!e.unites.some((u) => u.site === s)) sitesSansUnite.push(siteKey(s))
  for (const u of e.unites) {
    if (e.groupes.some((g) => g.uniteId === u.id && !g.supprime)) continue
    if (!e.createur) continue
    const id = uuidDe(`groupe-pole:${u.id}`)
    const at = '2026-08-31T08:00:00.000Z'
    nouveauxGroupes.push({
      id,
      data: {
        id, name: u.nom, description: `Pôle Espoirs ${u.site.sex === 'F' ? 'féminin' : 'masculin'} : membres d'après les périodes de pôle des fiches`,
        playerIds: [], poleUnitId: u.id, private: false, sex: u.site.sex, scope: 'ligue', regionId: u.site.regions[0], editors: [],
        names: { [e.createur.id]: e.createur.nom }, addedBy: {}, wellness: true, wellnessSince: DEBUT,
        createdBy: e.createur.id, createdByName: e.createur.nom, createdAtServer: at, updatedByName: e.createur.nom, updatedAtServer: at, demoSeed: MARQUE,
      },
    })
  }
  const groupesWellness = e.groupes.filter((g) => !g.supprime && !g.wellness).map((g) => g.id)
  // Activité des membres de la saison (année d'une des quatre classes, sans compte joueur relié : un vrai compte garde sa page).
  const mesures: Ligne[] = []
  const avis: Ligne[] = []
  const wellness: LigneWellness[] = []
  const seances: LigneSeance[] = []
  const journal: LigneJournal[] = []
  const comptes: CompteJoueur[] = []
  const vies = new Map<string, VieJoueur>()
  const grille = e.criteres
  for (const sp of plan.sites) {
    const s = sp.site
    const staff = staffDuPole(s)
    const [coach, prep] = staff
    const cal = calendrierTests(s, fin)
    // Rangés par identifiant : l'activité ne dépend pas de l'ordre du plan (relancer sur la base écrite redonne la même).
    const membres = sp.membres
      .map((c) => byId.get(c.id)!)
      .filter((j) => j && ANNEES_POLE.includes(j.annee) && !j.compte)
      .sort((x, y) => x.id.localeCompare(y.id))
    // Wellness, séances, journal.
    for (const j of membres) {
      const v = vieDe(j, s, fin, cal)
      vies.set(j.id, v)
      // Son compte joueur : créé et relié la veille de la rentrée du pôle (lundi 31 août, l'après-midi).
      const tc = new Tirage('compte', j.id)
      comptes.push({
        user_id: uuidDe(`compte:${j.id}`), player_id: j.id, email: emailCompte(j.id), site: `${s.site} (${s.sex})`,
        classe: CLASSES[ANNEES_POLE.indexOf(j.annee)] ?? '', at: parisIso('2026-08-31', tc.int(14, 18), tc.int(0, 59)),
      })
      for (const r of v.reponses)
        wellness.push({ player_id: j.id, jour: r.jour, scores: r.scores, douleur: r.douleurs.length > 0, douleurs: r.douleurs, at: r.at })
      v.seances.forEach((x, k) => {
        if (x.notee) seances.push({ id: uuidDe(`seance:${j.id}:${x.jour}:${k}`), player_id: j.id, jour: x.jour, rpe: x.rpe, duree: x.duree, at: x.at })
      })
      const tj = new Tirage('journal', j.id)
      if (tj.chance(0.3)) {
        const n = tj.int(1, 4)
        const choisis = new Set<number>()
        for (let k = 0; k < n; k++) {
          const i = tj.int(0, JOURNAL.length - 1)
          if (choisis.has(i)) continue
          choisis.add(i)
          const x = JOURNAL[i]
          // Jour cohérent avec le texte (retour de vacances, premier match…) sinon un soir de semaine hors vacances.
          const ds = jours(DEBUT, addDays(fin, -1)).filter((d) => !enVacances(d))
          let d = ds[tj.int(0, ds.length - 1)]
          if (x.texte.startsWith('Retour des vacances')) d = '2026-11-02'
          if (x.texte.startsWith('Premier match')) d = '2026-09-20'
          if (d >= fin) continue
          journal.push({ id: idCourt(`journal:${j.id}:${i}`), player_id: j.id, at: parisIso(d, tj.int(20, 22), tj.int(0, 59)), text: x.texte, mood: x.humeur, shared: tj.chance(0.45) })
        }
      }
    }
    // Tests : rentrée (taille, poids et une partie des tests), point d'octobre (thème du site), reprise après les vacances.
    const theme = [['sprint_10', 'sprint_30', 'cmj_hauteur'], ['vift'], ['t_test', 'cmj_hauteur', 'medball_conc'], ['sprint_10', 'vift']][hash32(`theme:${sp.key}`) % 4] as TestId[]
    const seancesTests: [string | undefined, (j: Joueur, t: Tirage) => TestId[], number][] = [
      [cal.rentree, (_j, t) => {
        // Taille, poids, taille assise, envergure, puis 2 à 5 des autres tests : jamais tout.
        const autres = (['sprint_10', 'sprint_30', 'cmj_hauteur', 'vift', 't_test', 'medball_conc', 'empan'] as TestId[]).map((x) => ({ x, k: t.next() })).sort((p, q) => p.k - q.k)
        return ['taille', 'poids', 'taille_assise', 'envergure', ...autres.slice(0, t.int(2, 5)).map((y) => y.x)]
      }, 0.88],
      [cal.octobre, (_j, t) => theme.filter(() => t.chance(0.88)), 0.8],
      [cal.reprise, (_j, t) => ['taille', 'poids', ...(t.chance(0.5) ? (['cmj_hauteur'] as TestId[]) : [])], 0.75],
    ]
    for (const [jour, quoi, presence] of seancesTests) {
      if (!jour) continue
      for (const j of membres) {
        const t = new Tirage('seance-tests', j.id, jour)
        if (!t.chance(presence) || e.joursMesures.get(j.id)?.has(jour)) continue
        const v = vies.get(j.id)
        const blesse = profilDe(j.id, j.poste).episodes.some((x) => intensiteEpisode(x, jour, j.id) >= 5)
        let liste = quoi(j, t).filter((x) => e.tests.has(x))
        if (blesse) liste = liste.filter((x) => x === 'taille' || x === 'poids' || x === 'taille_assise' || x === 'envergure')
        void v
        const at = parisIso(jour, 18, 30)
        for (const test of liste) {
          const id = uuidDe(`mesure:${j.id}:${test}:${jour}`)
          const value = valeurTest(j, test, jour, e.derniers.get(j.id)?.get(test))
          mesures.push({
            id, scope: scope(j.id),
            data: { id, playerId: j.id, criterionId: test, value, date: jour, author: prep.nom, createdByName: prep.nom, createdAtServer: at, updatedByName: prep.nom, updatedAtServer: at, demoSeed: MARQUE },
          })
        }
      }
    }
    // Avis du staff du pôle : 4 à 7 séances observées, 3 à 7 jeunes notés à chaque fois (ceux qui en ont le moins d'abord).
    const ts = new Tirage('avis', sp.key)
    const ds = jours('2026-09-07', addDays(fin, -1)).filter((d) => jourDemande(d) && ![cal.rentree, cal.octobre, cal.reprise].includes(d))
    const nObs = ts.int(4, 7)
    const recus = new Map<string, number>()
    const obsJours = [...new Set(Array.from({ length: nObs }, () => ds[ts.int(0, ds.length - 1)]))].sort()
    for (const d of obsJours) {
      const obs = ts.chance(0.7) ? coach : prep
      const pool = membres.map((j) => ({ j, w: 1 / (1 + 2 * (recus.get(j.id) ?? 0)) }))
      const n = Math.min(pool.length, ts.int(3, 7))
      for (let k = 0; k < n; k++) {
        const i = ts.weighted(pool.map((x) => x.w))
        const { j } = pool.splice(i, 1)[0]
        recus.set(j.id, (recus.get(j.id) ?? 0) + 1)
        const t = new Tirage('un-avis', j.id, d)
        const complet = t.chance(0.4)
        const crits = grille.filter((c) => (!c.positions?.length || (!!j.poste && c.positions.includes(j.poste))) && (complet || c.quick))
        const niveau = new Tirage('niveau-avis', j.id).normal() * 0.6
        const scores: Record<string, number> = {}
        for (const c of crits) {
          if (t.chance(0.08)) continue
          scores[c.id] = Math.round(clamp(3.2 + niveau + 0.45 * new Tirage('critere', j.id, c.id).normal() + 0.45 * t.normal() + (obs.role === 'preparateur' ? 0.1 : 0), 1, 5))
        }
        if (!Object.keys(scores).length) continue
        const gb = j.poste === 'GB'
        const strengths = t.chance(0.55) ? t.pick(gb ? FORCES_GB : FORCES)(j.sexe) : undefined
        const improvements = t.chance(0.45) ? t.pick(gb ? AXES_GB : AXES) : undefined
        const at = parisIso(d, t.int(18, 21), t.int(0, 59))
        const id = uuidDe(`avis:${j.id}:${d}:${obs.role}`)
        avis.push({
          id, scope: scope(j.id),
          data: {
            id, playerId: j.id, observer: obs.nom, observerId: obs.id, date: d, scores, minutesObserved: t.int(60, 110), contextType: 'autre',
            contextPlace: `Séance du pôle (${s.site})`, review: 'validated', reviewedBy: obs.id, reviewedByName: obs.nom, reviewedAt: at,
            ...(strengths ? { strengths } : {}), ...(improvements ? { improvements } : {}),
            createdByName: obs.nom, createdAtServer: at, updatedByName: obs.nom, updatedAtServer: at, demoSeed: MARQUE,
          },
        })
      }
    }
  }
  if (new Set(comptes.map((c) => c.email)).size !== comptes.length) throw new Error('Deux comptes joueurs auraient la même adresse')
  return { fin, plan, fiches, figees, nouveauxGroupes, groupesWellness, sitesSansUnite, mesures, avis, wellness, seances, journal, comptes, vies }
}

// ---------- SQL ----------

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const qj = (x: unknown) => `${q(JSON.stringify(x))}::jsonb`
const BATCH = 500
const lots = <T>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / BATCH) }, (_, i) => xs.slice(i * BATCH, (i + 1) * BATCH))

/** Début de chaque fichier : transaction ouverte par l'appelant (outils/appliquer-sql.sh, apply.sql) ; déclencheurs coupés. */
/**
 * Fin de passage : les fichiers écrivent déclencheurs coupés, donc sans ligne dans le registre des changements (061), et à
 * une heure serveur qui peut être plus ancienne que le curseur d'un appareil déjà synchronisé : ni le filet (059) ni le
 * registre ne lui diraient rien (constaté le 09/11 sur la maison : groupes Pôle, clé wellness et avis jamais reçus, réparé à la
 * main). On note donc ici, comme hb_registre_noter, chaque ligne écrite dans cette transaction (heure serveur ≥ son début).
 */
export const RESYNC_SQL = `do $$
declare t text;
begin
  if to_regclass('public.hb_registre') is null or to_regprocedure('public.hb_canaux_ligne(text, jsonb)') is null then return; end if;
  foreach t in array array['players', 'measurements', 'evaluations', 'groups', 'config'] loop
    execute format($f$
      insert into public.hb_registre (x, canal, tbl, ligne, us, h, perte)
      select pg_current_xact_id(), c.canal, %1$L, r.id, n.us,
             case when %1$L in ('players', 'measurements', 'evaluations') and not r.deleted
                  then left(encode(sha256(convert_to(r.id || E'\\n' || n.us::text || E'\\n' || r.data::text, 'UTF8')), 'hex'), 16) end,
             r.deleted
        from public.%2$I r
        cross join lateral (select (extract(epoch from r.server_updated_at) * 1000000)::bigint as us) n
        cross join lateral unnest(public.hb_canaux_ligne(%3$L, to_jsonb(r))) c(canal)
       where r.server_updated_at >= now()$f$, t, 'hb_' || t, 'hb_' || t);
  end loop;
end $$;
`

const PRELUDE = `set local session_replication_role = replica;
set local statement_timeout = 0;
set local client_min_messages = warning;
create temp table if not exists act_stamp on commit drop as select (extract(epoch from now()) * 1000)::bigint as ms, now() as started;
`
/** Fiche modifiée par un vrai compte : data.updatedBy, ou une ligne du journal avec un compte. */
const FIGEE_SQL = (p: string) =>
  `(${p}.data ? 'updatedBy' or exists (select 1 from public.hb_audit a where a.table_name = 'players' and a.row_id = ${p}.id and a.user_id is not null))`

export function sqlFiches(a: Activite): string {
  const out = [
    `-- Pôles Espoirs, saison 2026-2027 (tools/seed-activite-poles.ts) : périodes de pôle et internat de ${a.fiches.length} fiche(s).`,
    `-- Seulement data.poles et data.boarding ; seulement si data.poles est encore celui de l'extrait et si la fiche n'a jamais été`,
    `-- modifiée par un vrai compte (sinon : laissée, comptée). Rejouable.`,
    PRELUDE,
    `create temp table act_poles (id text primary key, avant jsonb, apres jsonb, internat boolean) on commit drop;`,
  ]
  for (const lot of lots(a.fiches))
    out.push(
      `insert into act_poles (id, avant, apres, internat) values\n${lot
        .map((f) => `(${q(f.id)},${f.avant ? qj(f.avant) : 'null'},${f.apres ? qj(f.apres) : 'null'},${f.boarding === undefined ? 'null' : f.boarding})`)
        .join(',\n')};`,
    )
  out.push(`create temp table act_poles_bilan on commit drop as
select t.id,
       case when p.id is null or p.deleted then 'fiche absente'
            when coalesce(p.data -> 'poles', 'null'::jsonb) = coalesce(t.apres, 'null'::jsonb)
                 and (t.internat is null or p.data -> 'boarding' = to_jsonb(t.internat)) then 'déjà à jour'
            when ${FIGEE_SQL('p')} then 'modifiée par un vrai compte : laissée'
            when coalesce(p.data -> 'poles', 'null'::jsonb) not in (coalesce(t.avant, 'null'::jsonb), coalesce(t.apres, 'null'::jsonb))
                 then 'changée depuis l''extrait : laissée'
            else 'à écrire' end as etat
  from act_poles t left join public.hb_players p on p.id = t.id;
update public.hb_players p
   set data = case when t.apres is null then p.data - 'poles' - 'boarding'
                   else p.data || jsonb_build_object('poles', t.apres) || case when t.internat is null then '{}'::jsonb else jsonb_build_object('boarding', t.internat) end end
              || jsonb_build_object('updatedAt', s.ms, 'updatedByName', ${q(AUTEUR)}, 'updatedAtServer', now()),
       updated_at_client = s.ms, server_updated_at = clock_timestamp()
  from act_poles t, act_poles_bilan b, act_stamp s
 where p.id = t.id and b.id = t.id and b.etat = 'à écrire';
select etat as fiches_poles, count(*) from act_poles_bilan group by 1 order by 1;
`)
  return out.join('\n')
}

export function sqlGroupes(a: Activite): string {
  const out = [`-- Groupes Pôle : ${a.nouveauxGroupes.length} groupe(s) créé(s) (unités Pôle sans groupe), clé « wellness » sur tous les groupes Pôle.`, PRELUDE]
  if (a.nouveauxGroupes.length)
    out.push(`insert into public.hb_groups as t (id, data, updated_at_client, deleted, server_updated_at)
select v.id, v.d::jsonb || jsonb_build_object('updatedAt', s.ms), s.ms, false, clock_timestamp()
  from (values
${a.nouveauxGroupes.map((g) => `(${q(g.id)},${q(JSON.stringify(g.data))},${q(String(g.data.poleUnitId))})`).join(',\n')}
) v(id, d, unite) cross join act_stamp s
 where not exists (select 1 from public.hb_groups g where g.data ->> 'poleUnitId' = v.unite and not g.deleted and g.id <> v.id)
-- Déjà là : rien ; retiré par le retour arrière (et jamais touché depuis par un vrai compte) : remis.
on conflict (id) do update set data = excluded.data, updated_at_client = excluded.updated_at_client, deleted = false, server_updated_at = excluded.server_updated_at
 where t.deleted and t.data ->> 'demoSeed' = '${MARQUE}' and not (t.data ? 'updatedBy' and t.data ->> 'updatedBy' <> t.data ->> 'createdBy');
select count(*) as groupes_pole_crees from public.hb_groups where data ->> 'demoSeed' = '${MARQUE}' and not deleted;`)
  out.push(`-- Clé « wellness » (et la date) sur les groupes Pôle qui ne l'ont pas : deux clés ajoutées, rien d'autre ne change.
with g as (
  update public.hb_groups t
     set data = t.data || jsonb_build_object('wellness', true, 'wellnessSince', ${q(DEBUT)}, 'updatedAt', s.ms), updated_at_client = s.ms, server_updated_at = clock_timestamp()
    from act_stamp s
   where coalesce(t.data ->> 'poleUnitId', '') <> '' and not t.deleted and coalesce(t.data -> 'wellness', 'null'::jsonb) <> 'true'::jsonb
  returning t.id)
select count(*) as groupes_pole_wellness_actives from g;
`)
  return out.join('\n')
}

export const REGLAGE_SQL = `-- Réglage d'installation du wellness (supabase/073) : ouvert, { "actif": true }, comme sur une installation réelle (pas de
-- mode « démonstration » : les jeunes fictifs ont de vrais comptes joueurs, 08_comptes_joueurs.sql).
-- Retour : 03_reglage_wellness_retour.sql.
insert into public.hb_config as t (id, data, updated_at_client, deleted, server_updated_at)
values ('wellness', jsonb_build_object('id', 'wellness', 'key', 'wellness', 'value', jsonb_build_object('actif', true),
        'updatedAt', (extract(epoch from now()) * 1000)::bigint, 'updatedByName', ${q(AUTEUR)}), (extract(epoch from now()) * 1000)::bigint, false, clock_timestamp())
on conflict (id) do update set data = excluded.data, updated_at_client = excluded.updated_at_client, deleted = false, server_updated_at = excluded.server_updated_at;
select id, data -> 'value' as reglage from public.hb_config where id = 'wellness';
`
export const REGLAGE_RETOUR_SQL = `-- Retour : wellness refermé sur l'installation (rien n'est demandé, le tableau du staff ne montre plus rien de nouveau).
update public.hb_config set data = data || jsonb_build_object('value', jsonb_build_object('actif', false),
       'updatedAt', (extract(epoch from now()) * 1000)::bigint), updated_at_client = (extract(epoch from now()) * 1000)::bigint, server_updated_at = clock_timestamp()
 where id = 'wellness';
select id, data -> 'value' as reglage from public.hb_config where id = 'wellness';
`

/** Lignes nouvelles marquées (tests, avis) : jamais par-dessus une ligne d'un vrai compte ni une ligne d'un autre jeu. */
function upsertMarque(table: string, rows: Ligne[]): string {
  const out = [`-- hb_${table} : ${rows.length} ligne(s) (data.demoSeed = '${MARQUE}')`]
  for (const lot of lots(rows))
    out.push(`insert into public.hb_${table} as t (id, data, updated_at_client, deleted, server_updated_at, scope_dept, scope_club)
select v.id, v.d::jsonb || jsonb_build_object('updatedAt', s.ms), s.ms, false, clock_timestamp(), v.sd, v.sc
  from (values
${lot.map((r) => `(${q(r.id)},${q(JSON.stringify(r.data))},${r.scope?.[0] ? q(r.scope[0]) : 'null'},${r.scope?.[1] ? q(r.scope[1]) : 'null'})`).join(',\n')}
) v(id, d, sd, sc) cross join act_stamp s
on conflict (id) do update set data = excluded.data, updated_at_client = excluded.updated_at_client, deleted = false, server_updated_at = excluded.server_updated_at,
       scope_dept = excluded.scope_dept, scope_club = excluded.scope_club
 where t.data ->> 'demoSeed' = '${MARQUE}' and not (t.data ? 'updatedBy') and t.data - 'updatedAt' is distinct from excluded.data - 'updatedAt';`)
  return out.join('\n\n')
}

export function sqlTestsAvis(a: Activite): string {
  return [
    `-- Tests physiques (${a.mesures.length}) et avis du staff des pôles (${a.avis.length}) : lignes nouvelles.`,
    PRELUDE,
    upsertMarque('measurements', a.mesures),
    upsertMarque('evaluations', a.avis),
    `select 'tests' as quoi, count(*) from public.hb_measurements where data ->> 'demoSeed' = '${MARQUE}' and not deleted
union all select 'avis', count(*) from public.hb_evaluations where data ->> 'demoSeed' = '${MARQUE}' and not deleted;
`,
  ].join('\n')
}

export function sqlWellness(a: Activite): string {
  const out = [`-- Wellness du matin (${a.wellness.length} réponses) et « Ma séance » (${a.seances.length}) : tables de 073, user_id vide (fictif) ;`, `-- jamais par-dessus une réponse d'un vrai compte.`, PRELUDE]
  for (const lot of lots(a.wellness))
    out.push(`insert into public.hb_wellness as t (player_id, jour, user_id, scores, douleur, douleurs, created_at, updated_at) values
${lot.map((w) => `(${q(w.player_id)},${q(w.jour)},null,${qj(w.scores)},${w.douleur},${qj(w.douleurs)},${q(w.at)},${q(w.at)})`).join(',\n')}
on conflict (player_id, jour) do update set scores = excluded.scores, douleur = excluded.douleur, douleurs = excluded.douleurs,
       created_at = excluded.created_at, updated_at = excluded.updated_at
 where t.user_id is null;`)
  for (const lot of lots(a.seances))
    out.push(`insert into public.hb_wellness_seances as t (id, player_id, jour, user_id, rpe, duree, created_at, updated_at) values
${lot.map((x) => `(${q(x.id)},${q(x.player_id)},${q(x.jour)},null,${x.rpe},${x.duree},${q(x.at)},${q(x.at)})`).join(',\n')}
on conflict (id) do update set jour = excluded.jour, rpe = excluded.rpe, duree = excluded.duree, created_at = excluded.created_at, updated_at = excluded.updated_at
 where t.user_id is null;`)
  out.push(`select 'wellness' as quoi, count(*) from public.hb_wellness where user_id is null
union all select 'séances', count(*) from public.hb_wellness_seances where user_id is null;
`)
  return out.join('\n\n')
}

export function sqlJournal(a: Activite): string {
  const out = [`-- « Mon journal du hand » : ${a.journal.length} note(s) fictive(s) (user_id vide), partagées avec le staff pour une partie.`, PRELUDE]
  for (const lot of lots(a.journal))
    out.push(`insert into public.hb_player_journal as t (id, player_id, user_id, at, text, mood, shared, shared_at, deleted, updated_at) values
${lot.map((x) => `(${q(x.id)},${q(x.player_id)},null,${q(x.at)},${q(x.text)},${q(x.mood)},${x.shared},${x.shared ? q(x.at) : 'null'},false,${q(x.at)})`).join(',\n')}
on conflict (id) do nothing;`)
  return out.join('\n\n')
}

/** Fiche au pôle à la date de fin (une période qui la couvre), au moment du passage. */
const AU_POLE_SQL = (p: string, fin: string) =>
  `exists (select 1 from jsonb_array_elements(case when jsonb_typeof(${p}.data -> 'poles') = 'array' then ${p}.data -> 'poles' else '[]'::jsonb end) x
            where coalesce(x ->> 'from', '') <= ${q(fin)} and coalesce(x ->> 'to', '9999') >= ${q(fin)})`

/**
 * Un VRAI compte joueur par jeune du pôle (Geoffroy, 09/11 : tester comme si c'était vrai), dans l'état où le laisse
 * hb_create_player_account (052) : lignes de auth.users et auth.identities comme GoTrue les attend (compte confirmé, jetons
 * vides et non NULL, fournisseur « email »), mot de passe COMMUN dont seule l'empreinte bcrypt est ici (pgcrypto
 * crypt / gen_salt('bf') ; le mot de passe est dans secrets/comptes-hand.env), profil hb_profiles rôle « joueur » relié à la
 * fiche (player_id, player_linked_at : « Accès joueur actif depuis le … » de la carte Espace joueur), journal (« création »
 * du compte, « accès joueur : compte créé et relié »). Différences voulues : pas de mot de passe provisoire (il arrive sur
 * /moi), charte du joueur déjà acceptée (player_charter_version), app_metadata.demoSeed pour le retour arrière et l'extrait.
 * Seulement si la fiche existe, est au pôle à la date de fin, n'a pas déjà de compte joueur, et si ni l'identifiant ni
 * l'adresse ne sont pris ; sinon laissée et comptée. Rejouable (rien de nouveau au second passage).
 * Déclencheurs REMIS pour ce fichier (session_replication_role = origin), comme quand hb_create_player_account tourne : le
 * profil est créé par celui de 002 (hb_on_user_created), le cache des droits (hb_droits_comptes) et le journal du rôle
 * (hb_log_role) suivent, les clés étrangères sont vérifiées.
 */
export function sqlComptes(a: Activite, empreinte: string): string {
  if (!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(empreinte)) throw new Error('Empreinte bcrypt du mot de passe des comptes joueurs invalide')
  const out = [
    `-- Comptes joueurs des jeunes du pôle (${a.comptes.length}) : vrais comptes du service de connexion, reliés à leur fiche, charte acceptée.`,
    `-- Adresses j-…@${DOMAINE_COMPTES} (domaine réservé : aucun courrier ne part) ; mot de passe commun (empreinte bcrypt seulement).`,
    PRELUDE,
    `set local session_replication_role = origin;`,
    `create temp table act_comptes (user_id uuid primary key, player_id text unique, email text unique, at timestamptz) on commit drop;`,
  ]
  for (const lot of lots(a.comptes))
    out.push(`insert into act_comptes (user_id, player_id, email, at) values\n${lot.map((c) => `(${q(c.user_id)},${q(c.player_id)},${q(c.email)},${q(c.at)})`).join(',\n')};`)
  out.push(`create temp table act_comptes_bilan on commit drop as
select c.*, btrim(coalesce(p.data ->> 'firstName', '') || ' ' || coalesce(p.data ->> 'lastName', '')) as nom,
       case when p.id is null or p.deleted then 'fiche absente'
            when exists (select 1 from auth.users u where u.id = c.user_id) then 'déjà créé'
            when exists (select 1 from public.hb_profiles pr where pr.role = 'joueur' and pr.player_id = c.player_id) then 'fiche déjà reliée à un compte : laissée'
            when exists (select 1 from auth.users u where lower(u.email) = c.email) then 'adresse déjà prise : laissée'
            when not ${AU_POLE_SQL('p', a.fin)} then 'plus au pôle : laissée'
            else 'à créer' end as etat
  from act_comptes c left join public.hb_players p on p.id = c.player_id;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', b.user_id, 'authenticated', 'authenticated', b.email, ${q(empreinte)}, b.at,
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'demoSeed', '${MARQUE}'),
       jsonb_build_object('full_name', b.nom, 'player_charter_version', ${PLAYER_CHARTER_VERSION}, 'player_charter_accepted_at', to_char(b.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
       b.at, b.at, '', '', '', '', '', '', '', ''
  from act_comptes_bilan b where b.etat = 'à créer';
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), b.user_id::text, b.user_id, jsonb_build_object('sub', b.user_id::text, 'email', b.email, 'email_verified', true), 'email', null, b.at, b.at
  from act_comptes_bilan b where b.etat = 'à créer';
-- Profil créé par le déclencheur de 002 : rôle joueur, sans secteur, relié à la fiche (comme hb_create_player_account).
update public.hb_profiles pr
   set role = 'joueur', full_name = b.nom, email = b.email, phone = null, departments = '{}'::text[], player_id = b.player_id,
       player_linked_at = b.at, created_at = b.at
  from act_comptes_bilan b where b.etat = 'à créer' and pr.user_id = b.user_id;
-- La ligne « rôle » du journal (hb_log_role) datée du jour de la création, comme le reste.
update public.hb_audit x set at = b.at
  from act_comptes_bilan b, act_stamp s
 where b.etat = 'à créer' and x.table_name = 'profiles' and x.row_id = b.user_id::text and x.action = 'rôle' and x.at >= s.started;
delete from public.hb_player_invites i using act_comptes_bilan b where b.etat = 'à créer' and i.player_id = b.player_id and i.used_at is null;
-- Journal, comme hb_create_player_account (au nom de ce jeu, sans compte : la fiche ne compte pas comme modifiée par un vrai compte).
insert into public.hb_audit (at, user_id, user_name, user_role, table_name, row_id, action, summary, changes)
select b.at, null::uuid, ${q(AUTEUR)}, 'admin', 'profiles', b.user_id::text, 'création', b.nom,
       jsonb_build_object('email', jsonb_build_array(null, b.email), 'role', jsonb_build_array(null, 'joueur'))
  from act_comptes_bilan b where b.etat = 'à créer'
union all
select b.at, null::uuid, ${q(AUTEUR)}, 'admin', 'players', b.player_id, 'accès joueur', coalesce(nullif(b.nom, ''), '?') || ' — compte créé et relié', null::jsonb
  from act_comptes_bilan b where b.etat = 'à créer';
select etat as comptes_joueurs, count(*) from act_comptes_bilan group by 1 order by 1;
`)
  return out.join('\n')
}

/** Liste des comptes pour Geoffroy (dossier des secrets) : adresse, site, classe, fiche ; aucun nom, aucun mot de passe. */
export function csvComptes(a: Activite): string {
  return ['email;pole;classe;player_id', ...[...a.comptes].sort((x, y) => x.site.localeCompare(y.site) || x.classe.localeCompare(y.classe) || x.email.localeCompare(y.email)).map((c) => `${c.email};${c.site};${c.classe};${c.player_id}`)].join('\n') + '\n'
}

/**
 * Retour arrière du jeu (sauf le réglage : 03_reglage_wellness_retour.sql) : périodes de pôle et internat remis comme
 * dans l'extrait (seulement si la fiche n'a pas changé depuis), groupes Pôle créés supprimés, clé « wellness » retirée des
 * autres groupes Pôle où ce jeu l'a posée, tests et avis du jeu supprimés (logiquement : les appareils le reçoivent),
 * wellness, séances et journal fictifs effacés (jamais une ligne d'un vrai compte), comptes joueurs de ce jeu retirés (avec
 * ce qu'on a écrit en les essayant et leurs lignes du journal).
 */
export function sqlRetour(a: Activite): string {
  const out = [`-- Retour arrière de la vie des pôles (tools/seed-activite-poles.ts) : à passer comme les autres fichiers.`, PRELUDE]
  out.push(`create temp table act_retour (id text primary key, avant jsonb, apres jsonb, internat_avant boolean, auteur_avant text) on commit drop;`)
  for (const lot of lots(a.fiches))
    out.push(`insert into act_retour values
${lot.map((f) => `(${q(f.id)},${f.avant ? qj(f.avant) : 'null'},${f.apres ? qj(f.apres) : 'null'},${f.boardingAvant === undefined ? 'null' : f.boardingAvant},${f.auteurAvant === undefined ? 'null' : q(f.auteurAvant)})`).join(',\n')};`)
  out.push(`with u as (
  update public.hb_players p
     -- « Modifié par » d'avant (libellé d'import ; vide : il n'y en avait pas) quand l'extrait le donne.
     set data = ((case when t.avant is null then p.data - 'poles' else p.data || jsonb_build_object('poles', t.avant) end)
                 - 'boarding' - (case when t.auteur_avant is null then '' else 'updatedByName' end))
                || (case when t.internat_avant is null then '{}'::jsonb else jsonb_build_object('boarding', t.internat_avant) end)
                || (case when coalesce(t.auteur_avant, '') = '' then '{}'::jsonb else jsonb_build_object('updatedByName', t.auteur_avant) end)
                || jsonb_build_object('updatedAt', s.ms, 'updatedAtServer', now()),
         updated_at_client = s.ms, server_updated_at = clock_timestamp()
    from act_retour t, act_stamp s
   where p.id = t.id and not p.deleted and coalesce(p.data -> 'poles', 'null'::jsonb) = coalesce(t.apres, 'null'::jsonb) and not ${FIGEE_SQL('p')}
  returning 1)
select count(*) as fiches_remises from u;
with g as (
  update public.hb_groups t set deleted = true, data = t.data || jsonb_build_object('deleted', true, 'updatedAt', s.ms), updated_at_client = s.ms, server_updated_at = clock_timestamp()
    from act_stamp s where t.data ->> 'demoSeed' = '${MARQUE}' and not t.deleted and not (t.data ? 'updatedBy' and t.data ->> 'updatedBy' <> t.data ->> 'createdBy')
  returning 1)
select count(*) as groupes_retires from g;
update public.hb_groups t set data = t.data - 'wellness' - 'wellnessSince' || jsonb_build_object('updatedAt', s.ms), updated_at_client = s.ms, server_updated_at = clock_timestamp()
  from act_stamp s where t.id in (${a.groupesWellness.map(q).join(', ') || "''"}) and t.data ->> 'wellnessSince' = ${q(DEBUT)};
do $$
declare t text;
begin
  foreach t in array array['measurements', 'evaluations'] loop
    execute format('update public.hb_%s x set deleted = true, data = x.data || jsonb_build_object(''deleted'', true, ''updatedAt'', s.ms),
                           updated_at_client = s.ms, server_updated_at = clock_timestamp()
                      from act_stamp s where x.data ->> ''demoSeed'' = %L and not x.deleted and not (x.data ? ''updatedBy'')', t, '${MARQUE}');
  end loop;
end $$;
create temp table act_retour_joueurs (id text primary key) on commit drop;`)
  const ids = [...a.vies.keys()]
  for (const lot of lots(ids)) out.push(`insert into act_retour_joueurs values ${lot.map((x) => `(${q(x)})`).join(',')};`)
  out.push(`delete from public.hb_wellness w using act_retour_joueurs j where w.player_id = j.id and w.user_id is null;
delete from public.hb_wellness_seances w using act_retour_joueurs j where w.player_id = j.id and w.user_id is null;
delete from public.hb_player_journal w using act_retour_joueurs j where w.player_id = j.id and w.user_id is null;
`)
  // Comptes joueurs de ce jeu (identifiants de ce jeu ou marque app_metadata.demoSeed) : ce qu'on a pu écrire en essayant
  // avec ces comptes (wellness, séances, journal du hand) part avec eux ; puis toutes les lignes du journal de ces comptes
  // (création, rôle, connexions notées sur le profil) et leur « accès joueur », leurs codes, le compte (déclencheurs remis :
  // identités, sessions, profil, notifications… suivent par on delete cascade, le cache des droits aussi).
  out.push(`set local session_replication_role = origin;
create temp table act_retour_comptes (user_id uuid primary key) on commit drop;`)
  for (const lot of lots(a.comptes)) out.push(`insert into act_retour_comptes values ${lot.map((c) => `(${q(c.user_id)})`).join(',')};`)
  out.push(`insert into act_retour_comptes select id from auth.users where raw_app_meta_data ->> 'demoSeed' = '${MARQUE}' on conflict do nothing;
delete from act_retour_comptes c where not exists (select 1 from auth.users u where u.id = c.user_id);
delete from public.hb_wellness w using act_retour_comptes c where w.user_id = c.user_id;
delete from public.hb_wellness_seances w using act_retour_comptes c where w.user_id = c.user_id;
delete from public.hb_player_journal w using act_retour_comptes c where w.user_id = c.user_id;
delete from public.hb_audit x using act_retour_comptes c where (x.table_name = 'profiles' and x.row_id = c.user_id::text)
   or (x.user_id is null and x.user_name = ${q(AUTEUR)} and x.table_name = 'players' and x.action = 'accès joueur'
       and x.row_id = (select pr.player_id from public.hb_profiles pr where pr.user_id = c.user_id));
delete from public.hb_player_invites i using act_retour_comptes c where i.used_by = c.user_id;
with d as (delete from auth.users u using act_retour_comptes c where u.id = c.user_id returning 1)
select count(*) as comptes_joueurs_retires from d;
-- Cache des droits (hb_droits_compte, sans clé étrangère) : leurs lignes partent aussi.
delete from public.hb_droits_compte d using act_retour_comptes c where d.user_id = c.user_id::text;
`)
  return out.join('\n')
}

/** Contrôles (lecture seule) après passage. */
export function verifySql(fin: string): string {
  const [v0, v1] = VACANCES
  return `-- Contrôles de la vie des pôles (lecture seule).
\\set ON_ERROR_STOP on
\\pset footer off
\\echo '--- Lignes du jeu'
select 'fiches écrites (updatedByName)' quoi, count(*) n from public.hb_players where data ->> 'updatedByName' = ${q(AUTEUR)}
union all select 'groupes Pôle', count(*) from public.hb_groups where coalesce(data ->> 'poleUnitId', '') <> '' and not deleted
union all select 'groupes Pôle avec wellness', count(*) from public.hb_groups where coalesce(data ->> 'poleUnitId', '') <> '' and not deleted and data -> 'wellness' = 'true'::jsonb
union all select 'tests', count(*) from public.hb_measurements where data ->> 'demoSeed' = '${MARQUE}' and not deleted
union all select 'avis', count(*) from public.hb_evaluations where data ->> 'demoSeed' = '${MARQUE}' and not deleted
union all select 'wellness', count(*) from public.hb_wellness
union all select 'séances', count(*) from public.hb_wellness_seances
union all select 'journal', count(*) from public.hb_player_journal where user_id is null
union all select 'journal (vos lignes)', count(*) from public.hb_player_journal where user_id is not null
union all select 'journal hb_audit', count(*) from public.hb_audit;

\\echo '--- Effectifs au ${fin} par groupe Pôle (classe = âge scolaire 2026 : 14 = 3e … 17 = Tle) et entrées en 3e'
with m as (
  select u.id unite, u.data ->> 'name' pole, p.id, 2026 - left(p.data ->> 'birthDate', 4)::int age, x ->> 'from' f, left(p.data ->> 'birthDate', 4)::int an
    from public.hb_units u
    join public.hb_players p on not p.deleted and p.data ->> 'sex' = u.data ->> 'poleSex'
    cross join lateral jsonb_array_elements(coalesce(p.data -> 'poles', '[]')) x
   where u.data ->> 'levelId' = 'niveau-pole' and not u.deleted and public.hb_wl_fold(x ->> 'site') = public.hb_wl_fold(u.data ->> 'poleSite')
     and coalesce(x ->> 'from', '') <= '${fin}' and coalesce(x ->> 'to', '9999') >= '${fin}')
select pole, count(*) n, count(*) filter (where age = 14) "3e", count(*) filter (where age = 15) "2de", count(*) filter (where age = 16) "1re",
       count(*) filter (where age = 17) "Tle", count(*) filter (where age not between 14 and 17) autres,
       count(*) filter (where f = (an + 14) || '-09-01') entres_3e
  from m group by 1 order by 1;

\\echo '--- Sorties (motifs) et périodes hors règle'
select x ->> 'to' "to", coalesce(x ->> 'exitReason', '-') motif, count(*) from public.hb_players p cross join lateral jsonb_array_elements(coalesce(p.data -> 'poles', '[]')) x
 where not p.deleted and x ? 'to' group by 1, 2 order by 1, 2;

\\echo '--- Wellness : taux de réponse par jeune sur les jours demandés (lundi → vendredi hors vacances ${v0} → ${v1})'
with dem as (select d::date jour from generate_series('${DEBUT}'::date, '${fin}'::date, '1 day') d
              where extract(isodow from d) <= 5 and d::date not between '${v0}' and '${v1}'),
t as (select w.player_id, count(*) filter (where w.jour in (select jour from dem))::numeric / (select count(*) from dem) taux from public.hb_wellness w group by 1)
select case when taux >= 0.999 then '100 %' when taux >= 0.75 then '75-99 %' when taux >= 0.4 then '40-74 %' else '< 40 %' end tranche, count(*) jeunes
  from t group by 1 order by 1;
select count(*) filter (where extract(isodow from jour) > 5) reponses_week_end, count(*) filter (where jour between '${v0}' and '${v1}') reponses_vacances,
       count(*) filter (where douleur) avec_douleur, count(*) filter (where public.hb_wl_douleurs(douleurs) is distinct from douleurs and douleur) douleurs_mal_formees
  from public.hb_wellness;
select k note, round(avg((scores ->> k)::int), 2) moyenne, count(*) filter (where (scores ->> k)::int <= 4) "≤ 4", count(*) filter (where (scores ->> k)::int >= 9) "≥ 9"
  from public.hb_wellness cross join unnest(array['energie', 'fraicheur', 'humeur', 'sommeil']) k group by 1 order by 1;
select d ->> 'type' type, count(*), round(avg((d ->> 'intensite')::int), 1) intensite from public.hb_wellness cross join lateral jsonb_array_elements(douleurs) d group by 1 order by 2 desc;

\\echo '--- Séances : par jour de semaine, durée toujours là, charge par semaine (moyenne par jeune)'
select extract(isodow from jour) jour_semaine, count(*), round(avg(rpe), 1) rpe, round(avg(duree)) duree, count(*) filter (where duree is null) sans_duree
  from public.hb_wellness_seances group by 1 order by 1;
select date_trunc('week', jour)::date semaine, round(sum(rpe * duree)::numeric / count(distinct player_id)) charge_par_jeune, count(*) seances
  from public.hb_wellness_seances group by 1 order by 1;

\\echo '--- Comptes joueurs du jeu : confirmés, reliés à une fiche au pôle, charte acceptée, identité, sans mot de passe provisoire'
select count(*) comptes, count(*) filter (where u.email_confirmed_at is not null) confirmes, count(pr.player_id) relies,
       count(*) filter (where u.raw_user_meta_data ->> 'player_charter_version' = '${PLAYER_CHARTER_VERSION}') charte,
       count(*) filter (where exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email')) identites,
       count(*) filter (where coalesce((u.raw_user_meta_data ->> 'must_change_password')::boolean, false)) provisoires,
       count(*) filter (where p.id is not null and ${AU_POLE_SQL('p', fin)}) au_pole
  from auth.users u
  left join public.hb_profiles pr on pr.user_id = u.id and pr.role = 'joueur'
  left join public.hb_players p on p.id = pr.player_id and not p.deleted
 where u.raw_app_meta_data ->> 'demoSeed' = '${MARQUE}';
select role, count(*) from public.hb_profiles group by 1 order by 1;

\\echo '--- Empreinte de hb_upsert (doit être celle d''avant)'
select md5(prosrc) hb_upsert from pg_proc where proname = 'hb_upsert' and pronamespace = 'public'::regnamespace;
`
}

/**
 * Fichiers SQL du jeu. Avec `empreinte` (bcrypt du mot de passe commun des comptes joueurs) : 08_comptes_joueurs.sql, inclus
 * dans activite-poles.sql ; sans : pas de comptes (le retour arrière retire quand même ceux de ce jeu s'il y en a).
 */
export function ecrireSql(a: Activite, dir: string, opts: { empreinte?: string } = {}): string[] {
  mkdirSync(dir, { recursive: true })
  const files: [string, string][] = [
    ['01_poles_joueurs.sql', sqlFiches(a)],
    ['02_groupes_wellness.sql', sqlGroupes(a)],
    ['04_tests_avis.sql', sqlTestsAvis(a)],
    ['05_wellness_seances.sql', sqlWellness(a)],
    ['06_journal.sql', sqlJournal(a)],
    ...(opts.empreinte ? ([['08_comptes_joueurs.sql', sqlComptes(a, opts.empreinte)]] as [string, string][]) : []),
  ]
  // Déclencheurs coupés = registre (061) muet : lignes écrites notées à la fin (RESYNC_SQL), sinon les appareils déjà
  // synchronisés ne les reçoivent jamais.
  files.push(['09_appareils.sql', RESYNC_SQL])
  for (const [n, s] of files) writeFileSync(join(dir, n), s)
  writeFileSync(join(dir, '03_reglage_wellness.sql'), REGLAGE_SQL)
  writeFileSync(join(dir, '03_reglage_wellness_retour.sql'), REGLAGE_RETOUR_SQL)
  writeFileSync(join(dir, '07_retour_arriere.sql'), sqlRetour(a) + '\n' + RESYNC_SQL)
  // Un seul fichier pour outils/appliquer-sql.sh (il ajoute begin / commit ; pas de \\ir par l'entrée standard).
  writeFileSync(join(dir, 'activite-poles.sql'), files.map(([n, s]) => `-- ===== ${n} =====\n${s}`).join('\n'))
  const inc = (ns: string[]) => ns.map((n) => `\\echo '${n}'\n\\ir ${n}`).join('\n')
  const noms = files.map(([n]) => n)
  const tous = [...noms.slice(0, 2), '03_reglage_wellness.sql', ...noms.slice(2)]
  writeFileSync(join(dir, 'apply.sql'), `\\set ON_ERROR_STOP on\nbegin;\n${inc(tous)}\ncommit;\n`)
  writeFileSync(join(dir, 'dry-run.sql'), `\\set ON_ERROR_STOP on\nbegin;\n${inc(tous)}\n\\echo 'Essai terminé : tout est annulé.'\nrollback;\n`)
  writeFileSync(join(dir, 'verify.sql'), verifySql(a.fin))
  // Essai à blanc SUR LE SERVEUR, par outils/appliquer-sql.sh (qui ajoute begin / commit) : réglage + tout, bilans affichés,
  // puis rollback (le commit ajouté derrière ne trouve plus de transaction : simple avertissement). Après 073.
  writeFileSync(
    join(dir, 'essai-a-blanc.sql'),
    `-- Essai à blanc (rien n'est gardé) : 03 + activite-poles.sql, puis rollback.\n${REGLAGE_SQL}\n${readFileSync(join(dir, 'activite-poles.sql'), 'utf8')}\n\\echo 'Essai à blanc terminé : tout est annulé.'\nrollback;\n`,
  )
  return [...noms, '03_reglage_wellness.sql', '03_reglage_wellness_retour.sql', '07_retour_arriere.sql', 'activite-poles.sql', 'essai-a-blanc.sql', 'apply.sql', 'dry-run.sql', 'verify.sql']
}

// ---------- Chiffres clés ----------

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0)
export function chiffres(e: Entree, a: Activite) {
  const byId = new Map(e.joueurs.map((j) => [j.id, j]))
  const membres = a.plan.sites.flatMap((s) => s.membres)
  const enCohorte = membres.filter((c) => ANNEES_POLE.includes(c.annee))
  const entres3e = enCohorte.filter((c) => {
    const w = a.plan.ecritures.get(c.id)
    const from = (w?.poles ?? c.poles ?? [])[0]?.from
    return from === `${c.annee + 14}-09-01`
  }).length
  const clubs = new Map<string, number>()
  for (const c of membres) clubs.set(c.club ?? '', (clubs.get(c.club ?? '') ?? 0) + 1)
  const parClub = [...clubs.values()].sort((x, y) => y - x)
  const taux = [...a.vies.values()].map((v) => v.reponses.filter((r) => jourDemande(r.jour)).length / v.demandes)
  const anciens = new Set(e.joueurs.filter((j) => j.poles?.some((x) => (!x.from || x.from <= a.fin) && (!x.to || x.to >= a.fin))).map((j) => j.id))
  const gardes = membres.filter((c) => anciens.has(c.id)).length
  const scores = a.wellness.flatMap((w) => Object.values(w.scores))
  return {
    fin: a.fin,
    sites: a.plan.sites.length,
    tailles: a.plan.sites.map((s) => s.membres.length),
    membres: membres.length,
    figeesAuPole: membres.filter((c) => c.fige).length,
    classes: ANNEES_POLE.map((y) => membres.filter((c) => c.annee === y).length),
    entres3e: pct(entres3e, enCohorte.length),
    sortis: a.plan.sites.reduce((n, s) => n + s.sortis.length, 0),
    gardesDesActuels: `${gardes} / ${anciens.size}`,
    ficheEcrites: a.fiches.length,
    fichesSansPole: a.fiches.filter((f) => !f.apres).length,
    fichesNouvellesAuPole: a.fiches.filter((f) => f.apres && !f.avant).length,
    figees: a.figees.length,
    clubs: { nombre: clubs.size, plusGros: parClub.slice(0, 5), avecUnSeul: parClub.filter((n) => n === 1).length },
    horsTerritoire: membres.filter((c) => {
      const s = a.plan.sites.find((x) => x.membres.includes(c))!.site
      return !s.regions.includes(regionOfDept(c.dept) ?? '')
    }).length,
    groupes: { nouveaux: a.nouveauxGroupes.length, wellnessPose: a.groupesWellness.length, sitesSansUnite: a.sitesSansUnite },
    tests: a.mesures.length,
    avis: a.avis.length,
    jeunesAvecAvis: new Set(a.avis.map((r) => r.data.playerId)).size,
    wellness: a.wellness.length,
    seances: a.seances.length,
    journal: a.journal.length,
    remplissage: {
      '100 %': taux.filter((x) => x >= 0.999).length,
      '75-99 %': taux.filter((x) => x >= 0.75 && x < 0.999).length,
      '40-74 %': taux.filter((x) => x >= 0.4 && x < 0.75).length,
      '< 40 %': taux.filter((x) => x < 0.4).length,
    },
    notesBasses: pct(scores.filter((x) => x <= 4).length, scores.length),
    avecDouleur: pct(a.wellness.filter((w) => w.douleur).length, a.wellness.length),
    jeunesSansCompteExclus: membres.filter((c) => byId.get(c.id)?.compte).length,
    comptesJoueurs: a.comptes.length,
    vacances: (() => {
      const formes: Record<string, number> = {}
      for (const id of a.vies.keys()) formes[formeVacances(id)] = (formes[formeVacances(id)] ?? 0) + 1
      return formes
    })(),
    /** Rapport charge aiguë / chronique (src/wellness.ts, séances notées) au jour de fin, par tranche. */
    rapportCharge: (() => {
      const parJeune = new Map<string, { id: string; day: string; rpe: number; minutes: number }[]>()
      for (const x of a.seances) parJeune.set(x.player_id, [...(parJeune.get(x.player_id) ?? []), { id: x.id, day: x.jour, rpe: x.rpe, minutes: x.duree }])
      const r = [...a.vies.keys()].map((id) => chargeSummary(parJeune.get(id) ?? [], a.fin).ratio)
      const ok = r.filter((x): x is number => x !== null).sort((x, y) => x - y)
      const tons: Record<string, number> = {}
      for (const x of r) tons[chargeTone(x)] = (tons[chargeTone(x)] ?? 0) + 1
      const q = (f: number) => Math.round(ok[Math.floor(f * (ok.length - 1))] * 100) / 100
      return { tons, '<= 1,3': ok.filter((x) => x <= 1.3).length, '1,3-1,5': ok.filter((x) => x > 1.3 && x <= 1.5).length, '> 1,5': ok.filter((x) => x > 1.5).length, quartiles: [q(0.25), q(0.5), q(0.75)] }
    })(),
    /** Fiches qui ont des tests du pôle saisis par un vrai compte : combien restent au pôle (membres ou sortis). */
    testsReels: (() => {
      const avec = e.joueurs.filter((j) => j.testsReels > 0)
      const ids = new Set([...membres, ...a.plan.sites.flatMap((s) => s.sortis)].map((c) => c.id))
      return `${avec.filter((j) => ids.has(j.id)).length} / ${avec.length} au pôle`
    })(),
  }
}

// ---------- Programme ----------

/** Le chemin est-il dans un dépôt (un dossier « .git » au-dessus) ? */
function dansUnDepot(path: string): boolean {
  for (let d = dirname(resolve(path)); ; d = dirname(d)) {
    if (existsSync(join(d, '.' + 'git'))) return true
    if (dirname(d) === d) return false
  }
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  if (args[0] === 'extrait') {
    process.stdout.write(extraitSql())
  } else {
    const [src, dir] = args
    const i = args.indexOf('--jusqu-au')
    const fin = i >= 0 ? args[i + 1] : FIN_DEFAUT
    if (!src || !dir || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) {
      console.error('Usage : npx jiti tools/seed-activite-poles.ts extrait > extrait.sql\n        npx jiti tools/seed-activite-poles.ts <extrait.json> <dossier hors du dépôt> [--jusqu-au AAAA-MM-JJ] [--comptes <secrets/comptes-hand.env>]')
      process.exit(1)
    }
    if (insideRepo(dir) || insideRepo(src)) {
      console.error('Extrait et fichiers SQL : HORS du dépôt (données de la base, jamais commitées).')
      process.exit(1)
    }
    // --comptes <fichier .env des secrets> : comptes joueurs (empreinte JOUEURS_POLES_MDP_BCRYPT lue dans ce fichier, liste
    // comptes-joueurs-poles.csv écrite à côté, 600) ; ce dossier ne doit être dans aucun dépôt.
    const k = args.indexOf('--comptes')
    let empreinte: string | undefined
    let csv: string | undefined
    if (k >= 0) {
      const env = resolve(args[k + 1] ?? '')
      if (!existsSync(env) || dansUnDepot(env)) {
        console.error(`--comptes : ${env} absent, ou dans un dépôt (les secrets n'entrent jamais dans un dépôt).`)
        process.exit(1)
      }
      const m = readFileSync(env, 'utf8').match(/^JOUEURS_POLES_MDP_BCRYPT='?([^'\n]+)'?$/m)
      if (!m) {
        console.error(`--comptes : JOUEURS_POLES_MDP_BCRYPT absent de ${env}.`)
        process.exit(1)
      }
      empreinte = m[1]
      csv = join(dirname(env), 'comptes-joueurs-poles.csv')
    }
    const t0 = Date.now()
    const e = lireExtrait(JSON.parse(readFileSync(resolve(src), 'utf8')) as Extrait)
    const a = preparer(e, { fin })
    const files = ecrireSql(a, resolve(dir), { empreinte })
    if (csv) {
      writeFileSync(csv, csvComptes(a), { mode: 0o600 })
      chmodSync(csv, 0o600)
    }
    console.log(JSON.stringify(chiffres(e, a), null, 1))
    console.log(`\n${files.length} fichiers dans ${resolve(dir)}${csv ? ` ; liste des comptes : ${csv}` : ' (sans comptes joueurs : --comptes)'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  }
}
