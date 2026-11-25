// Nextar, serveur MCP : nextar_admin_proposer, le SEUL outil d'administration qui écrit, et il n'écrit qu'une PROPOSITION.
// « Claude prépare, l'admin valide d'un toucher » : l'outil vérifie chaque action demandée et dépose celles qui sont prêtes
// dans la boîte « À valider » de l'administrateur (hb_propositions, sorte « admin », supabase/070_propositions_admin.sql).
// RIEN ne s'applique ici : l'administrateur coche, puis « Appliquer » dans l'appli, qui passe par les mêmes chemins que ses
// écrans (src/propositionsAdmin.ts : hb_update_member, Structure, menus Archiver, hb_merge_players), avec les mêmes contrôles
// de droits côté base.
//
// Sortes (une par proposition, 50 actions au plus, src/propositionsAdminCore.ts) :
//  - role      : donner ou changer le rôle d'un compte (code C-…) : Observateur, Encadrant, Joueur (compte en attente
//                seulement) ; jamais administrateur, jamais un administrateur (le dernier encore moins), jamais son propre
//                compte ;
//  - perimetre : affecter un compte à une unité de la structure (Structure), ou poser son secteur (départements, Réglages ›
//                Membres) ;
//  - archiver  : archiver des événements et des groupes (identifiants de nextar_contexte), ou tous les événements datés avant
//                un jour (fin de saison) ;
//  - fusion    : fondre une fiche joueur dans une autre (codes J-… : fiche à garder, fiche à fondre ; l'admin peut inverser).
// Règles (celles des autres outils d'administration, admin.ts) :
//  1. le rôle D'ABORD : un compte qui n'est pas administrateur reçoit un refus, et rien n'est lu ni écrit ; la base, elle,
//     refuserait la sorte « admin » (070) ;
//  2. jeton du compte, jamais la clé de service ;
//  3. réponse par sa liste blanche (outils.ts, CLES_ADMIN.nextar_admin_proposer) : joueurs en codes J-…, comptes en code C-…
//     avec nom affiché et rôle, jamais d'adresse mail, d'identifiant brut ni de nom de joueur ;
//  4. 070 pas appliqué : « boîte admin indisponible tant que 070 n'est pas appliqué », rien n'est déposé.
// Fichier sans import Deno (testable avec npx jiti, tools/test-mcp.ts).

import { codeJoueur, normaliserCode } from './partage/codesJoueurs.ts'
import { nameKey } from './partage/nameMatch.ts'
import {
  ADMIN_LIMITES,
  ADMIN_SORTES,
  DEPT_RE,
  saisonDe,
  type ActionAdmin,
  type AdminSorte,
  type RoleProposable,
  type RoleUnite,
} from './partage/propositionsAdminCore.ts'
import { REFUS_ADMIN } from './admin.ts'
import { BORNES, clip, codeCompte, lienBoite, ROLE_LIBELLE, SANS_NOM, SANS_ROLE, sansCoordonnees, uniq, type ProfilSrv, type Reglages, type Source } from './outils.ts'

export const INDISPONIBLE_070 = 'Boîte admin indisponible tant que supabase/070_propositions_admin.sql n’est pas appliqué : rien n’a été déposé.'

/** Une action demandée par Claude (les champs utiles dépendent de la sorte). */
export interface DemandeAdmin {
  /** role, perimetre : code du compte (« C-… », nextar_connexions, nextar_admin_a_faire, nextar_admin_activite). */
  compte?: string
  /** role : « observateur », « encadrant » (ou « preparateur »), « joueur ». */
  role?: string
  /** perimetre : unité de la structure (identifiant ou nom). */
  unite?: string
  /** perimetre (unité) : rôle dans l'unité (« encadrant », « observateur », « administrateur ») ; défaut : son rôle. */
  role_unite?: string
  /** perimetre : secteur (départements : « 83 », « 2A », « 971 ») ; liste vide : aucun secteur. */
  secteur?: string[]
  /** archiver : identifiant d'un événement (nextar_contexte, archives comprises). */
  evenement?: string
  /** archiver : identifiant d'un groupe. */
  groupe?: string
  /** fusion : code de la fiche à garder. */
  garder?: string
  /** fusion : code de la fiche à fondre dans l'autre. */
  fondre?: string
}

