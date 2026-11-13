// FICHIER GÉNÉRÉ par tools/generer-partage-mcp.ts depuis src/propositionsAdminCore.ts : ne pas le modifier ici. Après un changement dans
// src/propositionsAdminCore.ts : npx jiti tools/generer-partage-mcp.ts (tools/test-mcp.ts vérifie que la copie est à jour).
/*
 * Boîte « À valider », propositions D'ADMINISTRATION (sorte « admin », supabase/070_propositions_admin.sql) : le FORMAT des
 * actions préparées par Claude (serveur MCP, outil nextar_admin_proposer : supabase/functions/mcp/adminProposer.ts) et lues
 * par l'appli de l'administrateur (src/propositionsAdmin.ts, écran src/components/PropositionsAdmin.tsx). « Claude prépare,
 * l'admin valide d'un toucher » : rien ne s'applique avant que l'administrateur coche et touche « Appliquer » dans l'appli,
 * qui passe alors par les MÊMES chemins que ses écrans (Réglages › Membres, Structure, menus Archiver, fusion de fiches).
 *
 * Fichier PUR, sans import : utilisé par l'appli et, en copie générée, par la fonction « mcp » (tools/generer-partage-mcp.ts).
 *
 * Une proposition d'administration : contexte { sorte, version } et une ligne par action (objet), 50 au plus, toutes de la
 * même sorte :
 *  - « role »      : { a: 'role', userId, compte, nom, role, avant }  donner ou changer le rôle d'un compte ;
 *  - « perimetre » : { a: 'unite', userId, compte, nom, uniteId, unite, roleUnite }  affecter à une unité (Structure), ou
 *                    { a: 'secteur', userId, compte, nom, depts }  poser le secteur (départements, Réglages › Membres) ;
 *  - « archiver »  : { a: 'archiver', quoi: 'evenement' | 'groupe', id, nom, date? } ;
 *  - « fusion »    : { a: 'fusion', garder, fondre }  identifiants de fiches (l'appli remet les noms ; l'admin peut inverser).
 * Les identifiants (comptes, fiches) restent dans la proposition de l'administrateur (sa ligne, lue par lui seul) : le
 * serveur MCP ne les rend jamais à Claude (codes C-… et J-… seulement).
 */

export type AdminSorte = 'role' | 'perimetre' | 'archiver' | 'fusion'
export const ADMIN_SORTES: readonly AdminSorte[] = ['role', 'perimetre', 'archiver', 'fusion']

/** Bornes (les mêmes que supabase/070_propositions_admin.sql). */
export const ADMIN_LIMITES = {
  /** Actions par proposition. */
  actions: 50,
  /** Départements d'un secteur. */
  departements: 30,
  /** Noms (compte, unité, événement, groupe) gardés avec l'action. */
  nom: 120,
} as const

/** Rôles qu'une proposition peut donner (comme Réglages › Membres : jamais administrateur). */
export const ROLES_PROPOSABLES = ['observateur', 'preparateur', 'joueur'] as const
export type RoleProposable = (typeof ROLES_PROPOSABLES)[number]
/** Rôles dans une unité (comme Structure). */
export const ROLES_UNITE = ['admin', 'preparateur', 'observateur'] as const
export type RoleUnite = (typeof ROLES_UNITE)[number]

/** Département : « 01 » à « 95 », « 2A », « 2B », « 971 » à « 976 ». */
export const DEPT_RE = /^(0[1-9]|[1-8]\d|9[0-5]|2A|2B|97[1-6])$/

interface Compte {
  /** Identifiant du compte (hb_profiles.user_id) : jamais rendu à Claude. */
  userId: string
  /** Code court (« C-… »), tel que Claude l'a donné. */
  compte: string
  /** Nom affiché du compte au moment de la préparation (l'appli relit le nom à jour quand elle peut). */
  nom: string
}

