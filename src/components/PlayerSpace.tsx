import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtDate, dayOf, positionLabel, TRIAL, type Player, type PlayerSelf } from '../db'
import { w } from '../gender'
import { appName } from '../appBrand'
import { clubYears, formatInviteCode, INVITE_DAYS, inviteMessage, letterQuestions, selfIsEmpty } from '../playerSpace'
import { can, isPlayerRole, useRole, type Role } from '../roles'
import { supabase } from '../sync'
import { ask, inform } from './Confirm'
import { Icon } from './ui'

/*
 * Espace joueur, côté STAFF (supabase/051_espace_joueur.sql) : sur la fiche d'un joueur,
 *  - « Ce que dit le joueur / la joueuse » : ce qu'il a écrit lui-même (clé `self`), en lecture seule ;
 *  - l'accès joueur : donner un code (hb_invite_player), le copier avec un message prêt à envoyer, retirer l'accès
 *    (hb_revoke_player_access), état du compte relié (hb_player_access) ; administrateurs et encadrants qui ont le droit de
 *    modifier la fiche (le serveur vérifie : hb_can_invite) ;
 *  - « Voir sa page » : aperçu de /moi en lecture seule (administrateurs, mode essai).
 */

// ---------- Ce que le joueur a écrit ----------

/** Section de la fiche : affichée seulement si le joueur a écrit quelque chose. */
export function SelfSection({ player }: { player: Player }) {
  const self = player.self
  if (selfIsEmpty(self)) return null
  const g = w(player.sex)
  const letter = letterQuestions(player.sex).filter((q) => self!.letter?.[q.key])
  const path = self!.path
  return (
    <div className="card p-4" data-testid="ce-que-dit-le-joueur">
      <div className="section-title">Ce que dit {g.leJoueur}</div>
      <p className="mb-2 text-[10px] text-muted">
        Écrit par {g.leJoueur} depuis son espace joueur{self!.updatedAt ? `, le ${fmtDate(dayOf(self!.updatedAt))}` : ''}. Lecture seule : seul{g.e} {g.leJoueur} le modifie.
      </p>
      {letter.length > 0 && (
        <div className="flex flex-col gap-2">
          {letter.map((q) => (
            <div key={q.key}>
              <div className="text-[10px] font-bold text-muted">{q.label}</div>
              <div className="text-sm whitespace-pre-wrap">{self!.letter![q.key]}</div>
            </div>
          ))}
        </div>
      )}
      {path && <SelfPathView path={path} className={letter.length ? 'mt-3 border-t border-line pt-3' : ''} />}
    </div>
  )
}