export interface AdminProposerInput {
  sorte?: string
  titre?: string
  actions?: DemandeAdmin[]
  /** archiver : en plus, tous les événements non archivés datés AVANT ce jour (AAAA-MM-JJ), les plus anciens d'abord. */
  evenements_avant?: string
}

type Retour = Record<string, unknown> & { n: number; etat: 'prête' | 'refusée' }
const refus = (n: number, raison: string, plus: Record<string, unknown> = {}): Retour => ({ n, etat: 'refusée', raison, ...plus })

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
const nomAffiche = (p?: ProfilSrv | null) => sansCoordonnees(p?.fullName, 80) || SANS_NOM
const libelleRole = (r?: string | null) => (r && ROLE_LIBELLE[r]) || SANS_ROLE

/** « encadrant » → preparateur ; « administrateur » → admin ; inconnu : undefined. */
function roleDe(v: unknown): string | undefined {
  const k = nameKey(String(v ?? '')).replace(/\s+/g, '')
  if (!k) return undefined
  if (k === 'observateur' || k === 'observatrice') return 'observateur'
  if (k === 'encadrant' || k === 'encadrante' || k === 'preparateur' || k === 'preparatrice') return 'preparateur'
  if (k === 'joueur' || k === 'joueuse') return 'joueur'
  if (k === 'admin' || k === 'administrateur' || k === 'administratrice') return 'admin'
  return undefined
}

/** « C-xxxxxxx » (minuscules, O lu 0, I et L lus 1) → forme canonique ; mal formé : null. */
const codeC = (s: unknown) => {
  const m = /^\s*[Cc]-([0-9A-Za-z]{7})\s*$/.exec(String(s ?? ''))
  const j = m ? normaliserCode(`J-${m[1]}`) : null
  return j ? `C-${j.slice(2)}` : null
}

const TITRE: Record<AdminSorte, (n: number) => string> = {
  role: (n) => (n > 1 ? `Rôles à donner (${n})` : 'Rôle à donner'),
  perimetre: (n) => (n > 1 ? `Affectations (${n})` : 'Affectation'),
  archiver: (n) => `Archivage (${n})`,
  fusion: (n) => (n > 1 ? `Fusions de fiches (${n})` : 'Fusion de fiches'),
}

