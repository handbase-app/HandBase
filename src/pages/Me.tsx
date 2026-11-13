import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { PictoTabs, type PictoTab } from '../components/PictoTabs'
import { meTabOf, withMeTab, type MeTab } from '../tabQuery'
import { BackButton } from '../backNav'
import { Avatar, playerName, SectionTitle } from '../components/ui'
import { alive, db, fmtDate, dayOf, poleSummary, POSITIONS, positionLabel, today, TRIAL, type Player, type PlayerSelf } from '../db'
import { w } from '../gender'
import { regionLabel } from '../lists'
import { appSlug } from '../appBrand'
import {
  cleanSelf,
  LETTER_KEYS,
  letterQuestions,
  MARK_KEYS,
  markFields,
  myDataExport,
  myDataFileName,
  sameSelf,
  saveSelfLocal,
  SELF_LIMITS,
  type LetterKey,
  type MarkKey,
} from '../playerSpace'
import { fetchNotes } from '../playerJournal'
import { isPlayerRole, myPlayerId, refreshRole, useRole } from '../roles'
import { supabase, syncNow, useSyncState } from '../sync'
import { positionCodes } from '../sportConfig'
import { useSportProfile } from '../installation'
import { canPreviewPlayerPage } from '../components/PlayerSpace'
import { inform, useUnsaved } from '../components/Confirm'
import { JournalSection, TalkLink } from '../components/PlayerJournal'
import { PlayerMatches } from '../components/PlayerMatches'
import { MyTeamCard } from '../components/MyTeam'
import { MyObjectives } from '../components/Objectives'
import { SelfEvalSection } from '../components/SelfEval'
import { AllTests } from '../components/AllTests'
import { useReperes } from '../components/Medal'
import { MyWellnessCard } from '../components/Wellness'
import { TODAY_HUD, TodayHud } from '../components/TodayHud'
import { PlayerLamp } from '../components/PlayerLamp'
import { fetchMyWellness } from '../wellnessApi'
import { myWellnessExport } from '../wellness'

