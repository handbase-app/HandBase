import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { groupBy, Icon, playerName, SectionTitle, Segmented, useMe, type IconName } from '../components/ui'
import { alive, db, newId, POSITIONS, remove, save, today, type Criterion, type CriterionScale } from '../db'
import { clearDemo, loadDemo } from '../demo'
import { exportBackup, importBackup } from '../export'
import { applyImport, parseLicenceFile, planImport, type ImportPlan } from '../importLicences'
import { supabase, syncNow, useSyncState } from '../sync'
import { ActivityLog } from '../components/ActivityLog'
import { Members } from '../components/Members'
import { ListEditor } from '../components/ListEditor'
import { ask, inform } from '../components/Confirm'
import { can, myDepartments, ROLE_HELP, ROLE_LABEL, useRole } from '../roles'
import { departmentLabel } from '../lists'
import { useSessionState } from '../components/PlayerFilter'
import { currentSubscription, disablePush, enablePush, NOTIF_KINDS, pushSupport, readNotifPrefs, saveNotifPrefs, sendTestNotification } from '../push'
import { AUTO, readThemeChoice, resolveTheme, setThemeChoice, THEMES, useThemeVersion, type Theme } from '../theme'

const SCALES: { value: CriterionScale; label: string }[] = [
  { value: 'score5', label: 'Note 1 à 5' },
  { value: 'score3', label: 'Note 0 à 3' },
  { value: 'score2', label: 'Note 0 à 2' },
  { value: 'number', label: 'Valeur (unité)' },
  { value: 'choice', label: 'Choix (options)' },
  { value: 'text', label: 'Texte' },
]

export default function Settings() {
  const [me, setMe] = useMe()
  const [draft, setDraft] = useState(me)
  const [msg, setMsg] = useState('')
  const role = useRole()

  const admin = can.manageRoles(role)
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-extrabold">Réglages</h1>

      <div className="mt-1 text-[10px] font-extrabold tracking-wider text-muted uppercase">Mon espace</div>
      <Fold id="compte" icon="user" title="Mon compte" summary={[me, ROLE_LABEL[role]].filter(Boolean).join(' · ')}>
        <section className="card flex flex-col gap-2 p-4">
          <SectionTitle info="Ton nom signe tes avis et tes mesures, pour que le staff puisse comparer les évaluations. Avec un compte, il est lié à ce compte.">
            Mon nom (observateur)
          </SectionTitle>
          {supabase ? (
            <p className="text-xs">
              <b>{me}</b>
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Prénom Nom" />
                <button className="btn-primary shrink-0" disabled={draft.trim() === me} onClick={() => setMe(draft.trim())}>
                  OK
                </button>
              </div>
            </>
          )}
        </section>
        <Account />
        {supabase && <PasswordChange />}
      </Fold>
      {supabase && (
        <Fold id="notifications" icon="bell" title="Notifications" summary="Sur ce téléphone : avis, fiches, participants, rappels">
          <NotificationSettings />
        </Fold>
      )}
      <Fold id="apparence" icon="palette" title="Apparence" summary={themeSummary()}>
        <ThemePicker />
      </Fold>
      <Fold id="confidentialite" icon="lock" title="Confidentialité" summary="Droits des familles, charte du staff">
  <div className="flex gap-2">
          <Link to="/confidentialite" className="btn-ghost flex-1 text-center text-xs">
            Données et droits
          </Link>
          <Link to="/confidentialite#charte" className="btn-ghost flex-1 text-center text-xs">
            Charte du staff
          </Link>
        </div>
      </Fold>

      {admin && (
        <>
          <div className="mt-3 text-[10px] font-extrabold tracking-wider text-muted uppercase">Administration</div>
          {supabase && (
            <Fold id="membres" icon="users" title="Équipe" summary="Comptes, rôles, secteurs">
              <Members />
            </Fold>
          )}
          <Fold id="referentiel" icon="list" title="Critères et listes" summary="Critères, départements, régions">
            <CriteriaEditor />
            <ListEditor kind="department" />
            <ListEditor kind="region" />
          </Fold>
          <Fold id="imports" icon="download" title="Imports et sauvegarde" summary="Gest’Hand, sauvegarde, démo">
            <LicenceImport />
              {/* Sauvegarde complète : administrateurs seulement (une copie de toute la base sort de l'appli). */}
              {can.exportAll(role) && (
              <section className="card flex flex-col gap-2 p-4">
                <div className="section-title">Sauvegarde</div>
                <div className="flex gap-2">
                  <button className="btn-ghost flex-1 text-xs" onClick={() => void exportBackup()}>
                    Exporter (JSON)
                  </button>
                  {can.editCriteria(role) && (
                  <label className="btn-ghost flex-1 cursor-pointer text-xs">
                    Importer
                    <input
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        try {
                          setMsg(`${await importBackup(f)} élément(s) importé(s).`)
                        } catch {
                          setMsg('Fichier de sauvegarde invalide.')
                        }
                      }}
                    />
                  </label>
                  )}
                </div>
                {msg && <p className="text-[11px] text-emerald-300">{msg}</p>}
              </section>
              )}
              {can.loadDemo(role) && (
              <section className="card flex flex-col gap-2 p-4">
                <SectionTitle info="24 joueurs fictifs (U18), 5 observateurs, 4 matchs / tournois et leurs avis, pour tester l'app. Elles restent sur cet appareil et s'effacent sans toucher à tes vraies données.">
                  Données de démonstration
                </SectionTitle>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost flex-1 text-xs"
                    onClick={async () => {
                      const r = await loadDemo()
                      setMsg(`Démo chargée : ${r.players} joueurs, ${r.measurements} mesures, ${r.events} événements, ${r.evaluations} avis.`)
                    }}
                  >
                    Charger la démo
                  </button>
                  <button
                    className="btn-ghost flex-1 text-xs"
                    onClick={async () => {
                      if (!(await ask('Effacer toutes les données de démonstration ? Tes propres données ne sont pas touchées.', { ok: 'Effacer' }))) return
                      await clearDemo()
                      setMsg('Données de démonstration effacées.')
                    }}
                  >
                    Effacer la démo
                  </button>
                </div>
              </section>
              )}
          </Fold>
          {supabase && (
            <Fold id="journal" icon="clock" title="Historique" summary="Qui a créé, modifié ou supprimé quoi">
              <ActivityLog />
            </Fold>
          )}
        </>
      )}
    </div>
  )
}

