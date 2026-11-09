import { useEffect, useRef, useState, type ReactNode } from 'react'
import { today as todayDay, type Player } from '../db'
import { w } from '../gender'
import { DAILY_TASKS, TASK, todayLine } from '../lamp'
import { isWeekday, type WellnessSession } from '../wellness'
import { MyObjectives } from './Objectives'
import { CahierWindow, useMyLamp } from './PlayerLamp'
import { TalkLink } from './PlayerJournal'
import { SelfEvalSection } from './SelfEval'
import { History, MorningForm, RecentSessions, SessionForm, useMyWellness, WellnessSummary } from './Wellness'

/*
 * Onglet « Aujourd'hui » de « Ma page » du jeune (src/pages/Me.tsx), en « tableau de bord de jeu » depuis le 09/11 :
 * maquette validée par Geoffroy (« les jeunes, ça les fait chier de lire… un truc plus péchu, je comprends de suite ce qui
 * se passe »), style jeu vidéo au thème NEXTAR (bloc .hud de src/index.css : bleu nuit en clair comme en sombre, formes
 * obliques, gros mots en italique, émojis). Pour des jeunes de 10 à 18 ans : on comprend sans lire.
 *  1. « TA JOURNÉE » : grosse flamme, « C'est parti ! » / « Encore 2 ! » / « Encore 1 ! » / « Journée allumée ! », barre de 3
 *     segments (les 3 missions qui allument une journée de la lampe : wellness, au moins une séance, cahier du hand ; mêmes
 *     règles et données que l'onglet Ma lampe : useMyLamp, src/lamp.ts), la série en cours si elle existe. Lampe fermée :
 *     les missions qui existent (forme, séance), sans série. Jour non demandé (week-end, vacances, férié) : un mot neutre.
 *  2. Trois grosses tuiles : ⚡ Forme (saisie de la forme), 🏃 Séance, ✏️ Cahier (fenêtre du cahier du hand du jour, la même
 *     que dans Ma lampe) ; faite : turquoise et ✓.
 *  3. Les matchs à raconter (src/components/SelfEval.tsx, variante hud : mêmes délais).
 *  4. Plus discrets : 🎯 Mes objectifs (déplie la liste), 💬 J'ai besoin d'en parler, 📈 Mes 14 jours.
 * Wellness pas demandé (réglage fermé, groupe pas activé) ou aperçu d'un administrateur avec le serveur : l'écran d'avant
 * (objectifs et « Comment ça s'est passé ? » en cartes). Les envois (hb_wellness_enregistrer, hb_wellness_seance,
 * hb_cahier_enregistrer) ne changent pas : seule l'interface change.
 */

type Panel = 'forme' | 'seance' | 'historique'

const MISSION: Record<'wellness' | 'seance' | 'cahier', { emoji: string; label: string; done: string }> = {
  wellness: { emoji: '⚡', label: 'Forme', done: 'forme envoyée' },
  seance: { emoji: '🏃', label: 'Séance', done: 'séance notée' },
  cahier: { emoji: '✏️', label: 'Cahier', done: 'cahier du hand rempli' },
}