/** « Mon parcours » en lecture (fiche du staff, aperçu). */
export function SelfPathView({ path, className = '' }: { path: NonNullable<PlayerSelf['path']>; className?: string }) {
  const rows: [string, string[]][] = [
    ['Clubs', (path.clubs ?? []).map((c) => [c.name, clubYears(c)].filter(Boolean).join(' · '))],
    ['Postes joués', (path.positions ?? []).map((p) => positionLabel(p))],
    ['Sélections', path.selections ?? []],
    ['Palmarès', path.honours ?? []],
  ]
  const shown = rows.filter(([, v]) => v.length)
  if (!shown.length) return null
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {shown.map(([k, v]) => (
        <div key={k}>
          <div className="text-[10px] font-bold text-muted">{k}</div>
          <ul className="text-sm">
            {v.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// ---------- Accès joueur ----------

export interface PlayerAccess {
  linked: boolean
  since?: string | null
  code?: string | null
  expires_at?: string | null
}

export type AccessState =
  | { kind: 'loading' }
  /** Serveur absent (mode local) ou script 051 pas passé : pas d'accès joueur à gérer. */
  | { kind: 'unavailable'; why: string }
  | { kind: 'ready'; access: PlayerAccess }

/** Le staff peut-il gérer l'accès joueur de cette fiche (règle de l'appli ; le serveur vérifie, hb_can_invite) ? */
export const canInvite = (role: Role, p: Player) => (role === 'admin' || role === 'preparateur') && can.editPlayer(role, p) && !p.review

/** État de l'accès joueur d'une fiche et actions (donner un code, retirer) ; rien sans serveur ni droit. */
export function usePlayerAccess(p: Player) {
  const role = useRole()
  const allowed = !!supabase && canInvite(role, p)
  const [state, setState] = useState<AccessState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const load = async () => {
    if (!allowed) return setState({ kind: 'unavailable', why: supabase ? 'droits' : 'local' })
    const { data, error } = await supabase!.rpc('hb_player_access', { p_player_id: p.id })
    if (error) return setState({ kind: 'unavailable', why: error.code === 'PGRST202' ? 'script' : error.message })
    setState({ kind: 'ready', access: data as PlayerAccess })
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, allowed])

  async function invite() {
    if (!allowed || busy) return
    if (!navigator.onLine) return inform('Il faut être en ligne pour donner un accès joueur.')
    setBusy(true)
    const { data, error } = await supabase!.rpc('hb_invite_player', { p_player_id: p.id })
    setBusy(false)
    if (error) return inform(error.code === 'PGRST202' ? 'Exécute d’abord supabase/051_espace_joueur.sql dans Supabase.' : `Impossible : ${error.message}`)
    const r = data as { code: string; expires_at: string; reused: boolean }
    setState({ kind: 'ready', access: { linked: false, code: r.code, expires_at: r.expires_at } })
    void load()
  }
  async function revoke() {
    if (!allowed || busy) return
    const g = w(p.sex)
    if (!(await ask(`Retirer l’accès joueur ${g.duJoueur} ? ${g.Il} ne verra plus sa page (ce qu’${g.il} a écrit reste sur la fiche) ; un nouveau code sera nécessaire.`, { ok: 'Retirer l’accès', danger: true, focusCancel: true })))
      return
    if (!navigator.onLine) return inform('Il faut être en ligne pour retirer un accès.')
    setBusy(true)
    const { error } = await supabase!.rpc('hb_revoke_player_access', { p_player_id: p.id })
    setBusy(false)
    if (error) return inform(`Impossible : ${error.message}`)
    setState({ kind: 'ready', access: { linked: false } })
  }
  return { state, busy, invite, revoke, allowed }
}

/** Copie dans le presse-papiers ; message si l'appareil ne le permet pas. */
async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    await inform(`${what} copié.`)
  } catch {
    await inform(`Copie impossible ici : ${text}`)
  }
}

/** Aperçu « ce que voit le joueur » : administrateurs (appli du staff), et mode essai / local (pas de compte réel). */
export const canPreviewPlayerPage = (role: Role) => !isPlayerRole(role) && (role === 'admin' || TRIAL || !supabase)

/**
 * Carte « Espace joueur » de la fiche (onglet Profil) : état de l'accès, code en cours (copier le code, copier le message
 * prêt à envoyer), donner / retirer l'accès, aperçu de sa page.
 */
export function PlayerAccessCard({ player: p, access }: { player: Player; access: ReturnType<typeof usePlayerAccess> }) {
  const role = useRole()
  const g = w(p.sex)
  const preview = canPreviewPlayerPage(role)
  const { state, busy } = access
  // Sans serveur, sans droit ou sans le script 051 : rien à gérer ; la carte ne reste que pour l'aperçu.
  if (state.kind === 'unavailable' && !preview) return null
  const a = state.kind === 'ready' ? state.access : null
  const code = a?.code ? formatInviteCode(a.code) : null
  return (
    <div className="card p-4" data-testid="espace-joueur">
      <div className="section-title">Espace joueur</div>
      <p className="mb-2 text-[11px] text-muted">
        {g.LeJoueur} (ou sa famille) peut avoir un compte qui ne voit que sa fiche, et y écrire « Ma lettre » et « Mon parcours ».
      </p>
      {state.kind === 'loading' && <p className="text-xs text-muted">Chargement…</p>}
      {state.kind === 'unavailable' && state.why === 'script' && <p className="text-xs text-muted">Pas encore ouvert sur ce serveur (script 051 à passer).</p>}
      {state.kind === 'unavailable' && state.why === 'local' && <p className="text-xs text-muted">Avec le serveur : donner un code d’accès {g.auJoueur}.</p>}
      {a && (
        <div className="flex flex-col gap-2 text-xs">
          {a.linked ? (
            <p>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Accès joueur actif</span>
              {a.since && <span className="ml-2 text-muted">depuis le {fmtDate(dayOf(a.since))}</span>}
            </p>
          ) : code ? (
            <>
              <p>
                Code à transmettre : <b className="font-mono text-base tracking-widest">{code}</b>
                {a.expires_at && <span className="ml-2 text-muted">valable jusqu’au {fmtDate(dayOf(a.expires_at))}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void copyText(a.code!, 'Code')}>
                  <Icon name="copy" className="mr-1 inline h-3.5 w-3.5" />
                  Copier le code
                </button>
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void copyText(inviteMessage(a.code!, appName(), INVITE_DAYS), 'Message')}>
                  Copier le message
                </button>
              </div>
              <p className="text-[10px] text-muted">« {inviteMessage(a.code!, appName(), INVITE_DAYS)} ». Le compte du jeune (rôle Joueur) se crée dans Réglages → Utilisateurs.</p>
            </>
          ) : (
            <p className="text-muted">Pas d’accès pour l’instant.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {!a.linked && !code && (
              <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void access.invite()}>
                {busy ? '…' : 'Donner un accès joueur'}
              </button>
            )}
            {(a.linked || code) && (
              <button className="btn-ghost px-3 py-1.5 text-xs text-red-300" disabled={busy} onClick={() => void access.revoke()}>
                {a.linked ? 'Retirer l’accès' : 'Annuler le code'}
              </button>
            )}
          </div>
        </div>
      )}
      {preview && (
        <Link to={`/moi?joueur=${p.id}`} className="btn-ghost mt-2 block w-fit px-3 py-1.5 text-xs">
          <Icon name="eye" className="mr-1 inline h-3.5 w-3.5" />
          Voir sa page (aperçu)
        </Link>
      )}
    </div>
  )
}