/*
 * « Ma page » (/moi) : la seule page d'un compte joueur (espace joueur, supabase/051_espace_joueur.sql).
 * En six onglets à pictogrammes depuis le 09/11 (comme la fiche, src/components/PictoTabs.tsx ; ?onglet=…, src/tabQuery.ts) :
 *  ♥ Aujourd'hui (par défaut) : wellness du jour et « Ma séance », « Mes objectifs », « Comment ça s'est passé ? » à remplir ;
 *    point sur l'onglet quand le wellness du jour est demandé et pas encore rempli ; rien de tout ça : une ligne.
 *    (« Tableau de bord de jeu » au thème NEXTAR du 09/11, coupé le 10/11 et gardé : TODAY_HUD, src/components/TodayHud.tsx.)
 *  ⏱ Mes tests · 🤾 Mes matchs (sport avec feuilles de match, sinon caché ; plus l'historique des auto-évaluations) ·
 *  📓 Mon cahier (journal) · 🪔 Ma lampe (src/components/PlayerLamp.tsx) · 👤 Moi (identité, équipe, lettre, repères, parcours ;
 *    point sur l'onglet tant qu'un brouillon n'est pas enregistré).
 *  Tous les onglets restent montés (cachés) : rien d'une saisie en cours ne se perd en changeant d'onglet. En bas de chaque
 *  onglet : « J'ai besoin d'en parler », « Télécharger mes données », la charte.
 * Sections :
 *  - Onglet Moi, en haut, ce que le staff tient (lecture seule) : prénom, nom, année de naissance, club, poste, passages en pôle.
 *  - « Mon wellness du jour » (073, src/components/Wellness.tsx) : en haut d’Aujourd’hui, si son groupe le demande et que le réglage
 *    de l'installation est ouvert (mode essai seulement pour l'instant) : questionnaire du matin (lundi → vendredi),
 *    « Ma séance », ses 14 derniers jours.
 *  - « Mes objectifs » (vague 2 « Génération Bleue », liste à cocher avec des étapes depuis le 04/11) : ceux du staff (rangés
 *    dans la fiche : il coche leurs étapes) et les siens (« à moi », 5 en cours au plus, 065) ; src/components/Objectives.tsx.
 *  - « Comment ça s'est passé ? » (064) : après un match, un tournoi ou un stage où il était sur la liste, sa courte
 *    auto-évaluation, modifiable 14 jours (src/components/SelfEval.tsx) ; le staff la lit à part des avis.
 *  - « Mes tests » (066) : ses tests physiques par famille, ses plus beaux progrès, ses mesures datées, en PDF ou tableur
 *    (lecture seule, src/components/AllTests.tsx) ; compte joueur : ses seules mesures, envoyées par le serveur.
 *  - « Mon équipe » (056) : son équipe en championnat (1, 2 ou 3), le niveau, le surclassement ; enregistrée à part
 *    (src/components/MyTeam.tsx, hb_player_set_team), sans toucher au reste de la page.
 *  - « Mon journal du hand » (052) : notes datées, privées, partagées une par une (src/components/PlayerJournal.tsx).
 *  - « Ma lettre » : trois questions guidées, positives et ouvertes, plus un champ libre ; versions précédentes (lecture).
 *  - « Mes repères » (052) : joueur ou joueuse préféré·e, équipe préférée, poste rêvé, un match marquant (champs courts).
 *  - « Mon parcours » : clubs (nom + années), postes joués (ceux du sport), sélections, palmarès (une ligne par entrée).
 *  - « J'ai besoin d'en parler » (toujours visible) et « Télécharger mes données » (copie complète, sur l'appareil).
 * Enregistrement explicite (« Enregistrer ») : nettoyage sur l'appareil (src/playerSpace.ts), puis le serveur
 * (hb_player_self_update : seule écriture d'un compte joueur ; il ne touche que la clé `self` de SA fiche). Brouillon gardé
 * sur l'appareil tant que ce n'est pas enregistré. Clavier seulement : rien de ce que le jeune écrit ne part vers une IA
 * (TODO plus tard : dictée locale, sans envoi).
 * Aperçu (?joueur=<id>) : un administrateur (ou le mode essai / local) voit la page telle que le jeune la voit, sans enregistrer.
 */

interface Form {
  letter: Record<LetterKey, string>
  marks: Record<MarkKey, string>
  clubs: { name: string; from: string; to: string }[]
  positions: string[]
  selections: string
  honours: string
}

const emptyForm = (): Form => ({
  letter: { why: '', proud: '', work: '', free: '' },
  marks: { favPlayer: '', favTeam: '', dreamPosition: '', memorableMatch: '' },
  clubs: [],
  positions: [],
  selections: '',
  honours: '',
})

/** Ce qui est enregistré → le formulaire. */
function fromSelf(self: PlayerSelf | undefined): Form {
  const f = emptyForm()
  for (const k of LETTER_KEYS) f.letter[k] = self?.letter?.[k] ?? ''
  for (const k of MARK_KEYS) f.marks[k] = self?.marks?.[k] ?? ''
  f.clubs = (self?.path?.clubs ?? []).map((c) => ({ name: c.name, from: c.from ?? '', to: c.to ?? '' }))
  f.positions = [...(self?.path?.positions ?? [])]
  f.selections = (self?.path?.selections ?? []).join('\n')
  f.honours = (self?.path?.honours ?? []).join('\n')
  return f
}

/** Le formulaire → ce qu'on nettoie puis envoie. */
const toInput = (f: Form) => ({ letter: f.letter, marks: f.marks, path: { clubs: f.clubs, positions: f.positions, selections: f.selections, honours: f.honours } })

