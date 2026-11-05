import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { indexFiches, type IndexFiches } from './codesJoueurs'
import { db, DEMO, TRIAL } from './db'
import { supabase } from './sync'

/*
 * Rapports en codes du serveur MCP (supabase/068_rapports.sql, outil nextar_rapport) : lecture pour la page /rapport/:id et la
 * liste de Réglages → « Applications connectées », retrait. Lecture directe de la table (son auteur seul : règles du
 * serveur), hors de la synchronisation générale : rien n'est gardé sur l'appareil.
 *
 * REMISE DES NOMS : sur l'appareil seulement. useNomsParCode() bâtit l'index code → fiche à partir des fiches de l'appareil
 * (src/codesJoueurs.ts) ; un code d'une fiche fondue dans une autre désigne la fiche qui reste. Rien ne part vers le serveur :
 * ni les noms, ni la liste des codes.
 */

export interface Rapport {
  id: string
  titre: string
  contenu: string
  created_at: string
  expires_at: string
}

export type Lecture = { etat: 'ok'; rapport: Rapport } | { etat: 'introuvable' } | { etat: 'absent' } | { etat: 'hors-ligne' } | { etat: 'sans-serveur' } | { etat: 'erreur'; message: string }

const absente = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205')
/** Version d'essai sans serveur, démonstration : pas de rapports (ils viennent du serveur MCP, avec un compte). */
export const rapportsPossibles = () => !!supabase && !TRIAL && !DEMO

export async function lireRapport(id: string): Promise<Lecture> {
  if (!rapportsPossibles()) return { etat: 'sans-serveur' }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { etat: 'introuvable' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { etat: 'hors-ligne' }
  const { data, error } = await supabase!.from('hb_rapports').select('id, titre, contenu, created_at, expires_at').eq('id', id).maybeSingle()
  if (absente(error)) return { etat: 'absent' }
  if (error) return { etat: 'erreur', message: error.message }
  if (!data) return { etat: 'introuvable' }
  return { etat: 'ok', rapport: data as Rapport }
}

/** Mes rapports (30 jours), du plus récent au plus ancien ; null : table absente ou pas de serveur. */
export async function listerRapports(): Promise<Omit<Rapport, 'contenu'>[] | null> {
  if (!rapportsPossibles()) return null
  const { data, error } = await supabase!.from('hb_rapports').select('id, titre, created_at, expires_at').order('created_at', { ascending: false }).limit(50)
  if (error) return null
  return data as Omit<Rapport, 'contenu'>[]
}

export async function retirerRapport(id: string): Promise<string | null> {
  if (!rapportsPossibles()) return 'Pas de serveur.'
  const { error } = await supabase!.from('hb_rapports').delete().eq('id', id)
  return error ? error.message : null
}

/** Index des codes des fiches de l'appareil (et des fiches fondues), pour remettre les noms. undefined pendant la lecture. */
export function useNomsParCode(): IndexFiches | undefined {
  const players = useLiveQuery(() => db.players.toArray(), [])
  return useMemo(() => (players ? indexFiches(players) : undefined), [players])
}