export type ActionRole = Compte & { a: 'role'; role: RoleProposable; avant: string | null }
export type ActionUnite = Compte & { a: 'unite'; uniteId: string; unite: string; roleUnite: RoleUnite }
export type ActionSecteur = Compte & { a: 'secteur'; depts: string[] }
export type ActionArchiver = { a: 'archiver'; quoi: 'evenement' | 'groupe'; id: string; nom: string; date?: string }
export type ActionFusion = { a: 'fusion'; garder: string; fondre: string }
export type ActionAdmin = ActionRole | ActionUnite | ActionSecteur | ActionArchiver | ActionFusion

/** Sorte d'une action (une proposition n'en mêle pas deux). */
export const sorteDe = (x: ActionAdmin): AdminSorte => (x.a === 'unite' || x.a === 'secteur' ? 'perimetre' : x.a)

export const SORTE_LIBELLE: Record<AdminSorte, string> = {
  role: 'Rôles',
  perimetre: 'Périmètres',
  archiver: 'Archivage',
  fusion: 'Fusions de fiches',
}

const texte = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '') // eslint-disable-line no-control-regex
const id = (v: unknown) => (typeof v === 'string' && /^[\w.:-]{1,80}$/.test(v) ? v : '')
const unDe = <T extends string>(xs: readonly T[], v: unknown): T | undefined => xs.find((x) => x === v)

function compteDe(o: Record<string, unknown>): Compte | null {
  const userId = id(o.userId)
  const compte = texte(o.compte, 12)
  if (!userId || !/^C-[0-9A-Z]{7}$/.test(compte)) return null
  return { userId, compte, nom: texte(o.nom, ADMIN_LIMITES.nom) }
}

/** Une ligne déposée → action, ou null (forme inconnue : l'appli ne la montre pas comme applicable). */
export function lireAction(l: unknown): ActionAdmin | null {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null
  const o = l as Record<string, unknown>
  switch (o.a) {
    case 'role': {
      const c = compteDe(o)
      const role = unDe(ROLES_PROPOSABLES, o.role)
      if (!c || !role) return null
      return { a: 'role', ...c, role, avant: typeof o.avant === 'string' ? texte(o.avant, 20) : null }
    }
    case 'unite': {
      const c = compteDe(o)
      const uniteId = id(o.uniteId)
      const roleUnite = unDe(ROLES_UNITE, o.roleUnite)
      if (!c || !uniteId || !roleUnite) return null
      return { a: 'unite', ...c, uniteId, unite: texte(o.unite, ADMIN_LIMITES.nom) || 'Unité', roleUnite }
    }
    case 'secteur': {
      const c = compteDe(o)
      if (!c || !Array.isArray(o.depts) || o.depts.length > ADMIN_LIMITES.departements) return null
      const depts = [...new Set(o.depts.map((d) => String(d)))]
      if (depts.some((d) => !DEPT_RE.test(d))) return null
      return { a: 'secteur', ...c, depts }
    }
    case 'archiver': {
      const quoi = unDe(['evenement', 'groupe'] as const, o.quoi)
      const x = id(o.id)
      if (!quoi || !x) return null
      const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : undefined
      return { a: 'archiver', quoi, id: x, nom: texte(o.nom, ADMIN_LIMITES.nom) || (quoi === 'groupe' ? 'Groupe' : 'Événement'), ...(date ? { date } : {}) }
    }
    case 'fusion': {
      const garder = id(o.garder)
      const fondre = id(o.fondre)
      if (!garder || !fondre || garder === fondre) return null
      return { a: 'fusion', garder, fondre }
    }
    default:
      return null
  }
}

/** Saison sportive d'une date (septembre → août) : « 2025-26 ». */
export function saisonDe(date?: string): string | undefined {
  if (!date || !/^\d{4}-\d{2}/.test(date)) return undefined
  const y = +date.slice(0, 4)
  const debut = +date.slice(5, 7) >= 9 ? y : y - 1
  return `${debut}-${String((debut + 1) % 100).padStart(2, '0')}`
}