const DRAFT_KEY = (id: string) => `handbase${TRIAL ? '-essai' : ''}.moi.brouillon.${id}`
const readDraft = (id: string): Form | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(id))
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<Form>
    const e = emptyForm()
    return { ...e, ...d, marks: { ...e.marks, ...(d.marks ?? {}) } }
  } catch {
    return null
  }
}
const writeDraft = (id: string, f: Form | null) => {
  try {
    if (f) localStorage.setItem(DRAFT_KEY(id), JSON.stringify(f))
    else localStorage.removeItem(DRAFT_KEY(id))
  } catch {
    /* stockage indisponible : le brouillon ne survit pas au rechargement */
  }
}

/** Dernier onglet ouvert de « Ma page » sur cet appareil (sans paramètre dans l'adresse : menu, lien simple). */
const TAB_KEY = `handbase${TRIAL ? '-essai' : ''}.moi.onglet`
const readTab = (): string | null => {
  try {
    return localStorage.getItem(TAB_KEY)
  } catch {
    return null
  }
}
const writeTab = (t: MeTab) => {
  try {
    localStorage.setItem(TAB_KEY, t)
  } catch {
    /* stockage indisponible : on revient sur « Aujourd'hui » */
  }
}

/**
 * Onglets de « Ma page » (09/11 : « descendre toute la page, c'est pénible »), même allure que ceux de la fiche
 * (src/components/PictoTabs.tsx) ; mêmes identifiants que l'adresse (src/tabQuery.ts : ME_TABS).
 */
const TABS: readonly PictoTab<MeTab>[] = [
  { id: 'aujourdhui', label: 'Aujourd’hui', icon: 'heart' },
  { id: 'tests', label: 'Mes tests', icon: 'stopwatch' },
  { id: 'matchs', label: 'Mes matchs', icon: 'ball' },
  { id: 'cahier', label: 'Mon cahier', icon: 'book' },
  { id: 'lampe', label: 'Ma lampe', icon: 'lamp' },
  { id: 'moi', label: 'Moi', icon: 'user' },
]

export default function Me() {
  const role = useRole()
  const [params] = useSearchParams()
  const player = isPlayerRole(role)
  // Aperçu (administrateur, mode essai) : la fiche demandée, en lecture seule ; compte joueur : sa fiche reliée.
  const previewId = params.get('joueur')
  const preview = !player
  const id = player ? myPlayerId() : previewId
  const { state } = useSyncState()
  // undefined : pas encore lu ; null : pas de fiche (pas d'identifiant, ou fiche absente de l'appareil).
  const p = useLiveQuery(async () => (id ? ((await db.players.get(id)) ?? null) : null), [id])

  // Compte joueur dont la fiche ne vient pas (accès retiré depuis l'autre bout) : on relit le rôle ; sans fiche reliée,
  // l'écran « Entre ton code » reprend la main (src/components/AuthGate.tsx).
  useEffect(() => {
    if (player && p === null && state === 'synced') void refreshRole()
  }, [player, p, state])

  if (preview && !canPreviewPlayerPage(role)) return <div className="py-20 text-center text-sm text-muted">Aperçu réservé aux administrateurs.</div>
  if (preview && !id) return <div className="py-20 text-center text-sm text-muted">Aperçu : ouvrir « Voir sa page » depuis la fiche d’un joueur.</div>
  if (p === undefined) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (!p || p.deleted)
    return (
      <div className="py-20 text-center text-sm text-muted">
        {player ? (state === 'syncing' || state === 'offline' ? 'Ta fiche arrive… (il faut être en ligne la première fois).' : 'Ta fiche n’est pas disponible : demande à ton encadrant.') : 'Joueur introuvable.'}
      </div>
    )
  return <MePage p={p} preview={preview} />
}