export function TodayHud({
  player: p,
  canWrite,
  sheets,
  onPending,
  onHud,
}: {
  player: Player
  canWrite: boolean
  /** Sport avec l'onglet Mes matchs : seulement les auto-évaluations à remplir ici. */
  sheets: boolean
  /** Questionnaire du jour à remplir : point sur l'onglet. */
  onPending?: (pending: boolean) => void
  /** Écran en tableau de bord (« J'ai besoin d'en parler » y est déjà : pas une 2e fois en bas de la page). */
  onHud?: (on: boolean) => void
}) {
  const wl = useMyWellness(p.id, canWrite)
  const lamp = useMyLamp(p.id, wl.mine)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [editSession, setEditSession] = useState<WellnessSession | null>(null)
  const [cahierOpen, setCahierOpen] = useState(false)
  const [goals, setGoals] = useState(false)
  const [msg, setMsg] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => onPending?.(wl.pending), [wl.pending, onPending])
  const wellOn = !!wl.data?.enabled && !!wl.data.requested
  const hud = wl.mine && wellOn && lamp.loaded
  useEffect(() => onHud?.(hud), [hud, onHud])
  // Panneau ouvert (forme, séance, 14 jours) : amené à l'écran.
  useEffect(() => {
    if (panel) panelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [panel])

  const selfEval = <SelfEvalSection player={p} canWrite={canWrite} only={sheets ? 'current' : undefined} hud={hud} />

  // Aperçu d'un administrateur avec le serveur : rien n'est lu ; l'écran d'avant.
  if (!wl.mine) {
    const g = w(p.sex)
    return (
      <>
        <p className="text-[11px] text-muted" data-testid="wellness-apercu">
          Wellness : si son groupe le demande, le questionnaire du matin s’affiche ici pour {g.leJoueur} (ses réponses ne sont lues que par le staff du groupe).
        </p>
        <MyObjectives player={p} canWrite={canWrite} />
        {selfEval}
      </>
    )
  }
  if (wl.data === undefined || (wellOn && !lamp.loaded)) return <p className="py-8 text-center text-xs text-muted">Chargement…</p>
  // Wellness pas demandé : l'écran d'avant (objectifs, « Comment ça s'est passé ? »).
  if (!wellOn)
    return (
      <>
        {wl.err && <p className="text-[11px] text-muted">{wl.err}</p>}
        <MyObjectives player={p} canWrite={canWrite} />
        {selfEval}
      </>
    )

  const data = wl.data!
  const view = lamp.data?.enabled && lamp.data.requested ? lamp.view : null
  const t = view && lamp.data ? lamp.data.today : todayDay()
  const entry = data.entries.find((e) => e.day === t) ?? null
  const bits = view?.today.bits ?? 0
  // Mêmes données que la lampe (wellness, séances, cahiers) ; le wellness et la séance tout juste envoyés comptent aussitôt.
  const done: Record<'wellness' | 'seance' | 'cahier', boolean> = {
    wellness: !!(bits & TASK.wellness) || !!entry,
    seance: !!(bits & TASK.seance) || data.sessions.some((s) => s.day === t),
    cahier: !!(bits & TASK.cahier),
  }
  const missions: readonly ('wellness' | 'seance' | 'cahier')[] = view ? DAILY_TASKS : ['wellness', 'seance']
  const requested = view ? view.today.requested : isWeekday(t)
  const left = missions.filter((k) => !done[k]).length
  const weekend = !isWeekday(t)
  const title = !requested
    ? weekend
      ? 'Week-end\u00a0!'
      : view?.today.holiday
        ? 'Vacances\u00a0!'
        : 'Jour off\u00a0!'
    : left === 0
      ? view
        ? 'Journée allumée\u00a0!'
        : 'Tout est fait\u00a0!'
      : left === missions.length
        ? 'C’est parti\u00a0!'
        : `Encore ${left}\u00a0!`
  const sub = !requested ? (view ? todayLine(view) : 'Rien n’est demandé aujourd’hui : profite bien.') : null
  const streak = view && view.streak >= 1 ? view.streak : 0

  const toggle = (k: Panel) => {
    setMsg('')
    setEditSession(null)
    setPanel((x) => (x === k ? null : k))
  }
  const afterSave = (text: string) => {
    setPanel(null)
    setEditSession(null)
    setMsg(text)
    void wl.load()
    lamp.reload()
  }
  const tileAction: Record<'wellness' | 'seance' | 'cahier', () => void> = {
    wellness: () => toggle('forme'),
    seance: () => toggle('seance'),
    cahier: () => (setMsg(''), setPanel(null), setCahierOpen(true)),
  }
  const tiles: readonly ('wellness' | 'seance' | 'cahier')[] = view ? DAILY_TASKS : ['wellness', 'seance']

  return (
    <div className="hud flex flex-col gap-5 px-3 py-4" data-testid="aujourdhui-hud">
      {/* 1. Ta journée */}
      <section aria-label="Ta journée" data-testid="ta-journee">
        <div className="hud-label">Ta journée</div>
        <div className="mt-1.5 flex items-center gap-3">
          <span aria-hidden className="text-[46px] leading-none" style={{ opacity: requested && left === missions.length ? 0.55 : 1 }}>
            🔥
          </span>
          <div className="min-w-0 flex-1">
            <div className="hud-big text-[26px] break-words min-[390px]:text-[28px]" data-testid="titre-journee">
              {title}
            </div>
            <div className="mt-2 flex gap-1.5 px-1" role="img" aria-label={`Missions du jour : ${missions.filter((k) => done[k]).length} sur ${missions.length}`}>
              {missions.map((k) => (
                <span key={k} className={`hud-skew h-3 flex-1 ${done[k] ? 'hud-on' : 'hud-off'}`} title={`${MISSION[k].label}${done[k] ? ' ✓' : ''}`} />
              ))}
            </div>
          </div>
          {streak > 0 && (
            <div className="hud-skew hud-tile shrink-0 px-3 py-1.5 text-center" data-testid="serie" aria-label={`Série : ${streak} jour${streak > 1 ? 's' : ''} d’affilée`}>
              <div className="hud-unskew">
                <div className="hud-big text-2xl tabular-nums" style={{ color: 'var(--hud-top)' }}>
                  {streak}
                </div>
                <div className="text-[10px] font-bold text-muted">jour{streak > 1 ? 's' : ''}</div>
              </div>
            </div>
          )}
        </div>
        {sub && <p className="mt-2 text-xs text-muted">{sub}</p>}
      </section>

      {/* 2. Les missions en grosses tuiles */}
      <div className={`grid gap-3 px-1.5 ${tiles.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {tiles.map((k) => {
          const isOpen = (k === 'wellness' && panel === 'forme') || (k === 'seance' && panel === 'seance')
          return (
            <button
              key={k}
              type="button"
              className={`hud-skew relative min-h-24 min-w-0 touch-manipulation px-1 py-2 ${done[k] ? 'hud-on' : 'hud-tile'} ${isOpen ? 'ring-2 ring-[var(--hud-top)]' : ''}`}
              disabled={!canWrite}
              aria-expanded={k === 'cahier' ? undefined : isOpen}
              aria-label={`${MISSION[k].label}${done[k] ? ` : ${MISSION[k].done}` : ''}`}
              onClick={tileAction[k]}
              data-testid={`tuile-${k}`}
            >
              <span className="hud-unskew flex flex-col items-center gap-1">
                <span aria-hidden className="text-[34px] leading-none">
                  {MISSION[k].emoji}
                </span>
                <span className="hud-big text-lg">{MISSION[k].label}</span>
              </span>
              {done[k] && (
                <span aria-hidden className="hud-unskew absolute top-1 right-2 text-base font-black">
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>

      {msg && (
        <p role="status" className="px-1.5 text-sm font-extrabold italic" style={{ color: 'var(--hud-top)' }}>
          {msg}
        </p>
      )}

      {/* Saisie ouverte (forme, séance, 14 jours) */}
      {panel && (
        <div ref={panelRef} className="scroll-mt-28 border-t-2 border-[var(--hud-accent)] pt-3" data-testid={`panneau-${panel}`}>
          <PanelHead
            emoji={panel === 'forme' ? '⚡' : panel === 'seance' ? '🏃' : '📈'}
            title={panel === 'forme' ? 'Ta forme' : panel === 'seance' ? 'Ta séance' : 'Mes 14 derniers jours'}
            onClose={() => toggle(panel)}
          />
          {panel === 'forme' && (
            <MorningForm
              playerId={p.id}
              initial={entry}
              onCancel={() => setPanel(null)}
              onSaved={(e) => {
                wl.setData((d) => (d ? { ...d, entries: [e, ...d.entries.filter((x) => x.day !== e.day)] } : d))
                afterSave('Envoyé ! Ton encadrant peut le lire.')
              }}
            />
          )}
          {panel === 'seance' && (
            <div className="flex flex-col gap-4">
              {!editSession && (
                <RecentSessions
                  sessions={data.sessions}
                  canWrite={canWrite}
                  playerId={p.id}
                  onEdit={setEditSession}
                  onChanged={(err) => {
                    if (err) return setMsg(err)
                    void wl.load()
                    lamp.reload()
                  }}
                />
              )}
              <SessionForm key={editSession?.id ?? 'nouvelle'} playerId={p.id} sessions={data.sessions} edit={editSession} onDone={(changed) => (changed ? afterSave('Séance envoyée, ton encadrant peut la lire.') : editSession ? setEditSession(null) : setPanel(null))} />
            </div>
          )}
          {panel === 'historique' && <History entries={data.entries} />}
        </div>
      )}
      {entry && panel !== 'forme' && <WellnessSummary entry={entry} />}

      {/* 3. Les matchs à raconter */}
      {selfEval}

      {/* 4. Plus discrets : objectifs, en parler, 14 jours */}
      <div className="flex flex-wrap gap-2.5 px-1.5">
        <SmallButton emoji="🎯" expanded={goals} onClick={() => setGoals(!goals)}>
          Mes objectifs
        </SmallButton>
        <SmallButton emoji="📈" expanded={panel === 'historique'} onClick={() => toggle('historique')}>
          Mes 14 jours
        </SmallButton>
        <span className="hud-skew hud-tile inline-flex min-h-10 items-center pl-3">
          <span aria-hidden className="hud-unskew text-sm">
            💬
          </span>
          <TalkLink sex={p.sex} className="hud-unskew min-h-10! px-2 pr-3 text-xs! text-fg! no-underline!" />
        </span>
      </div>
      {goals && <MyObjectives player={p} canWrite={canWrite} />}

      {cahierOpen && lamp.data && (
        <CahierWindow
          playerId={p.id}
          kind="cahier"
          day={lamp.data.today}
          today={lamp.data.today}
          notes={lamp.cahiers}
          onClose={() => setCahierOpen(false)}
          onSaved={(text) => {
            setCahierOpen(false)
            setMsg(text)
            lamp.reload()
          }}
        />
      )}
    </div>
  )
}

function PanelHead({ emoji, title, onClose }: { emoji: string; title: string; onClose: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span aria-hidden className="text-2xl leading-none">
        {emoji}
      </span>
      <h2 className="hud-big min-w-0 flex-1 text-xl">{title}</h2>
      <button type="button" className="grid min-h-10 min-w-10 place-items-center text-lg text-muted hover:text-fg" onClick={onClose} aria-label="Fermer">
        ✕
      </button>
    </div>
  )
}

function SmallButton({ emoji, expanded, onClick, children }: { emoji: string; expanded?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`hud-skew inline-flex min-h-10 items-center px-3 touch-manipulation ${expanded ? 'hud-on' : 'hud-tile'}`} aria-expanded={expanded} onClick={onClick}>
      <span className="hud-unskew flex items-center gap-1.5 text-xs font-bold">
        <span aria-hidden className="text-sm">
          {emoji}
        </span>
        {children}
      </span>
    </button>
  )
}

