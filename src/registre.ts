/*
 * REGISTRE DES CHANGEMENTS (supabase/061_registre_changements.sql) : la partie PURE (ni Dexie, ni React, ni Supabase),
 * testée par tools/test-registre.ts ; l'état et les appels au serveur vivent dans src/sync.ts.
 *
 * POURQUOI (série 10 du 30/10, 10 000 personnes) : le filet économe (hb_filet, 059) était devenu la requête la plus coûteuse
 * de la base (~27 ms par appel, toutes les 5 minutes par appareil : empreintes calculées sur toutes les lignes de la fenêtre),
 * et les relectures d'identifiants visibles (hb_events?select=id…) servaient à trouver les lignes devenues invisibles.
 *
 * LE PRINCIPE : à chaque écriture, le serveur note dans un journal « telle ligne de telle table a changé, pour tel canal »
 * (canal = portée du direct : club, département, compte, staff…), avec son heure serveur, son empreinte (joueurs, mesures,
 * avis, « vu ») et « perte » quand un canal ne la lit plus. hb_registre_depuis(curseur) rend, en une lecture d'index, les
 * lignes citées pour les canaux du compte depuis le curseur de l'appareil ; l'appareil :
 *  - ligne qu'il a DÉJÀ (registre du filet de 059, src/filet.ts : même identifiant, même heure serveur, même empreinte) : rien
 *    à faire ; une ligne reçue en direct (« à confirmer ») est ainsi confirmée, son contenu étant octet pour octet celui du
 *    serveur (empreinte) ; sans empreinte (autres tables), une ligne déjà reçue du serveur à cette heure n'est pas relue, une
 *    ligne reçue en direct l'est ;
 *  - ligne plus récente sur l'appareil (heure serveur plus grande) : rien (la version citée est dépassée) ;
 *  - sinon, et toujours pour une « perte » : relue PAR IDENTIFIANT sous ses règles de lecture (src/sync.ts) : trouvée, elle
 *    remplace la copie ; absente (plus visible, ou supprimée), elle est retirée de l'appareil (sauf envoi en attente) ;
 *  - table « trop » (plus de 500 lignes citées) : relue par curseur comme avant, depuis la plus ancienne heure citée ;
 *  - réponse « pas complet » (premier appel, curseur trop ancien ou purgé, trop de lignes) : le filet de 059, comme avant.
 * Ensuite les curseurs des tables non relues avancent à (heure du serveur − 60 s) : une relecture par curseur plus tard (signal
 * d'une appli d'avant, table « trop ») ne reprend pas toute la journée ; une ligne validée en retard, elle, sera citée par le
 * registre au passage suivant quelle que soit son heure (curseur du registre = xmin de l'instantané).
 * FILET RARE : le filet de 059 n'est plus fait qu'une fois par jour (CHARGE_REGLES.filetRareMs), ou quand le registre n'est
 * pas complet : il rattrape ce qui n'est pas passé par les déclencheurs (import SQL déclencheurs coupés).
 *
 * SÉCURITÉ : une ligne n'est jamais prise du registre, seulement son identifiant ; le contenu vient d'une relecture sous les
 * règles de lecture, ou de l'appareil quand l'empreinte du serveur est la même. Le registre ne fait que dire QUOI relire.
 */
import type { Ledger } from './filet'
import { suaMicros } from './filet'

/** Recouvrement appliqué au curseur d'une table quand il avance sur la réponse du registre (même valeur que le filet). */
export const REGISTRE_RECOUVREMENT_MS = 60_000

export interface RegistreLigne {
  id: string
  /** Heure serveur (µs) ; null : inconnue (toujours relue). */
  us: number | null
  /** Empreinte de la ligne (joueurs, mesures, avis, « vu ») ; null : pas d'empreinte. */
  h: string | null
  perte: boolean
}
export type RegistreTable = { lignes: RegistreLigne[] } | { trop: number; depuis: number | null }
export interface RegistreReponse {
  /** Nouveau curseur (xid8 en texte). */
  c: string
  /** Heure du serveur au moment de la réponse (texte ISO) ; null : illisible. */
  t: string | null
  complet: boolean
  /** Canaux du compte (null : absents de la réponse). */
  canaux: string[] | null
  e: Record<string, RegistreTable>
  /** Niveau de charge annoncé (forme de src/charge.ts, lireAnnonce), s'il y en a un. */
  k: unknown
}

const isStr = (x: unknown): x is string => typeof x === 'string'

/** Réponse de hb_registre_depuis ; null : illisible (l'appli fait comme sans registre). */
export function lireRegistre(data: unknown): RegistreReponse | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  if (!isStr(d.c) || !/^\d+$/.test(d.c) || typeof d.complet !== 'boolean') return null
  const canaux = Array.isArray(d.canaux) ? d.canaux.filter(isStr) : null
  const e: Record<string, RegistreTable> = {}
  if (d.complet) {
    if (!d.e || typeof d.e !== 'object' || Array.isArray(d.e)) return null
    for (const [t, v] of Object.entries(d.e as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const lignes: RegistreLigne[] = []
        for (const x of v) {
          if (!Array.isArray(x) || !isStr(x[0])) return null // ligne illisible : toute la réponse est écartée (prudence)
          lignes.push({ id: x[0], us: typeof x[1] === 'number' && Number.isFinite(x[1]) ? x[1] : null, h: isStr(x[2]) ? x[2] : null, perte: x[3] === 1 || x[3] === true })
        }
        e[t] = { lignes }
      } else if (v && typeof v === 'object' && typeof (v as { trop?: unknown }).trop === 'number') {
        const dep = (v as { depuis?: unknown }).depuis
        e[t] = { trop: (v as { trop: number }).trop, depuis: typeof dep === 'number' && Number.isFinite(dep) ? dep : null }
      } else return null
    }
  }
  return { c: d.c, t: isStr(d.t) ? d.t : null, complet: d.complet, canaux, e, k: d.k ?? null }
}

