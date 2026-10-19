import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { Avatar, playerName, SectionTitle } from '../components/ui'
import { db, fmtDate, dayOf, poleSummary, POSITIONS, positionLabel, today, TRIAL, type Player, type PlayerSelf } from '../db'
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
import { canPreviewPlayerPage } from '../components/PlayerSpace'
import { inform, useUnsaved } from '../components/Confirm'
import { JournalSection, TalkLink } from '../components/PlayerJournal'

/*
 * « Ma page » (/moi) : la seule page d'un compte joueur (espace joueur, supabase/051_espace_joueur.sql).
 *  - En haut, ce que le staff tient (lecture seule) : prénom, nom, année de naissance, club, poste, passages en pôle.
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
    const data = myDataExport(
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
      <h1 className="text-lg font-extrabold">{preview ? `La page ${g.duJoueur}` : 'Ma page'}</h1>

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

      {/* Mon journal du hand (052) : privé, partagé note par note. */}
      <JournalSection player={p} canWrite={canWrite} preview={preview} />

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
        <SectionTitle info="Quelques mots, si tu veux : ce qui te fait rêver dans le hand.">Mes repères</SectionTitle>
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <TalkLink sex={p.sex} />
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