export async function outilAdminProposer(src: Source, reg: Reglages, input: AdminProposerInput = {}) {
  // Le rôle d'abord : rien n'est lu ni écrit pour un compte qui n'est pas administrateur.
  if (!(await src.estAdmin())) return { erreur: REFUS_ADMIN }
  const sorte = ADMIN_SORTES.find((s) => s === input.sorte)
  if (!sorte) return { erreur: `Sorte inconnue : « ${clip(input.sorte ?? '', 20)} ». Choisis « role », « perimetre », « archiver » ou « fusion ».` }
  const demandes = Array.isArray(input.actions) ? input.actions.map((d) => (d && typeof d === 'object' ? d : {})) : []
  if (input.evenements_avant !== undefined && sorte !== 'archiver') return { erreur: '`evenements_avant` ne sert qu’à la sorte « archiver ».' }
  if (input.evenements_avant !== undefined && !isDate(input.evenements_avant)) return { erreur: '`evenements_avant` : une date AAAA-MM-JJ.' }
  if (demandes.length > BORNES.adminActions) return { erreur: `${BORNES.adminActions} actions au plus par proposition (${demandes.length} reçues) : découpe en plusieurs propositions.` }
  if (!demandes.length && !input.evenements_avant) return { erreur: 'Aucune action : donne `actions` (ou `evenements_avant` pour archiver).' }

  const avertissements: string[] = []
  const retours: Retour[] = []
  const pretes: ActionAdmin[] = []
  const pret = (n: number, a: ActionAdmin, plus: Record<string, unknown>) => {
    pretes.push(a)
    retours.push({ n, etat: 'prête', ...plus })
  }
  let reste = 0

  if (sorte === 'role' || sorte === 'perimetre') {
    const [profils, moi, unites] = await Promise.all([src.profils(), src.moi(), sorte === 'perimetre' && demandes.some((d) => d.unite) ? src.unites() : Promise.resolve([])])
    const parCode = new Map<string, ProfilSrv[]>()
    for (const p of profils) parCode.set(codeCompte(p.userId), [...(parCode.get(codeCompte(p.userId)) ?? []), p])
    const admins = profils.filter((p) => p.role === 'admin').length
    const vus = new Set<string>()
    demandes.forEach((d, i) => {
      const n = i + 1
      const code = codeC(d.compte)
      if (!code) return retours.push(refus(n, 'code de compte manquant ou mal formé (« C- » puis 7 signes)'))
      const trouves = parCode.get(code) ?? []
      if (!trouves.length) return retours.push(refus(n, 'compte introuvable (code inconnu, compte supprimé ou compte joueur)', { compte: code }))
      if (trouves.length > 1) return retours.push(refus(n, 'code partagé par plusieurs comptes : à faire dans Réglages › Membres', { compte: code }))
      const p = trouves[0]
      const qui = { compte: code, nom_affiche: nomAffiche(p), role_actuel: libelleRole(p.role) }
      const base = { userId: p.userId, compte: code, nom: clip(nomAffiche(p), ADMIN_LIMITES.nom) }
      const cle = `${sorte}:${p.userId}:${d.unite ?? ''}`
      if (vus.has(cle)) return retours.push(refus(n, 'déjà demandé plus haut dans cette proposition', qui))
      if (p.role === 'admin' && admins <= 1 && sorte === 'role') return retours.push(refus(n, 'dernier administrateur : jamais rétrogradé', qui))
      if (!moi) return retours.push(refus(n, 'compte de la session inconnu : impossible de vérifier qu’il ne s’agit pas du tien', qui))
      if (p.userId === moi && sorte === 'role') return retours.push(refus(n, 'ton propre rôle ne se change jamais depuis Claude', qui))
      if (sorte === 'role') {
        const voulu = roleDe(d.role)
        if (!voulu) return retours.push(refus(n, 'rôle manquant ou inconnu (observateur, encadrant, joueur)', qui))
        if (voulu === 'admin') return retours.push(refus(n, 'un administrateur se nomme uniquement depuis Supabase (SQL Editor)', qui))
        if (p.role === 'admin') return retours.push(refus(n, 'compte administrateur : son rôle se change uniquement depuis Supabase (SQL Editor)', qui))
        if (p.role === voulu) return retours.push(refus(n, `a déjà le rôle ${libelleRole(voulu)}`, qui))
        if (voulu === 'joueur' && p.role) return retours.push(refus(n, 'un membre du staff ne devient compte joueur que depuis Réglages › Membres (confirmation)', qui))
        vus.add(cle)
        return pret(n, { a: 'role', ...base, role: voulu as RoleProposable, avant: p.role ?? null }, { ...qui, role: libelleRole(voulu) })
      }
      // Périmètre : une unité OU un secteur.
      if (!p.role || p.role === 'joueur') return retours.push(refus(n, 'compte sans rôle du staff : donne-lui d’abord un rôle', qui))
      const aSecteur = Array.isArray(d.secteur)
      if (!!d.unite === aSecteur) return retours.push(refus(n, 'donne une unité OU un secteur (départements), pas les deux', qui))
      if (aSecteur) {
        if (p.role === 'admin') return retours.push(refus(n, 'un administrateur voit toute la base : pas de secteur', qui))
        const depts = uniq((d.secteur ?? []).map((x) => String(x).trim().toUpperCase()))
        if (depts.length > ADMIN_LIMITES.departements) return retours.push(refus(n, `${ADMIN_LIMITES.departements} départements au plus`, qui))
        const faux = depts.filter((x) => !DEPT_RE.test(x))
        if (faux.length) return retours.push(refus(n, `département inconnu : ${faux.slice(0, 5).map((x) => clip(x, 4)).join(', ')}`, qui))
        if (p.userId === moi) return retours.push(refus(n, 'ton propre périmètre ne se change jamais depuis Claude', qui))
        vus.add(cle)
        return pret(n, { a: 'secteur', ...base, depts }, { ...qui, secteur: depts.length ? depts : 'aucun (valide tous les départements)' })
      }
      const ref = String(d.unite ?? '').trim()
      const parId = unites.find((u) => u.id === ref)
      const parNom = parId ? [parId] : unites.filter((u) => nameKey(u.name) === nameKey(ref))
      if (!parNom.length) return retours.push(refus(n, `unité introuvable : « ${clip(sansCoordonnees(ref, 80), 80)} »`, qui))
      if (parNom.length > 1) return retours.push(refus(n, 'plusieurs unités portent ce nom : donne l’identifiant', qui))
      const u = parNom[0]
      const ru = d.role_unite === undefined ? p.role : roleDe(d.role_unite)
      if (!ru || !['admin', 'preparateur', 'observateur'].includes(ru)) return retours.push(refus(n, 'rôle dans l’unité inconnu (encadrant, observateur, administrateur)', qui))
      if (ru === 'admin' && p.role !== 'admin') return retours.push(refus(n, 'rôle « administrateur » dans une unité : seulement pour un compte administrateur', qui))
      vus.add(cle)
      return pret(n, { a: 'unite', ...base, uniteId: u.id, unite: clip(sansCoordonnees(u.name, ADMIN_LIMITES.nom), ADMIN_LIMITES.nom), roleUnite: ru as RoleUnite }, { ...qui, unite: clip(sansCoordonnees(u.name, 120), 120), role_unite: libelleRole(ru) })
    })
  } else if (sorte === 'archiver') {
    const [evs, grs] = await Promise.all([src.evenements({ archives: true }), src.groupes({ archives: true })])
    const vus = new Set<string>()
    const quoiDe = (q: 'evenement' | 'groupe') => (q === 'groupe' ? 'groupe' : 'événement')
    const archiver = (n: number, q: 'evenement' | 'groupe', ref: string) => {
      const x = q === 'groupe' ? grs.find((g) => g.id === ref) : evs.find((e) => e.id === ref)
      if (!x) return retours.push(refus(n, `${quoiDe(q)} introuvable : donne l’identifiant de nextar_contexte`, { quoi: quoiDe(q) }))
      const date = 'date' in x && isDate(x.date) ? x.date : undefined
      const plus = { quoi: quoiDe(q), id: x.id, libelle: clip(sansCoordonnees(x.name, 120), 120), ...(date ? { date } : {}) }
      if (vus.has(`${q}:${x.id}`)) return retours.push(refus(n, 'déjà demandé plus haut dans cette proposition', plus))
      if (x.archived) return retours.push(refus(n, 'déjà archivé', plus))
      if (q === 'groupe' && 'pole' in x && x.pole) return retours.push(refus(n, 'groupe Pôle : il passe d’une saison à l’autre par « Changement de saison », jamais archivé à la main', plus))
      vus.add(`${q}:${x.id}`)
      pret(n, { a: 'archiver', quoi: q, id: x.id, nom: clip(sansCoordonnees(x.name, ADMIN_LIMITES.nom), ADMIN_LIMITES.nom), ...(date ? { date } : {}) }, plus)
    }
    demandes.forEach((d, i) => {
      const n = i + 1
      if (!!d.evenement === !!d.groupe) return retours.push(refus(n, 'donne un événement OU un groupe (identifiant)'))
      archiver(n, d.evenement ? 'evenement' : 'groupe', String(d.evenement ?? d.groupe).trim())
    })
    if (input.evenements_avant) {
      const avant = input.evenements_avant
      const cibles = evs
        .filter((e) => !e.archived && isDate(e.date) && e.date < avant && !vus.has(`evenement:${e.id}`))
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id))
      const place = Math.max(0, BORNES.adminActions - demandes.length)
      cibles.slice(0, place).forEach((e, k) => archiver(demandes.length + k + 1, 'evenement', e.id))
      reste = Math.max(0, cibles.length - place)
      const sansDate = evs.filter((e) => !e.archived && !isDate(e.date)).length
      if (!cibles.length) avertissements.push(`Aucun événement non archivé daté avant le ${avant}.`)
      if (reste) avertissements.push(`${reste} autres événements datés avant le ${avant} : 50 actions au plus par proposition ; relance après validation.`)
      if (sansDate) avertissements.push(`${sansDate} événements sans date ne sont pas concernés.`)
    }
  } else {
    // Fusion : codes J-… résolus sur les identifiants des fiches (rien d'autre n'est lu).
    const { fiches, tronque } = await src.idsFiches(BORNES.nomsMax)
    if (tronque) return { erreur: `Plus de ${BORNES.nomsMax} fiches : les codes ne peuvent pas être résolus avec certitude. Fonds les fiches dans l’appli (écran « Propositions »).` }
    const parCode = new Map<string, { id: string; fondue: boolean }[]>()
    for (const f of fiches) parCode.set(codeJoueur(f.id), [...(parCode.get(codeJoueur(f.id)) ?? []), f])
    const vus = new Set<string>()
    demandes.forEach((d, i) => {
      const n = i + 1
      const cg = normaliserCode(String(d.garder ?? ''))
      const cf = normaliserCode(String(d.fondre ?? ''))
      const plus = { ...(cg ? { garder: cg } : {}), ...(cf ? { fondre: cf } : {}) }
      if (!cg || !cf) return retours.push(refus(n, 'donne `garder` et `fondre` : deux codes « J- » puis 7 signes', plus))
      if (cg === cf) return retours.push(refus(n, 'les deux codes désignent la même fiche', plus))
      const g = parCode.get(cg) ?? []
      const f = parCode.get(cf) ?? []
      for (const [c, xs] of [[cg, g], [cf, f]] as const) {
        if (!xs.length) return retours.push(refus(n, `fiche introuvable : ${c} (code mal recopié, ou fiche supprimée)`, plus))
        if (xs.length > 1) return retours.push(refus(n, `code partagé par plusieurs fiches : ${c} ; fusion à faire dans l’appli`, plus))
        if (xs[0].fondue) return retours.push(refus(n, `fiche déjà fondue dans une autre : ${c}`, plus))
      }
      if (vus.has(g[0].id) || vus.has(f[0].id)) return retours.push(refus(n, 'une de ces fiches est déjà dans une autre fusion de cette proposition', plus))
      vus.add(g[0].id)
      vus.add(f[0].id)
      pret(n, { a: 'fusion', garder: g[0].id, fondre: f[0].id }, plus)
    })
  }

  retours.sort((a, b) => a.n - b.n)
  const nPretes = retours.filter((r) => r.etat === 'prête').length
  const resume = { pretes: nPretes, refusees: retours.length - nPretes }
  const titre = clip(sansCoordonnees(input.titre?.trim() || defautTitre(sorte, pretes), BORNES.titreProposition), BORNES.titreProposition) || 'Proposition d’administration'
  const commun = { sorte, resume, actions: retours, ...(reste ? { reste } : {}) }
  if (!nPretes)
    return {
      etat: 'non déposée',
      titre,
      ...commun,
      message: 'Aucune action prête : rien n’a été déposé. Les raisons sont données action par action.',
      avertissements,
    }
  const dep = await src.deposerPropositionAdmin({ titre, contexte: { sorte, version: 1 }, lignes: pretes as unknown as Record<string, unknown>[] })
  if ('indisponible' in dep) return { erreur: INDISPONIBLE_070, etat: 'non déposée', titre, ...commun }
  if ('erreur' in dep) return { erreur: `Proposition non déposée : ${clip(sansCoordonnees(dep.erreur, 300), 300)}`, etat: 'non déposée', titre, ...commun }
  return {
    id: dep.id,
    etat: 'en_attente',
    titre,
    ...commun,
    lien_boite: lienBoite(reg),
    message:
      'Proposition déposée dans la boîte « À valider » de l’administrateur : RIEN n’est appliqué avant qu’il coche et touche « Appliquer » dans l’appli ' +
      '(mêmes chemins et mêmes droits que ses écrans). Les actions refusées n’y sont pas.',
    avertissements: [...avertissements, ...(resume.refusees ? [`${resume.refusees} action(s) refusée(s) : non déposée(s).`] : [])],
  }
}

function defautTitre(sorte: AdminSorte, pretes: readonly ActionAdmin[]): string {
  if (sorte === 'archiver') {
    const evs = pretes.filter((a) => a.a === 'archiver' && a.quoi === 'evenement') as Extract<ActionAdmin, { a: 'archiver' }>[]
    const saisons = uniq(evs.map((e) => saisonDe(e.date)).filter((s): s is string => !!s))
    if (evs.length && evs.length === pretes.length && saisons.length === 1) return `Fin de saison ${saisons[0]} : ${evs.length} événement${evs.length > 1 ? 's' : ''} à archiver`
  }
  return TITRE[sorte](pretes.length)
}