/** Que faire d'une table : relire ces identifiants, confirmer ces lignes reçues en direct, ou relire par curseur (trop). */
export interface PlanRegistreTable {
  lire: string[]
  confirmer: string[]
  /** Relecture par curseur depuis cette heure (µs ; null : depuis le curseur actuel) ; undefined : pas « trop ». */
  trop?: number | null
}

/**
 * Plan d'après la réponse (complète) et ce que tient l'appareil : registre du filet (identifiant → [heure µs, empreinte]) et
 * lignes reçues en direct pas encore confirmées. Seules les tables de `tables` (lues par ce compte) sont planifiées ; une
 * table sans ligne citée n'apparaît pas (rien de neuf).
 */
export function planRegistre(
  rep: RegistreReponse,
  tables: readonly string[],
  ledger: Ledger,
  provisoires: (table: string) => ReadonlySet<string>,
): Record<string, PlanRegistreTable> {
  const out: Record<string, PlanRegistreTable> = {}
  for (const [t, v] of Object.entries(rep.e)) {
    if (!tables.includes(t)) continue
    if ('trop' in v) {
      out[t] = { lire: [], confirmer: [], trop: v.depuis }
      continue
    }
    const r = ledger[t]?.r ?? {}
    const prov = provisoires(t)
    const p: PlanRegistreTable = { lire: [], confirmer: [] }
    for (const l of v.lignes) {
      const had = r[l.id]
      if (l.perte || l.us === null || !had) {
        p.lire.push(l.id)
        continue
      }
      if (had[0] > l.us) continue // l'appareil a plus récent : la version citée est dépassée
      if (had[0] < l.us) {
        p.lire.push(l.id)
        continue
      }
      // Même heure serveur : même contenu si l'empreinte du serveur est la même ; sans empreinte, une ligne reçue du serveur
      // n'est pas relue, une ligne reçue en direct (d'un autre appareil) l'est.
      if (l.h !== null) {
        if (had[1] === l.h) {
          if (prov.has(l.id)) p.confirmer.push(l.id)
        } else p.lire.push(l.id)
      } else if (prov.has(l.id)) p.lire.push(l.id)
    }
    if (p.lire.length || p.confirmer.length) out[t] = p
  }
  return out
}

/** Heure ISO (ms) d'un nombre de µs (vers le bas : jamais après l'heure donnée). */
const isoOfUs = (us: number) => new Date(Math.floor(us / 1000)).toISOString()

/**
 * Curseur d'une table après une réponse complète du registre (table pas relue) : max(curseur, heure du serveur − 60 s) ;
 * inchangé si l'heure du serveur est illisible. Le texte rendu est celui à garder (ISO).
 */
export function curseurApres(cur: string | null, t: string | null): string | null {
  const tUs = suaMicros(t)
  if (tUs === null) return cur
  const cand = tUs - REGISTRE_RECOUVREMENT_MS * 1000
  const c = suaMicros(cur)
  if (c !== null && c >= cand) return cur
  return isoOfUs(cand)
}

/** Curseur d'une table « trop » : ramené à la plus ancienne heure citée si elle est avant (une ligne validée en retard). */
export function curseurTrop(cur: string | null, depuisUs: number | null): string | null {
  if (cur === null || depuisUs === null) return cur
  const c = suaMicros(cur)
  if (c !== null && c <= depuisUs) return cur
  return isoOfUs(depuisUs)
}

/** État gardé sur l'appareil : curseur du registre, heure du dernier filet complet (059), canaux vus au dernier passage. */
export interface RegistreEtat {
  c: string | null
  f: number | null
  canaux: string[] | null
}

/** Relit l'état gardé (texte JSON) ; illisible : vide (premier appel : « pas complet », filet de 059). */
export function lireEtatRegistre(text: string | null): RegistreEtat {
  try {
    const p = JSON.parse(text ?? '{}') as Record<string, unknown> | null
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { c: null, f: null, canaux: null }
    return {
      c: isStr(p.c) && /^\d+$/.test(p.c) ? p.c : null,
      f: typeof p.f === 'number' && Number.isFinite(p.f) ? p.f : null,
      canaux: Array.isArray(p.canaux) ? p.canaux.filter(isStr) : null,
    }
  } catch {
    return { c: null, f: null, canaux: null }
  }
}

/** Le filet rare (059) est-il dû ? (jamais fait, ou il y a plus de `tousLesMs`). */
export function filetRareDu(now: number, dernier: number | null, tousLesMs: number): boolean {
  return dernier === null || !Number.isFinite(dernier) || dernier > now || now - dernier >= tousLesMs
}

/** Mêmes canaux (ordre indifférent) ? */
export function memesCanaux(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (!a || !b) return a === b
  const x = new Set(a)
  return x.size === new Set(b).size && b.every((t) => x.has(t))
}

/** Canaux à fermer et à ouvrir pour passer de `avant` à `apres` (le reste reste abonné : pas de reconnexion inutile). */
export function diffCanaux(avant: readonly string[], apres: readonly string[]): { fermer: string[]; ouvrir: string[] } {
  const a = new Set(avant)
  const b = new Set(apres)
  return { fermer: [...a].filter((t) => !b.has(t)), ouvrir: [...b].filter((t) => !a.has(t)) }
}