/** Notifications : activer sur cet appareil, choisir quoi recevoir (compte), envoyer un test. */
function NotificationSettings() {
  const support = pushSupport()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    void currentSubscription().then((s) => setSubscribed(!!s))
    void readNotifPrefs().then(setPrefs)
  }, [])

  if (support === 'not-configured') return <p className="text-xs text-muted">Notifications pas encore configurées sur le serveur.</p>
  if (support === 'ios-install')
    return (
      <p className="text-xs">
        Sur iPhone, les notifications marchent seulement dans l’appli <b>ajoutée à l’écran d’accueil</b> (Safari → Partager → « Sur l’écran
        d’accueil »), avec iOS 16.4 ou plus récent. Ouvre ensuite HandBase depuis l’écran d’accueil et reviens ici.
      </p>
    )
  if (support === 'unsupported') return <p className="text-xs text-muted">Ce navigateur ne permet pas les notifications.</p>

  const toggle = async (id: string, on: boolean) => {
    const next = { ...prefs, [id]: on }
    setPrefs(next)
    const err = await saveNotifPrefs(next)
    if (err) setMsg({ ok: false, text: `Préférence non enregistrée : ${err}` })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs">
          Sur ce téléphone : <b className={subscribed ? 'text-emerald-300' : 'text-muted'}>{subscribed === null ? '…' : subscribed ? 'activées' : 'désactivées'}</b>
        </span>
        <button
          className={subscribed ? 'btn-ghost px-3 py-1.5 text-xs' : 'btn-primary px-3 py-1.5 text-xs'}
          disabled={busy || subscribed === null}
          onClick={async () => {
            setBusy(true)
            setMsg(null)
            if (subscribed) {
              await disablePush()
              setSubscribed(false)
            } else {
              const err = await enablePush()
              setSubscribed(!err)
              if (err) setMsg({ ok: false, text: err })
            }
            setBusy(false)
          }}
        >
          {subscribed ? 'Désactiver' : 'Activer'}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <span className="label mb-0">Ce que je reçois (sur tous mes appareils)</span>
        {NOTIF_KINDS.map((k) => (
          <label key={k.id} className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={prefs[k.id] !== false} onChange={(e) => void toggle(k.id, e.target.checked)} />
            <span>
              <b>{k.label}</b>
              <span className="block text-[11px] text-muted">{k.help}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-muted">
        Plusieurs à la suite sont regroupées (« 3 avis à valider »). Rien entre 21 h et 8 h : elles arrivent le matin.
      </p>
      {subscribed && (
        <button
          className="btn-ghost self-start px-3 py-1.5 text-xs"
          onClick={async () => {
            const err = await sendTestNotification()
            setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Notification de test demandée : elle arrive d’ici 2 minutes.' })
          }}
        >
          M’envoyer une notification de test
        </button>
      )}
      {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </section>
  )
}

const themeSummary = () => {
  const c = readThemeChoice()
  return c === AUTO ? `Auto (${resolveTheme(c).label})` : resolveTheme(c).label
}

/** Choix du thème : chaque vignette montre ses couleurs. Gardé sur cet appareil. */
function ThemePicker() {
  useThemeVersion()
  const choice = readThemeChoice()
  const tile = (id: string, label: string, t: Theme) => (
    <button
      key={id}
      onClick={() => setThemeChoice(id)}
      className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs ${choice === id ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
    >
      <span className="flex h-9 w-12 shrink-0 flex-col justify-between overflow-hidden rounded-md border p-1" style={{ background: t.colors.bg, borderColor: t.colors.line }}>
        <span className="h-2 rounded-sm" style={{ background: t.colors.panel }} />
        <span className="flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm" style={{ background: t.colors.accent }} />
          <span className="h-1 flex-1 rounded-sm" style={{ background: t.colors.muted }} />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold">{label}</span>
        <span className="text-[10px] text-muted">{id === AUTO ? 'suit le téléphone' : [t.light ? 'clair' : 'sombre', t.note].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  )
  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {tile(AUTO, 'Auto', resolveTheme(AUTO))}
        {THEMES.map((t) => tile(t.id, t.label, t))}
      </div>
      <p className="text-[11px] text-muted">Le thème est gardé sur cet appareil. « Auto » passe en Clair ou en Nuit selon le réglage du téléphone.</p>
    </section>
  )
}

/**
 * Rubrique repliable des réglages : une ligne (icône, titre, résumé) qui s'ouvre sur ses réglages.
 * Les cartes des réglages s'y fondent (séparées par un trait) ; l'état ouvert est gardé pendant la session.
 */
function Fold({ id, icon, title, summary, children }: { id: string; icon: IconName; title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useSessionState(`handbase.settings.${id}`, false)
  return (
    <div className={`card overflow-hidden ${open ? 'border-accent/50' : ''}`}>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${open ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          {summary && <span className="block truncate text-[11px] text-muted">{summary}</span>}
        </span>
        <span className={`text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="flex flex-col divide-y divide-line border-t border-line px-4 [&>*]:py-4 [&_section.card]:rounded-none [&_section.card]:border-0 [&_section.card]:bg-transparent [&_section.card]:px-0 [&_section.card]:py-4">
          {children}
        </div>
      )}
    </div>
  )
}

function Account() {
  const { state, lastError } = useSyncState()
  const [email, setEmail] = useState('')
  const role = useRole()

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? ''))
  }, [])

  if (!supabase)
    return (
      <section className="card p-4">
        <div className="section-title">Serveur</div>
        <p className="text-xs text-muted">
          Mode local : les données sont enregistrées sur cet appareil uniquement. Pour partager les données entre plusieurs appareils, il faut
          configurer le serveur (voir README).
        </p>
      </section>
    )

  const label = { local: 'local', login: 'non connecté', offline: 'hors ligne', syncing: 'synchronisation…', synced: 'à jour', error: 'erreur' }[state]
  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle
        info={
          <>
            <p>
              <b>{ROLE_LABEL[role]}</b> : {ROLE_HELP[role]}
            </p>
            <p>Les données sont gardées sur l’appareil et envoyées au serveur dès que possible : on peut travailler hors ligne.</p>
          </>
        }
      >
        Compte & synchronisation
      </SectionTitle>
      <p className="text-xs">
        Connecté : <b>{email}</b>
      </p>
      <p className="text-xs">
        Rôle : <b className="text-accent">{ROLE_LABEL[role]}</b>
      </p>
      {role !== 'admin' && (
        <p className="text-xs">
          Secteur :{' '}
          <b>{myDepartments().length ? myDepartments().map(departmentLabel).join(', ') : role === 'preparateur' ? 'tous les départements' : 'non attribué'}</b>
        </p>
      )}
      <p className="text-[11px] text-muted">
        Synchronisation : {label}
        {lastError && ` — ${lastError}`}
      </p>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 text-xs" onClick={() => void syncNow()}>
          Synchroniser maintenant
        </button>
        <button
          className="btn-ghost flex-1 text-xs"
          onClick={async () => (await ask('Se déconnecter ? Les données pas encore synchronisées restent sur l’appareil.', { ok: 'Se déconnecter' })) && void supabase!.auth.signOut()}
        >
          Se déconnecter
        </button>
      </div>
    </section>
  )
}

/** Import d'un export de licences Gest'Hand (administrateurs). */
function LicenceImport() {
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [sourceDate, setSourceDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function pick(file: File) {
    setMsg(null)
    setPlan(null)
    setBusy(true)
    try {
      // La date de l'export est souvent dans le nom du fichier (2026-10-02_Export_GH-licence.csv).
      const d = file.name.match(/(\d{4}-\d{2}-\d{2})/)
      setSourceDate(d ? d[1] : today())
      const rows = await parseLicenceFile(file)
      setPlan(await planImport(rows))
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Fichier illisible.' })
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    if (!plan) return
    const n = plan.create.length + plan.update.length
    if (!(await ask(`Importer ${n.toLocaleString('fr-FR')} joueur(s) ? Ils seront visibles par tout le staff.`, { ok: 'Importer', danger: false }))) return
    setBusy(true)
    try {
      const r = await applyImport(plan, sourceDate, (done, total) => setProgress([done, total]))
      setPlan(null)
      setMsg({
        ok: true,
        text: `${r.created.toLocaleString('fr-FR')} joueurs créés, ${r.updated.toLocaleString('fr-FR')} complétés, ${r.measurements.toLocaleString('fr-FR')} tailles ajoutées. La synchronisation envoie le tout au serveur (garde l’appli ouverte et en ligne).`,
      })
    } catch (e) {
      setMsg({ ok: false, text: `Import interrompu : ${e instanceof Error ? e.message : e}` })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const fmt = (n: number) => n.toLocaleString('fr-FR')
  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle
        info="Fichier CSV de la ligue ou du club, lu sur cet appareil. Crée les joueurs absents et complète les fiches existantes (reconnues par licence, ou par nom + date de naissance) sans écraser ce que le staff a saisi ; les données administratives (club, licence, nationalité) suivent le fichier. La taille est enregistrée comme « déclarée à la licence »."
      >
        Importer des licences (Gest’Hand)
      </SectionTitle>
      <label className={`btn-ghost cursor-pointer text-xs ${busy ? 'pointer-events-none opacity-40' : ''}`}>
        {busy && !progress ? 'Lecture…' : 'Choisir le fichier CSV'}
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void pick(f)
          }}
        />
      </label>

      {plan && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <b className="text-base">{fmt(plan.create.length)}</b> à créer
            </div>
            <div>
              <b className="text-base">{fmt(plan.update.length)}</b> à compléter
            </div>
            <div className="text-muted">{fmt(plan.unchanged)} déjà à jour</div>
            <div className="text-muted">{fmt(plan.duplicates)} doublons fusionnés</div>
            {plan.proposals.length > 0 && (
              <div className="col-span-2 mt-1 rounded-md border border-sky-500/40 bg-sky-500/10 p-2 text-[11px]">
                <b>{fmt(plan.proposals.length)}</b> fiche(s) proposée(s) ou hors cadre retrouvée(s) dans les licences, qui seront complétées :{' '}
                {plan.proposals
                  .slice(0, 8)
                  .map(({ player: p }) => `${playerName(p)}${p.review === 'refused' ? ' (hors cadre)' : ''}`)
                  .join(', ')}
                {plan.proposals.length > 8 ? '…' : ''}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted">Date de l’export :</span>
            <input type="date" className="field w-40 py-1 text-xs" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} />
          </div>
          <button className="btn-primary" disabled={busy || plan.create.length + plan.update.length === 0} onClick={() => void run()}>
            Importer
          </button>
        </div>
      )}

      {progress && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {fmt(progress[0])} / {fmt(progress[1])}
          </p>
        </div>
      )}
      {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </section>
  )
}

function PasswordChange() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit() {
    setMsg(null)
    if (next.length < 8) return setMsg({ ok: false, text: 'Le nouveau mot de passe doit faire au moins 8 caractères.' })
    if (next !== confirm) return setMsg({ ok: false, text: 'Les deux nouveaux mots de passe ne sont pas identiques.' })
    if (next === current) return setMsg({ ok: false, text: 'Le nouveau mot de passe doit être différent de l’actuel.' })
    if (!navigator.onLine) return setMsg({ ok: false, text: 'Il faut être connecté à internet pour changer de mot de passe.' })
    setBusy(true)
    try {
      const { data } = await supabase!.auth.getSession()
      const email = data.session?.user.email
      if (!email) return setMsg({ ok: false, text: 'Session introuvable : reconnecte-toi.' })
      // On vérifie d'abord le mot de passe actuel.
      const check = await supabase!.auth.signInWithPassword({ email, password: current })
      if (check.error) return setMsg({ ok: false, text: 'Mot de passe actuel incorrect.' })
      const { error } = await supabase!.auth.updateUser({ password: next })
      if (error) return setMsg({ ok: false, text: `Changement refusé : ${error.message}` })
      setCurrent('')
      setNext('')
      setConfirm('')
      setMsg({ ok: true, text: 'Mot de passe changé.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <div className="section-title mb-0">Mot de passe</div>
        <button className="btn-ghost px-3 py-1 text-xs" onClick={() => (setOpen((o) => !o), setMsg(null))}>
          {open ? 'Fermer' : 'Changer mon mot de passe'}
        </button>
      </div>
      {open && (
        <form
          className="mt-1 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <input className="field" type="password" autoComplete="current-password" placeholder="Mot de passe actuel" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <input className="field" type="password" autoComplete="new-password" placeholder="Nouveau mot de passe (8 caractères min.)" value={next} onChange={(e) => setNext(e.target.value)} required />
          <input className="field" type="password" autoComplete="new-password" placeholder="Confirmer le nouveau mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer le nouveau mot de passe'}
          </button>
        </form>
      )}
      {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </section>
  )
}


function CriteriaEditor() {
  const criteria = useLiveQuery(() => db.criteria.orderBy('order').toArray().then(alive), [], [])
  const [kind, setKind] = useState<'factual' | 'subjective'>('subjective')
  const [open, setOpen] = useState<string | null>(null)
  const list = criteria.filter((c) => c.kind === kind)

  async function add() {
    const c = await save<Criterion>('criteria', {
      id: newId(),
      label: 'Nouveau critère',
      category: list[list.length - 1]?.category ?? 'Divers',
      kind,
      scale: kind === 'subjective' ? 'score5' : 'number',
      active: true,
      order: (criteria[criteria.length - 1]?.order ?? 0) + 1,
    })
    setOpen(c.id)
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <SectionTitle
        info={
          <>
            <p>
              <b>Subjectifs</b> : notés par chaque observateur ; « Mode rapide » = inclus dans l’évaluation rapide.
            </p>
            <p>
              <b>Factuels</b> : une seule valeur par date, saisie par le préparateur physique, avec historique.
            </p>
            <p>Masquer un critère (décocher « Actif ») conserve son historique.</p>
          </>
        }
      >
        Critères
      </SectionTitle>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'subjective', label: 'Subjectifs (plusieurs avis)' },
          { value: 'factual', label: 'Factuels (préparateur)' },
        ]}
      />

      {groupBy(list, (c) => c.category).map(([cat, cs]) => (
        <div key={cat}>
          <div className="mb-1 text-[10px] font-extrabold tracking-wider text-accent uppercase">{cat}</div>
          <div className="divide-y divide-line rounded-lg border border-line">
            {cs.map((c) => (
              <div key={c.id} className={c.active ? '' : 'opacity-50'}>
                <button className="flex w-full items-center justify-between px-3 py-2 text-left text-xs" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <span className="font-bold">
                    {c.label}
                    {c.unit ? <span className="font-normal text-muted"> ({c.unit})</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-muted">
                    {c.quick && kind === 'subjective' && <span className="rounded bg-accent-soft px-1 text-accent">Rapide</span>}
                    {c.positions?.length ? <span>{c.positions.join(', ')}</span> : null}
                    {!c.active && <span>masqué</span>}
                    <span>{open === c.id ? '▴' : '▾'}</span>
                  </span>
                </button>
                {open === c.id && <CriterionEdit c={c} />}
              </div>
            ))}
          </div>
        </div>
      ))}

      <button className="btn-ghost text-xs" onClick={() => void add()}>
        + Ajouter un critère {kind === 'subjective' ? 'subjectif' : 'factuel'}
      </button>
    </section>
  )
}

function CriterionEdit({ c }: { c: Criterion }) {
  const [d, setD] = useState(c)
  // Texte brut des options (une par ligne), pour pouvoir taper librement.
  const [optText, setOptText] = useState((c.options ?? []).join('\n'))
  const dirty = JSON.stringify({ ...d, updatedAt: 0 }) !== JSON.stringify({ ...c, updatedAt: 0 })
  const set = <K extends keyof Criterion>(k: K, v: Criterion[K]) => setD((x) => ({ ...x, [k]: v }))
  const togglePos = (p: (typeof POSITIONS)[number]['id']) =>
    set('positions', d.positions?.includes(p) ? d.positions.filter((x) => x !== p) : [...(d.positions ?? []), p])

  return (
    <div className="flex flex-col gap-2 bg-panel-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="label">Nom</span>
          <input className="field" value={d.label} onChange={(e) => set('label', e.target.value)} />
        </div>
        <div>
          <span className="label">Catégorie</span>
          <input className="field" value={d.category} onChange={(e) => set('category', e.target.value)} />
        </div>
      </div>
      <div>
        <span className="label">Définition (ce qu'on observe)</span>
        <input className="field" value={d.description ?? ''} onChange={(e) => set('description', e.target.value || undefined)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="label">Échelle</span>
          <select className="field" value={d.scale} onChange={(e) => set('scale', e.target.value as CriterionScale)}>
            {SCALES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {d.scale === 'number' && (
          <div>
            <span className="label">Unité</span>
            <input className="field" value={d.unit ?? ''} onChange={(e) => set('unit', e.target.value || undefined)} />
          </div>
        )}
      </div>
      {d.scale === 'choice' && (
        <div>
          <span className="label">Options (une par ligne)</span>
          <textarea
            className="field min-h-20"
            placeholder={'Gauche\nDroit'}
            value={optText}
            onChange={(e) => {
              setOptText(e.target.value)
              const opts = [...new Set(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))]
              set('options', opts.length ? opts : undefined)
            }}
          />
          {(d.options?.length ?? 0) < 2 && <p className="text-[11px] text-muted">Indique au moins 2 options.</p>}
        </div>
      )}
      {d.scale !== c.scale && (
        <p className="text-[11px] text-amber-300">⚠ Changer d'échelle rend les anciennes valeurs difficiles à comparer avec les nouvelles.</p>
      )}
      <div>
        <span className="label">Postes concernés (aucun = tous)</span>
        <div className="flex flex-wrap gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => togglePos(p.id)}
              className={`rounded border px-2 py-1 text-[10px] font-bold ${d.positions?.includes(p.id) ? 'border-accent bg-accent text-white' : 'border-line text-muted'}`}
            >
              {p.short}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={d.kind === 'subjective'} onChange={(e) => set('kind', e.target.checked ? 'subjective' : 'factual')} />
          Subjectif (plusieurs avis)
        </label>
        {d.kind === 'subjective' && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!d.quick} onChange={(e) => set('quick', e.target.checked)} />
            Mode rapide
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} />
          Actif
        </label>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary flex-1 text-xs" disabled={!dirty || !d.label.trim() || (d.scale === 'choice' && (d.options?.length ?? 0) < 2)} onClick={async () => setD(await save<Criterion>('criteria', d))}>
          Enregistrer
        </button>
        <button
          className="btn text-xs text-muted hover:text-red-400"
          onClick={async () => {
            const n = (await db.measurements.where('criterionId').equals(c.id).count()) + (await db.evaluations.filter((e) => c.id in e.scores).count())
            if (n > 0) return inform(`Ce critère a ${n} valeur(s) enregistrée(s). Décoche « Actif » pour le masquer sans perdre l'historique.`)
            if (await ask(`Supprimer définitivement « ${c.label} » ?`, { ok: 'Supprimer' })) await remove('criteria', c.id)
          }}
        >
          Supprimer
        </button>
      </div>
    </div>
  )
}