function MePage({ p, preview }: { p: Player; preview: boolean }) {
  const g = w(p.sex)
  const role = useRole()
  const sport = useSportProfile()
  // « Mes matchs » : feuilles de match FFHB (handball seulement, src/sportConfig.ts).
  const sheets = sport.features.includes('feuilleMatchFFHB')
  // Onglets (09/11, src/tabQuery.ts : ME_TABS) : celui de l'adresse (?onglet=…), sinon le dernier ouvert sur l'appareil ;
  // Mes matchs caché pour un sport sans match. Changer d'onglet remplace l'adresse (même état : « Retour » ramène à l'écran
  // d'origine, et revenir sur la page rouvre le même onglet), ?joueur=… de l'aperçu gardé.
  const [, setParams] = useSearchParams()
  const { search, state } = useLocation()
  const hidden: MeTab[] = sheets ? [] : ['matchs']
  const tab = meTabOf(search, readTab(), hidden)
  const tabsAnchor = useRef<HTMLHeadingElement>(null)
  const setTab = (t: MeTab) => {
    writeTab(t)
    setParams(new URLSearchParams(withMeTab(search, t)), { replace: true, state })
    // Onglets collés en haut (page défilée) : le nouvel onglet s'ouvre à son début, juste sous eux (place normale des
    // onglets : 1 rem sous le titre).
    const h1 = tabsAnchor.current
    const header = document.querySelector('header')?.getBoundingClientRect().height ?? 0
    const natural = h1 ? h1.getBoundingClientRect().bottom + 16 : header
    if (natural < header) window.scrollTo({ top: window.scrollY + natural - header })
  }
  const panel = (t: MeTab) => (t === tab ? 'flex flex-col gap-4' : 'hidden')
  // Wellness du jour demandé et pas encore rempli : point sur l'onglet Aujourd'hui (prévenu par la carte, toujours montée).
  const [wellnessPending, setWellnessPending] = useState(false)
  // Aujourd'hui en tableau de bord (TODAY_HUD, coupé) : « J'ai besoin d'en parler » y est déjà (pas une 2e fois en bas de cet onglet).
  const [todayHud, setTodayHud] = useState(false)
  // Un compte joueur écrit (serveur) ; sans serveur (mode local / essai), l'aperçu permet d'essayer, sur l'appareil seulement ;
  // avec le serveur, l'aperçu d'un administrateur est en lecture seule (jamais d'écriture au nom du jeune).
  const canWrite = isPlayerRole(role) || !supabase
  const saved = useMemo(() => fromSelf(p.self), [p.self])
  const [form, setForm] = useState<Form>(() => readDraft(p.id) ?? saved)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Ce que l'appareil enverrait : nettoyé comme le serveur le fera (tailles, lignes vides…).
  const cleaned = useMemo(() => cleanSelf(toInput(form), positionCodes(), today()), [form])
  const dirty = !sameSelf(cleaned.self, cleanSelf(toInput(saved), positionCodes(), today()).self)
  useUnsaved(dirty && canWrite)
  // Brouillon gardé sur l'appareil tant que ce n'est pas enregistré (aperçu : jamais).
  useEffect(() => {
    if (!canWrite) return
    writeDraft(p.id, dirty ? form : null)
  }, [form, dirty, canWrite, p.id])
  // La fiche change ailleurs (synchronisation) sans brouillon en cours : on suit.
  useEffect(() => {
    if (!dirty) setForm(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])

  const questions = letterQuestions(p.sex)
  const year = p.birthDate?.slice(0, 4)
  const poles = poleSummary(p, regionLabel)
  const setLetter = (k: LetterKey, v: string) => setForm((f) => ({ ...f, letter: { ...f.letter, [k]: v } }))
  const setMark = (k: MarkKey, v: string) => setForm((f) => ({ ...f, marks: { ...f.marks, [k]: v } }))
  const marks = markFields(p.sex)
  const versions = p.self?.letterHistory ?? []
  const setClub = (i: number, patch: Partial<Form['clubs'][number]>) => setForm((f) => ({ ...f, clubs: f.clubs.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))

  async function save() {
    if (!canWrite || busy) return
    setMsg(null)
    setBusy(true)
    try {
      let stored: PlayerSelf | undefined
      const row0 = await db.players.get(p.id)
      if (supabase) {
        if (!navigator.onLine) return setMsg({ ok: false, text: 'Pas de connexion internet : ton brouillon est gardé sur cet appareil, réessaie en ligne.' })
        const { data, error } = await supabase.rpc('hb_player_self_update', { p_self: cleaned.self ?? null })
        if (error) return setMsg({ ok: false, text: error.code === 'PGRST202' ? 'L’espace joueur n’est pas encore ouvert sur ce serveur : demande à ton encadrant.' : `Enregistrement impossible : ${error.message}` })
        stored = (data as PlayerSelf | null) ?? undefined
      } else {
        // Mode local / essai (pas de serveur) : sur l'appareil seulement, sans file d'envoi ; même règle que le serveur
        // (versions précédentes de la lettre gardées).
        stored = saveSelfLocal(row0?.self, cleaned.self, new Date().toISOString())
      }
      // Copie locale alignée tout de suite (la synchronisation la confirmera) ; jamais par save() : rien dans la file d'envoi.
      const row = await db.players.get(p.id)
      if (row) {
        const next = { ...row, updatedAt: Math.max(Date.now(), row.updatedAt + 1) }
        if (stored) next.self = stored
        else delete next.self
        await db.players.put(next)
      }
      writeDraft(p.id, null)
      setForm(fromSelf(stored))
      setMsg({ ok: true, text: 'Enregistré, ton encadrant peut le lire.' })
      if (supabase) void syncNow()
    } finally {
      setBusy(false)
    }
  }

  /** « Télécharger mes données » : ce que le jeune a écrit (lettre et versions, repères, parcours, TOUTES ses notes), en JSON,
   *  sur l'appareil ; rien n'est envoyé ailleurs. */
  async function downloadMyData() {
    const r = await fetchNotes(p.id)
    if (!r.ok) return inform(r.error)
    // Wellness (073) : le sien, toute la saison gardée ; absent (pas demandé, script pas passé) : rien.
    const wl = await fetchMyWellness(p.id, 400)
    const base = myDataExport(
      {
        prenom: p.firstName,
        nom: p.lastName,
        anneeDeNaissance: year,
        club: p.club,
        poste: p.position ? positionLabel(p.position) : undefined,
        poleEspoirs: poles || undefined,
      },
      p.self,
      r.value,
      new Date().toISOString(),
    )
    const data = wl.ok && (wl.value.entries.length || wl.value.sessions.length) ? { ...base, ...myWellnessExport(wl.value.entries, wl.value.sessions) } : base
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = myDataFileName(appSlug(), today())
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // Même bouton sous chaque section : il enregistre tout (lettre, repères et parcours).
  const saveBar = canWrite ? (
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary min-h-11 px-5" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {dirty && !busy && <span className="text-[11px] text-muted">Brouillon gardé sur cet appareil, pas encore enregistré.</span>}
        {msg && <span className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</span>}
        {cleaned.notes.length > 0 && <span className="text-[10px] text-muted">{cleaned.notes.join(' · ')}</span>}
      </div>
  ) : null

  return (
    <div className="flex flex-col gap-4" data-testid="ma-page">
      {preview && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px]">
          <span>
            Aperçu : ce que voit <b>{p.firstName}</b> sur sa page. {supabase ? 'Lecture seule.' : 'Essai : ce qui est enregistré reste sur cet appareil.'}
          </span>
          <BackButton fallback={`/joueurs/${p.id}`} label="FICHE" className="shrink-0" />
        </div>
      )}
      <h1 ref={tabsAnchor} className="text-lg font-extrabold">{preview ? `La page ${g.duJoueur}` : 'Ma page'}</h1>

      <PictoTabs
        tabs={TABS}
        tab={tab}
        setTab={setTab}
        hidden={hidden}
        dots={{ aujourdhui: wellnessPending && 'wellness à remplir', moi: dirty && canWrite && 'pas encore enregistré' }}
      />

      {/* Onglets : tous gardés montés (cachés quand ils sont fermés), comme quand tout était sur une seule page : rien de ce
          qui est en cours de saisie (wellness, séance, équipe, note du journal…) ne se perd en changeant d'onglet. */}
      <div className={panel('aujourdhui')} role="tabpanel" aria-label="Aujourd’hui" data-testid="onglet-aujourdhui">
        {/* Rien d'autre ce jour-là (wellness pas demandé, pas d'objectif, rien à remplir) : une ligne plutôt qu'un onglet vide. */}
        <div className="peer flex flex-col gap-4 empty:hidden">
          {TODAY_HUD ? (
            // « Tableau de bord de jeu » (maquette du 09/11), coupé le 10/11 et gardé au cas où : src/components/TodayHud.tsx.
            <TodayHud player={p} canWrite={canWrite} sheets={sheets} onPending={setWellnessPending} onHud={setTodayHud} />
          ) : (
            <>
              {/* Mon wellness du jour (073) : en haut, ouvert le matin des jours de semaine tant qu'il n'est pas rempli ; à remplir :
                  point sur l'onglet. */}
              <MyWellnessCard player={p} canWrite={canWrite} onPending={setWellnessPending} />
              {/* Mes objectifs (065 : étapes à cocher, objectifs « à moi ») et « Comment ça s'est passé ? » (064) à remplir. Sport
                  sans onglet Mes matchs : aussi les plus anciennes, ici. */}
              <MyObjectives player={p} canWrite={canWrite} />
              <SelfEvalSection player={p} canWrite={canWrite} only={sheets ? 'current' : undefined} />
            </>
          )}
        </div>
        <p className="card hidden p-4 text-xs text-muted peer-empty:block">Rien à remplir aujourd’hui : tes objectifs et tes questionnaires apparaîtront ici.</p>
      </div>

      <div className={panel('tests')} role="tabpanel" aria-label="Mes tests">
        {/* Mes tests (066) : ses tests physiques, lecture seule ; même vue que l'onglet Tests de la fiche. */}
        <MyTests p={p} />
      </div>

      {sheets && (
        <div className={panel('matchs')} role="tabpanel" aria-label="Mes matchs">
          {/* Mes matchs (feuilles de match, vidéo) et l'historique de ses auto-évaluations (064). */}
          <PlayerMatches p={p} canWrite={canWrite} />
          <SelfEvalSection player={p} canWrite={canWrite} only="past" />
        </div>
      )}

      <div className={panel('cahier')} role="tabpanel" aria-label="Mon cahier">
        {/* Mon journal du hand (052) : privé, partagé note par note. */}
        <JournalSection player={p} canWrite={canWrite} preview={preview} />
      </div>

      <div className={panel('lampe')} role="tabpanel" aria-label="Ma lampe">
        {/* Lampe d'Aladin (074, src/components/PlayerLamp.tsx) : jauge de la saison, cahier du hand, cahier de match, 3 vœux ;
            relue chaque fois que l'onglet s'ouvre (wellness ou séance remplis dans « Aujourd'hui »). */}
        <PlayerLamp playerId={p.id} preview={preview} canWrite={canWrite} active={tab === 'lampe'} onGo={setTab} />
      </div>

      <div className={panel('moi')} role="tabpanel" aria-label="Moi">
        {/* Identité : tenue par le staff, lecture seule. */}
        <div className="card p-4">
          <div className="flex items-center gap-4">
            <Avatar p={p} size={56} />
            <div className="min-w-0 flex-1">
              <div className="text-base font-extrabold">{playerName(p)}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                {year && <span>{g.ne} en {year}</span>}
                {p.club && <span>{p.club}</span>}
                {p.position && <span>{positionLabel(p.position)}</span>}
              </div>
            </div>
          </div>
          {poles && (
            <div className="mt-3 border-t border-line pt-3 text-xs">
              <span className="text-muted">Pôle Espoirs : </span>
              {poles}
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted">Ces informations sont tenues par ton encadrant : si quelque chose est faux, dis-le-lui.</p>
        </div>

        {/* Mon équipe (056) : équipe 1, 2 ou 3, niveau, surclassement ; enregistrée à part (hb_player_set_team). */}
        <MyTeamCard p={p} canWrite={canWrite} />

        {/* Ma lettre */}
        <section className="card flex flex-col gap-3 p-4">
          <SectionTitle info="Rien n’est obligatoire : tu écris ce que tu veux, quand tu veux, et tu peux changer d’avis. Ton encadrant lit ce que tu enregistres. Pas de classement, pas de jugement.">
            Ma lettre
          </SectionTitle>
          {questions.map((q) => (
            <label key={q.key} className="block">
              <span className="label">{q.label}</span>
              <textarea
                className="field min-h-11 w-full resize-y"
                rows={3}
                placeholder={q.hint}
                maxLength={SELF_LIMITS.text}
                value={form.letter[q.key]}
                readOnly={!canWrite}
                onChange={(e) => setLetter(q.key, e.target.value)}
              />
              <span className="block text-right text-[10px] text-muted">
                {form.letter[q.key].length} / {SELF_LIMITS.text}
              </span>
            </label>
          ))}
          {saveBar}
          {versions.length > 0 && (
            <details className="rounded-lg border border-line bg-panel-2 p-3" data-testid="versions-lettre">
              <summary className="min-h-9 cursor-pointer text-xs font-bold">Versions précédentes de ma lettre ({versions.length})</summary>
              <p className="mt-1 text-[10px] text-muted">Gardées pour voir le chemin parcouru (les 20 dernières). Lecture seule.</p>
              <ul className="mt-2 flex flex-col gap-3">
                {versions.map((v, i) => (
                  <li key={i} className="border-l-2 border-line pl-2">
                    <div className="text-[11px] font-bold">Version du {fmtDate(dayOf(v.at))}</div>
                    {questions
                      .filter((q) => v.letter[q.key])
                      .map((q) => (
                        <div key={q.key} className="mt-1">
                          <div className="text-[10px] text-muted">{q.label}</div>
                          <div className="text-xs break-words whitespace-pre-wrap">{v.letter[q.key]}</div>
                        </div>
                      ))}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* Mes repères (052) */}
        <section className="card flex flex-col gap-3 p-4" data-testid="mes-reperes">
          <SectionTitle info={`Quelques mots, si tu veux : ce qui te fait rêver dans le ${sport.word}.`}>Mes repères</SectionTitle>
          {marks.map((m) => (
            <label key={m.key} className="block">
              <span className="label">{m.label}</span>
              <input
                className="field min-h-11 w-full"
                placeholder={m.hint}
                maxLength={SELF_LIMITS.mark}
                value={form.marks[m.key]}
                readOnly={!canWrite}
                onChange={(e) => setMark(m.key, e.target.value)}
              />
            </label>
          ))}
          {saveBar}
        </section>

        {/* Mon parcours */}
        <section className="card flex flex-col gap-3 p-4">
          <SectionTitle info="Tes clubs, les postes où tu as joué, tes sélections et ton palmarès, comme tu les connais.">Mon parcours</SectionTitle>
          <div>
            <span className="label">Mes clubs</span>
            <div className="flex flex-col gap-2">
              {form.clubs.map((c, i) => (
                <div key={i} className="flex min-w-0 items-center gap-2">
                  <input
                    className="field min-h-11 min-w-0 flex-1"
                    placeholder="Nom du club"
                    maxLength={SELF_LIMITS.clubName}
                    value={c.name}
                    readOnly={!canWrite}
                    onChange={(e) => setClub(i, { name: e.target.value })}
                  />
                  <input className="field min-h-11 w-16 shrink-0 px-1 text-center" placeholder="de" inputMode="numeric" maxLength={4} aria-label="Première année" value={c.from} readOnly={!canWrite} onChange={(e) => setClub(i, { from: e.target.value.replace(/\D/g, '') })} />
                  <input className="field min-h-11 w-16 shrink-0 px-1 text-center" placeholder="à" inputMode="numeric" maxLength={4} aria-label="Dernière année" value={c.to} readOnly={!canWrite} onChange={(e) => setClub(i, { to: e.target.value.replace(/\D/g, '') })} />
                  {canWrite && (
                    <button className="min-h-11 w-8 shrink-0 text-muted hover:text-red-400" aria-label="Retirer ce club" onClick={() => setForm((f) => ({ ...f, clubs: f.clubs.filter((_, j) => j !== i) }))}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {!form.clubs.length && !canWrite && <p className="text-xs text-muted">—</p>}
              {canWrite && form.clubs.length < SELF_LIMITS.clubs && (
                <button className="btn-ghost min-h-11 w-fit px-3 text-xs" onClick={() => setForm((f) => ({ ...f, clubs: [...f.clubs, { name: '', from: '', to: '' }] }))}>
                  + Ajouter un club
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted">Années : la première et la dernière (laisse « à » vide si tu y es encore).</p>
          </div>
          <div>
            <span className="label">Postes où j’ai joué</span>
            <div className="flex flex-wrap gap-2">
              {POSITIONS.map((pos) => {
                const on = form.positions.includes(pos.id)
                return (
                  <button
                    key={pos.id}
                    type="button"
                    className={`min-h-11 rounded-full border px-3 text-xs font-bold ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2 text-muted'}`}
                    aria-pressed={on}
                    disabled={!canWrite}
                    onClick={() => setForm((f) => ({ ...f, positions: on ? f.positions.filter((x) => x !== pos.id) : [...f.positions, pos.id] }))}
                  >
                    {pos.label}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="block">
            <span className="label">Mes sélections</span>
            <textarea className="field min-h-11 w-full resize-y" rows={3} placeholder="Une par ligne : comité, ligue, stage…" value={form.selections} readOnly={!canWrite} onChange={(e) => setForm((f) => ({ ...f, selections: e.target.value }))} />
          </label>
          <label className="block">
            <span className="label">Mon palmarès</span>
            <textarea className="field min-h-11 w-full resize-y" rows={3} placeholder="Une par ligne : titre, tournoi, finale…" value={form.honours} readOnly={!canWrite} onChange={(e) => setForm((f) => ({ ...f, honours: e.target.value }))} />
          </label>
          {saveBar}
        </section>
        {p.self?.updatedAt && !dirty && <p className="text-[10px] text-muted">Dernier enregistrement : {fmtDate(dayOf(p.self.updatedAt))}.</p>}
      </div>

      {/* Toujours visible, sous chaque onglet : « J'ai besoin d'en parler », mes données, la charte. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {!(todayHud && tab === 'aujourdhui') && <TalkLink sex={p.sex} />}
        {!(preview && supabase) && (
          <button type="button" className="min-h-9 text-[11px] text-muted underline underline-offset-2" onClick={() => void downloadMyData()}>
            Télécharger mes données
          </button>
        )}
        {!preview && (
          <Link to="/confidentialite#charte-joueur" className="min-h-9 content-center text-[11px] text-muted underline underline-offset-2">
            Ta page, comment ça marche
          </Link>
        )}
      </div>
    </div>
  )
}

/**
 * « Mes tests » : ses mesures (compte joueur : les seules que le serveur lui envoie, 066 ; aperçu d'un administrateur : celles
 * de cette fiche sur l'appareil). Avant 066, rien n'arrive : une ligne d'attente.
 */
function MyTests({ p }: { p: Player }) {
  const reperes = useReperes()
  const data = useLiveQuery(async () => {
    const [criteria, measurements] = await Promise.all([
      db.criteria.where('kind').equals('factual').toArray().then(alive),
      db.measurements.where('playerId').equals(p.id).toArray().then(alive),
    ])
    return { criteria, measurements }
  }, [p.id])
  if (!data) return null
  return (
    <section className="flex flex-col gap-2" data-testid="mes-tests">
      <AllTests
        player={p}
        criteria={data.criteria}
        measurements={data.measurements}
        reperes={reperes}
        mine
        title="Mes tests"
        empty={<p className="card p-4 text-xs text-muted">Tes tests apparaîtront ici après ta première séance de tests.</p>}
      />
    </section>
  )
}
