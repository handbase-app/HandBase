import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { groupBy, Icon, playerName, SectionTitle, Segmented, useMe, type IconName } from '../components/ui'
import { alive, db, newId, plural, POSITIONS, remove, save, saveMany, today, type Criterion, type CriterionScale } from '../db'
import { categoryStyles, defaultColor, defaultZone, RADAR_PALETTE, RADAR_ZONES, styleOf, type RadarZone } from '../radarZones'
import { clearDemo, loadDemo } from '../demo'
import { exportBackup, importBackup } from '../export'
import { applyCriteria, exportCriteria, planCriteria, readCriteriaFile, unpublishedCount, type CriteriaPlan } from '../criteriaImport'
import { categoryList, resolveCategory, type ParsedFile } from '../criteriaFormat'
import { applyImport, parseLicenceFile, planImport, type ImportPlan } from '../importLicences'
import { supabase, syncNow, useSyncState, wipeDevice } from '../sync'
import { ActivityLog } from '../components/ActivityLog'
import { QuestionLogView } from '../components/QuestionLogView'
import { canUseQuestionLog } from '../questionLog'
import { Members } from '../components/Members'
import { ListEditor } from '../components/ListEditor'
import { StructureSettings } from '../components/Structure'
import { ask, inform } from '../components/Confirm'
import { can, myDepartments, realRole, ROLE_HELP, ROLE_LABEL, useRole } from '../roles'
import { AdminTools } from '../components/ViewAs'
import { departmentLabel } from '../lists'
import { usePerimeter } from '../installation'
import { perimeterText } from '../perimeter'
import { STAFF } from '../staffLabels'
import { useTeams } from '../teams'
import { useSessionState } from '../components/PlayerFilter'
import { disablePush, enablePush, NOTIF_KINDS, pushSupport, readNotifPrefs, saveNotifPrefs, sendTestNotification, syncSubscription } from '../push'
import { useDictation } from '../dictation/useDictation'
import { useThemeVersion } from '../theme'
import { AppearanceSettings, appearanceSummary, InstallationStyle } from '../components/StyleSettings'

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
  const teams = useTeams() ?? []
  return (
    // Ordinateur (administrateur) : « Mon espace » à gauche, « Administration » à droite.
    <div className={`flex flex-col gap-3 ${admin ? 'side:grid side:grid-cols-2 side:items-start side:gap-x-6' : ''}`}>
      <h1 className="text-lg font-extrabold side:col-span-full">Réglages</h1>

      <div className="flex flex-col gap-3">
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
        <PerimeterInfo />
        {supabase && <PasswordChange />}
      </Fold>
      {supabase && (
        <Fold id="notifications" icon="bell" title="Notifications" summary="Sur ce téléphone : avis, fiches, participants, rappels, suivis">
          <NotificationSettings />
        </Fold>
      )}
      <DictationSetting />
      <ApparenceFold />
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

      {(can.manageTeams(role) || teams.length > 0) && <TeamsLink />}
      {/* Structure et sport (supabase/044) : lecture seule pour les comptes qui ne sont pas administrateurs. */}
      {!admin && (
        <Fold id="structure" icon="globe" title="Structure et sport" summary="Niveaux, unités, postes (lecture seule)">
          <StructureSettings editable={false} />
        </Fold>
      )}
      </div>

      {admin && (
        <div className="flex flex-col gap-3">
          <div className="mt-3 text-[10px] side:mt-1 font-extrabold tracking-wider text-muted uppercase">Administration</div>
          <Link to="/bilan?onglet=licencies" className="card flex items-center gap-3 px-4 py-3 transition hover:border-accent">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-muted">
              <Icon name="map" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Bilan de détection</span>
              <span className="block truncate text-[11px] text-muted">Carte : licenciés, mesures, profils repérés, chiffres clés</span>
            </span>
            <span className="text-muted">›</span>
          </Link>
          {supabase && (
            <Fold id="membres" icon="users" title="Utilisateurs" summary="Comptes, rôles, secteurs">
              <p className="text-[11px] text-muted">
                {STAFF.settingsHelp}{' '}
                <Link to={STAFF.route} className="font-bold text-accent underline">
                  {STAFF.title}
                </Link>
              </p>
              <Members />
            </Fold>
          )}
          <Fold id="structure" icon="globe" title="Structure et sport" summary="Postes, niveaux, unités, affectations">
            <StructureSettings editable={can.editStructure(role)} />
          </Fold>
          {/* Style de l'installation (polices, arrondis, couleurs, nom, logo) : configuration partagée, src/uiStyle.ts. */}
          <Fold id="style" icon="palette" title="Style de l’installation" summary="Actuel, Sport, Officiel, Sombre · nom et logo">
            <InstallationStyle editable={can.editStructure(role)} />
          </Fold>
          <Fold id="referentiel" icon="list" title="Critères et listes" summary="Critères, départements, régions">
            {can.editCriteria(role) && <CriteriaTransfer />}
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
                          setMsg(`${plural(await importBackup(f), 'élément importé', 'éléments importés')}.`)
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
                      setMsg(`Démo chargée : ${r.criteria ? `${r.criteria} critères, ` : ''}${r.players} joueurs, ${r.measurements} mesures, ${r.events} événements, ${r.evaluations} avis.`)
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
          {/* Administrateur réel seulement (lecture réservée aux administrateurs), absent pendant « Voir comme… ». */}
          {canUseQuestionLog() && (
            <Fold id="questions-avancees" icon="message" title="Journal des questions" summary="Questions posées au bilan (ratées, sauvées, comprises), pour écrire de nouvelles recettes">
              <QuestionLogView />
            </Fold>
          )}
          {supabase && (
            <Fold id="journal" icon="clock" title="Historique" summary="Qui a créé, modifié ou supprimé quoi">
              <ActivityLog />
            </Fold>
          )}
          {/* Outils administrateur (« Voir comme… ») : selon le vrai rôle, absents pendant la simulation (bandeau « Quitter »). */}
          {realRole() === 'admin' && (
            <Fold id="outils" icon="eye" title="Outils administrateur" summary="Voir l’appli comme un membre du staff">
              <AdminTools />
            </Fold>
          )}
        </div>
      )}
    </div>
  )
}

/** Notifications : activer sur cet appareil, choisir quoi recevoir (compte), envoyer un test. */
function NotificationSettings() {
  const support = pushSupport()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [prefs, setPrefs] = useState<Record<string, boolean | number>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    // « Activées » seulement si le serveur a bien cet appareil (réenregistré au passage).
    void syncSubscription().then(setSubscribed)
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

  const toggle = async (id: string, on: boolean | number) => {
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
      {/* Ne pas déranger (supabase/027_notifications_nuit.sql) : par défaut de 21 h à 8 h. */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={prefs.quiet !== false} onChange={(e) => void toggle('quiet', e.target.checked)} />
          <b>Ne pas déranger la nuit</b>
        </label>
        {prefs.quiet !== false && (
          <div className="flex items-center gap-2 pl-6 text-xs">
            de
            <select className="field w-20 py-1 text-xs" value={Number(prefs.quietFrom ?? 21)} onChange={(e) => void toggle('quietFrom', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
            à
            <select className="field w-20 py-1 text-xs" value={Number(prefs.quietTo ?? 8)} onChange={(e) => void toggle('quietTo', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-[11px] text-muted">
          {prefs.quiet !== false
            ? `Pendant ce créneau, rien n’arrive : les notifications partent à ${Number(prefs.quietTo ?? 8)} h.`
            : 'Les notifications arrivent à toute heure.'}{' '}
          Plusieurs à la suite sont regroupées (« 3 avis à valider »).
        </p>
      </div>
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

/**
 * Dictée vocale (essai) : visible seulement quand elle est disponible pour ce compte et cet appareil (useDictation) ;
 * activée par défaut, réglage gardé sur l'appareil.
 */
function DictationSetting() {
  const { available, enabled, setEnabled, access } = useDictation()
  const search = !!access?.filtres
  if (!available) return null
  return (
    <Fold id="dictee" icon="mic" title="Dictée vocale (essai)" summary={enabled ? `Activée sur cet appareil : micro à côté des commentaires${search ? ' et des recherches (joueurs, bilan…)' : ''}` : 'Désactivée sur cet appareil'}>
      <section className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <b>Dictée vocale (essai)</b>
        </label>
        <p className="text-[11px] text-muted">
          Le son est envoyé à Mistral AI (France) pour être transcrit, puis effacé ; seul le texte est gardé. Pendant l'essai (offre
          gratuite), évitez de dicter des noms.
        </p>
        <p className="text-[11px] text-muted">
          Touchez le micro pour commencer et pour finir (ou maintenez-le pendant que vous parlez), 1 minute au plus. Le texte s'ajoute au
          commentaire : relisez-le avant d'enregistrer.
          {access?.restantMois != null && ` Restant : ${access.restantMois} dictées ce mois-ci, ${access.restantJour ?? '?'} aujourd'hui pour vous.`}
        </p>
        {search && (
          <p className="text-[11px] text-muted">
            Recherche de joueurs : dans Joueurs, touchez le bouton micro ✨ à côté de « Rechercher… », dites par exemple « les gauchers
            nés en 2010 qui mesurent plus d'1 m 80 » ou « trouve Lucas Martin », puis touchez-le à nouveau ; ensuite « ajoute le Var »,
            « enlève la taille » ou « efface la sélection ». Les filtres restent modifiables à la main ; « Annuler » remet les précédents. Seuls la phrase, la
            liste des filtres possibles et les filtres choisis (sans le nom cherché) sont envoyés à Mistral AI, avec les noms de vos groupes et de vos profils
            recherchés ; aucune donnée de joueur. « Efface tout », « réinitialise »… se font sur l'appareil, sans envoi. Chaque phrase
            compte comme deux dictées : la transcription, puis la recherche.
          </p>
        )}
        {search && (
          <p className="text-[11px] text-muted">
            Le même bouton (« Filtrer ») se trouve dans le bilan de détection (« les filles de 2011 dans le Var », « depuis
            toujours », « le club de Toulon »){access?.modes?.includes('question_evenements') ? ' ; le champ « Filtrer ou poser une question… » et son micro ✨, dans Événements (« les tournois de cette saison », « combien par mois ? »)' : ''}
            {access?.modes?.includes('question_groupes') ? ' et dans Groupes (« les groupes de filles du Var »)' : ''}. Une phrase s’ajoute aux filtres posés ; les noms d’événements, de
            groupes, de lieux et de clubs ne sont pas envoyés : ce que vous dites est retrouvé sur l’appareil.
          </p>
        )}
        {access?.avis && (
          <p className="text-[11px] text-muted">
            Avis vocal : sur l’écran de notation, touchez « ✨ Avis vocal » et parlez librement du joueur. Les notes proposées sont
            mises en évidence avec le passage dicté : touchez-les pour les accepter, choisissez-en une autre ou écartez-les ; les
            commentaires proposés s’ajoutent d’un toucher. Rien n’est enregistré avant « Enregistrer », l’avis reste le vôtre. Seuls
            le texte dicté et la liste des critères sont envoyés ; deux dictées comptées par avis.
          </p>
        )}
        {search && access?.modes?.includes('question') && (
          <p className="text-[11px] text-muted">
            Poser une question : dans le bilan de détection, touchez « Poser une question » et dites par exemple « les joueuses 2011
            vues une seule fois cette saison, par département » ou « combien de gardiens 2009 mesurent plus de 1 m 85 » (ou tapez-la).
            La réponse est calculée sur l’appareil : seuls la phrase et la description des questions possibles (postes, critères,
            date du jour) sont envoyées, jamais les données des joueurs. La question s’affiche en pastilles modifiables ;
            « Enregistrer cette question » la garde dans « Mes questions » (sur cet appareil), à relancer sans envoi.
          </p>
        )}
      </section>
    </Fold>
  )
}

/** Apparence (chacun) : thème, ou Clair / Sombre / Auto selon le style de l'installation. */
function ApparenceFold() {
  useThemeVersion()
  return (
    <Fold id="apparence" icon="palette" title="Apparence" summary={appearanceSummary()}>
      <AppearanceSettings />
    </Fold>
  )
}

/**
 * Rubrique repliable des réglages : une ligne (icône, titre, résumé) qui s'ouvre sur ses réglages.
 * Les cartes des réglages s'y fondent (séparées par un trait) ; l'état ouvert est gardé pendant la session.
 */
/** Lien vers « Mes staffs » (équipes d'encadrants, supabase/034). */
function TeamsLink() {
  return (
    <Link to={STAFF.route} className="card flex items-center gap-3 px-4 py-3 transition hover:border-accent">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-muted">
        <Icon name="users" className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{STAFF.title}</span>
        <span className="block truncate text-[11px] text-muted">{STAFF.settingsHelp}</span>
      </span>
      <span className="text-muted">›</span>
    </Link>
  )
}

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

/**
 * Périmètre du compte (supabase/046_perimetre.sql) : les joueurs reçus sur l'appareil. Lu dans la structure (unités où il est
 * affecté + sous-unités), comme le serveur.
 */
function PerimeterInfo() {
  const per = usePerimeter()
  if (!per) return null
  const text = perimeterText(per)
  return (
    <section className="card flex flex-col gap-2 p-4" data-testid="perimetre">
      <SectionTitle
        info={
          <>
            <p>
              Les joueurs que tu reçois sur cet appareil, avec leurs avis, mesures, « vu » et « à revoir » : ceux des unités où un administrateur t’a
              affecté (Structure et sport) et de leurs sous-unités. Les fiches que tu as créées restent toujours visibles.
            </p>
            <p>Événements et groupes restent communs à tout le staff : un joueur hors de ton périmètre y est compté, sans son nom.</p>
          </>
        }
      >
        Mon périmètre
      </SectionTitle>
      {text ? (
        <p className="text-xs">
          <b className="text-accent">{text}</b>
        </p>
      ) : (
        <p className="text-xs text-muted">Pas encore de périmètre : un administrateur doit t’affecter à une unité (Réglages → Structure et sport). En attendant, aucun joueur n’est visible.</p>
      )}
    </section>
  )
}

function Account() {
  const { state, lastError } = useSyncState()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const role = useRole()

  /** Déconnexion : les données de l'appareil sont effacées ; on prévient s'il reste des modifications pas envoyées. */
  async function logout() {
    setBusy(true)
    // Dernière chance d'envoyer ce qui attend.
    if (navigator.onLine) await syncNow({ retry: true })
    const pending = new Set((await db.outbox.toArray()).map((i) => `${i.table}:${i.rowId}`)).size
    setBusy(false)
    const ok = await ask(
      pending
        ? `${pending} modification(s) pas encore envoyée(s) au serveur (hors ligne, ou refusée(s)) seront PERDUES. Pour les garder, reste connecté et synchronise une fois en ligne (voir l’état de la synchronisation). Se déconnecter quand même ?`
        : 'Se déconnecter ? Les données HandBase seront effacées de cet appareil ; elles restent sur le serveur et reviendront à la prochaine connexion.',
      { ok: pending ? 'Perdre et se déconnecter' : 'Se déconnecter' },
    )
    if (ok) await wipeDevice({ signOut: true })
  }

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
            <p>Les données sont gardées sur l’appareil et envoyées au serveur dès que possible : on peut travailler hors ligne. Se déconnecter les efface de l’appareil (elles restent sur le serveur).</p>
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
          Secteur (validations) :{' '}
          <b>{myDepartments().length ? myDepartments().map(departmentLabel).join(', ') : role === 'preparateur' ? 'tous les départements' : 'non attribué'}</b>
        </p>
      )}
      <p className="text-[11px] text-muted">
        Synchronisation : {label}
        {lastError && ` — ${lastError}`}
      </p>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 text-xs" onClick={() => void syncNow({ retry: true })}>
          Synchroniser maintenant
        </button>
        <button className="btn-ghost flex-1 text-xs" disabled={busy} onClick={() => void logout()}>
          {busy ? 'Envoi…' : 'Se déconnecter'}
        </button>
      </div>
    </section>
  )
}

// Une synchronisation complète (envoi + réception de tout ce qui manquait) a abouti pendant cette session.
let caughtUp = false

/**
 * L'import compare le fichier à la base de l'appareil : elle doit être à jour (synchronisation terminée,
 * rien en attente d'envoi), sinon on recréerait des joueurs déjà importés ailleurs. Renvoie la raison du blocage.
 */
function useImportBlock(): string | null {
  const { state } = useSyncState()
  const outbox = useLiveQuery(() => db.outbox.count(), [], 0)
  const prev = useRef(state)
  const [, force] = useState(0)
  useEffect(() => {
    if (prev.current === 'syncing' && state === 'synced' && !caughtUp) {
      caughtUp = true
      force((n) => n + 1)
    }
    prev.current = state
  }, [state])
  // Première visite : on lance une synchronisation pour savoir où on en est.
  useEffect(() => {
    if (supabase && !caughtUp) void syncNow()
  }, [])
  if (state === 'local') return null // pas de serveur : la base de l'appareil est la seule
  if (state === 'offline') return 'Import impossible hors ligne : connecte-toi à internet pour que la base soit à jour avant d’importer.'
  if (state === 'login') return 'Connecte-toi d’abord : l’import doit partir de la base à jour.'
  if (state === 'error') return 'La synchronisation a échoué : utilise « Synchroniser maintenant » et attends qu’elle réussisse avant d’importer.'
  if (state === 'syncing' || !caughtUp) return 'Synchronisation en cours… L’import sera possible dès que toute la base sera à jour sur cet appareil.'
  if (outbox > 0)
    return `${plural(outbox, 'modification attend', 'modifications attendent')} d’être envoyée${outbox > 1 ? 's' : ''} au serveur : garde l’appli ouverte et en ligne, l’import sera possible ensuite.`
  return null
}

/** Import d'un export de licences Gest'Hand (administrateurs). */
function LicenceImport() {
  const blocked = useImportBlock()
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [sourceDate, setSourceDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function pick(file: File) {
    if (blocked) return setMsg({ ok: false, text: blocked })
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
    if (blocked) return setMsg({ ok: false, text: blocked })
    const n = plan.create.length + plan.update.length
    if (!(await ask(`Importer ${plural(n, 'joueur')} ? ${n > 1 ? 'Ils seront visibles' : 'Il sera visible'} par tout le staff.`, { ok: 'Importer', danger: false }))) return
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
      {blocked && !busy && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">{blocked}</p>}
      <label className={`btn-ghost cursor-pointer text-xs ${busy || blocked ? 'pointer-events-none opacity-40' : ''}`}>
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
                <b>{fmt(plan.proposals.length)}</b> {plan.proposals.length > 1 ? 'fiches proposées ou hors cadre retrouvées' : 'fiche proposée ou hors cadre retrouvée'} dans les licences,{' '}
                {plan.proposals.length > 1 ? 'qui seront complétées' : 'qui sera complétée'} :{' '}
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
          <button className="btn-primary" disabled={busy || !!blocked || plan.create.length + plan.update.length === 0} onClick={() => void run()}>
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


/**
 * Import / export des critères (administrateurs) : les critères ne sont pas livrés avec l'appli, ils viennent de la base
 * partagée et sont importés depuis un fichier Excel, CSV ou JSON (criteriaImport.ts). Aperçu avant validation.
 */
function CriteriaTransfer() {
  const blocked = useImportBlock()
  const [mode, setMode] = useState<CriteriaPlan['mode']>('fusion')
  const [file, setFile] = useState<{ name: string; parsed: ParsedFile } | null>(null)
  const [plan, setPlan] = useState<CriteriaPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Version de la liste (nombre et dernière modification) : l'aperçu suit les changements de la base.
  const version = useLiveQuery(async () => {
    const cs = await db.criteria.toArray()
    return `${cs.length}:${Math.max(0, ...cs.map((c) => c.updatedAt))}`
  }, [], '')
  const total = useLiveQuery(() => db.criteria.filter((c) => !c.deleted).count(), [], 0)
  const unpublished = useLiveQuery(unpublishedCount, [], 0)
  const base = import.meta.env.BASE_URL

  // Aperçu recalculé si le mode change (ou si la base change pendant ce temps).
  useEffect(() => {
    if (!file) return
    let live = true
    void planCriteria(file.parsed, mode).then((p) => live && setPlan(p))
    return () => {
      live = false
    }
  }, [file, mode, version])

  async function pick(f: File) {
    if (blocked) return setMsg({ ok: false, text: blocked })
    setMsg(null)
    setFile(null)
    setPlan(null)
    setBusy(true)
    try {
      setFile({ name: f.name, parsed: await readCriteriaFile(f) })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Fichier illisible.' })
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    if (!plan || plan.errors.length) return
    if (blocked) return setMsg({ ok: false, text: blocked })
    const n = plan.added.length + plan.changed.length + plan.hidden.length
    const lost = plan.dropped.filter((d) => d.values > 0).length
    const text = [
      `Importer ${plural(n, 'critère')} ?`,
      supabase ? 'Ils seront partagés avec tout le staff.' : '',
      lost
        ? `${plural(lost, 'critère')} de cet appareil, absent${lost > 1 ? 's' : ''} du fichier et jamais partagé${lost > 1 ? 's' : ''}, ${lost > 1 ? 'ont' : 'a'} des valeurs enregistrées : ${lost > 1 ? 'ils disparaîtront' : 'il disparaîtra'} de l’écran.`
        : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (!(await ask(text, { ok: 'Importer', danger: lost > 0 }))) return
    setBusy(true)
    try {
      const r = await applyCriteria(plan)
      setFile(null)
      setPlan(null)
      setMsg({
        ok: true,
        text: `${plural(r.added, 'critère ajouté', 'critères ajoutés')}, ${plural(r.changed, 'modifié')}${r.hidden ? `, ${plural(r.hidden, 'masqué')}` : ''}.${supabase ? ' La synchronisation les envoie au serveur (garde l’appli ouverte et en ligne).' : ''}`,
      })
    } catch (e) {
      setMsg({ ok: false, text: `Import interrompu : ${e instanceof Error ? e.message : e}` })
    } finally {
      setBusy(false)
    }
  }

  const writes = plan ? plan.added.length + plan.changed.length + plan.hidden.length : 0
  const local = plan?.added.filter((a) => a.local).length ?? 0
  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle
        info={
          <>
            <p>
              Les critères ne sont pas livrés avec l’appli : ils viennent de la base partagée, la même pour tout le staff. Un administrateur les importe depuis un fichier Excel (.xlsx),
              CSV ou JSON.
            </p>
            <p>
              <b>Fusionner</b> ajoute et met à jour les critères du fichier (repérés par leur identifiant), sans rien retirer. <b>Remplacer</b> masque en plus les critères absents du
              fichier (jamais supprimés : leur historique est gardé).
            </p>
            <p>
              Colonnes obligatoires : id, catégorie, libellé, type, échelle. Une colonne facultative absente du fichier garde la valeur actuelle des critères existants ; une case vide
              l’efface.
            </p>
            <p>L’identifiant d’un critère ne doit jamais changer : mesures et avis y sont rattachés. « Exporter » donne la liste actuelle dans le même format (modèle et sauvegarde).</p>
          </>
        }
      >
        Importer / exporter les critères
      </SectionTitle>
      {total === 0 && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">Aucun critère pour l’instant : importe un fichier (pars du modèle).</p>}
      {unpublished > 0 && (
        <p className="rounded-md border border-sky-500/40 bg-sky-500/10 p-2 text-[11px]">
          {plural(unpublished, 'critère de cet appareil n’a', 'critères de cet appareil n’ont')} jamais été partagé{unpublished > 1 ? 's' : ''} (anciens critères livrés avec l’appli). Pour
          les publier tels quels : « Exporter », puis importer ce fichier.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted">Exporter</span>
        {(['xlsx', 'csv', 'json'] as const).map((f) => (
          <button key={f} className="btn-ghost px-2 py-1 text-xs" disabled={!total} onClick={() => void exportCriteria(f)}>
            {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted">Modèle</span>
        <a className="btn-ghost px-2 py-1 text-xs" href={`${base}modeles/criteres-modele.xlsx`} download>
          Excel
        </a>
        <a className="btn-ghost px-2 py-1 text-xs" href={`${base}modeles/criteres-modele.csv`} download>
          CSV
        </a>
      </div>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'fusion', label: 'Fusionner' },
          { value: 'remplacement', label: 'Remplacer (masque les absents)' },
        ]}
      />
      {blocked && !busy && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">{blocked}</p>}
      <label className={`btn-ghost cursor-pointer text-xs ${busy || blocked ? 'pointer-events-none opacity-40' : ''}`}>
        {busy && !file ? 'Lecture…' : 'Choisir le fichier (Excel, CSV ou JSON)'}
        <input
          type="file"
          accept=".xlsx,.csv,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void pick(f)
          }}
        />
      </label>

      {file && plan && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-3 text-xs">
          <div className="truncate text-[11px] text-muted">{file.name}</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <b className="text-base">{plan.added.length}</b> nouveau{plan.added.length > 1 ? 'x' : ''}
            </div>
            <div>
              <b className="text-base">{plan.changed.length}</b> modifié{plan.changed.length > 1 ? 's' : ''}
            </div>
            <div className="text-muted">
              {plan.unchanged} inchangé{plan.unchanged > 1 ? 's' : ''}
            </div>
            <div className={plan.errors.length ? 'font-bold text-red-300' : 'text-muted'}>
              {plan.errors.length} erreur{plan.errors.length > 1 ? 's' : ''}
            </div>
            {mode === 'remplacement' && (
              <div className="col-span-2">
                {plural(plan.hidden.length, 'critère absent du fichier sera masqué', 'critères absents du fichier seront masqués')} (historique gardé)
              </div>
            )}
          </div>
          {local > 0 && (
            <p className="text-[11px] text-muted">
              Dont {plural(local, 'critère déjà sur cet appareil mais jamais partagé', 'critères déjà sur cet appareil mais jamais partagés')} : {local > 1 ? 'ils seront publiés' : 'il sera publié'}.
            </p>
          )}
          {plan.errors.length > 0 && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-[11px]">
              <b>À corriger dans le fichier, puis le recharger :</b>
              <ul className="mt-1 list-disc pl-4">
                {plan.errors.slice(0, 30).map((e) => (
                  <li key={e.line}>
                    Ligne {e.line}
                    {e.id ? ` (${e.id})` : ''} : {e.reason}
                  </li>
                ))}
              </ul>
              {plan.errors.length > 30 && <div>… et {plan.errors.length - 30} autres.</div>}
            </div>
          )}
          {plan.changed.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer font-bold">Détail des modifications</summary>
              <ul className="mt-1 flex flex-col gap-0.5 pl-1">
                {plan.changed.map((x) => (
                  <li key={x.c.id} className={x.risky ? 'text-amber-300' : ''}>
                    <b>{x.c.label}</b> <span className="text-muted">({x.c.id})</span> : {x.fields.join(', ')}
                    {x.risky ? ' — type ou échelle changé alors que des valeurs existent : elles seront difficiles à comparer' : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {plan.added.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer font-bold">Nouveaux critères</summary>
              <p className="mt-1">{plan.added.map((x) => x.c.label).join(', ')}</p>
            </details>
          )}
          {mode === 'remplacement' && plan.hidden.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer font-bold">Critères masqués</summary>
              <p className="mt-1">{plan.hidden.map((c) => c.label).join(', ')}</p>
            </details>
          )}
          {plan.dropped.length > 0 && (
            <p className={`rounded-md border p-2 text-[11px] ${plan.dropped.some((d) => d.values) ? 'border-amber-500/40 bg-amber-500/10' : 'border-line'}`}>
              {plural(plan.dropped.length, 'critère de cet appareil, jamais partagé et absent du fichier, sera retiré', 'critères de cet appareil, jamais partagés et absents du fichier, seront retirés')} :{' '}
              {plan.dropped.map((d) => `${d.c.label}${d.values ? ` (${plural(d.values, 'valeur')})` : ''}`).join(', ')}.
              {plan.dropped.some((d) => d.values) && ' Les valeurs restent en base mais ne s’affichent plus : ajoute ces critères au fichier pour les garder.'}
            </p>
          )}
          <div className="flex gap-2">
            <button
              className="btn-ghost flex-1 text-xs"
              disabled={busy}
              onClick={() => {
                setFile(null)
                setPlan(null)
              }}
            >
              Annuler
            </button>
            <button className="btn-primary flex-1 text-xs" disabled={busy || !!blocked || plan.errors.length > 0 || writes === 0} onClick={() => void run()}>
              {writes === 0 && !plan.errors.length ? 'Rien à importer' : 'Importer'}
            </button>
          </div>
        </div>
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
  const role = useRole()
  // Critère en cours d'ajout : pas enregistré avant « Enregistrer » ; `at` = catégorie d'où l'on ajoute (sinon en bas).
  const [draft, setDraft] = useState<{ c: Criterion; at: string | null } | null>(null)
  const cats = categoryList(criteria, kind)

  function add(category: string | null) {
    setOpen(null)
    setDraft({
      at: category,
      c: {
        id: newId(),
        label: '',
        // Depuis une catégorie : celle-ci ; sinon la première ; aucune : nouvelle catégorie à saisir.
        category: category ?? cats[0] ?? '',
        kind,
        scale: kind === 'subjective' ? 'score5' : 'number',
        active: true,
        order: (criteria[criteria.length - 1]?.order ?? 0) + 1,
        updatedAt: 0,
      },
    })
  }
  const draftEditor = draft && (
    <div className="rounded-lg border border-accent/60">
      <div className="px-3 pt-2 text-[11px] font-bold text-accent">Nouveau critère {kind === 'subjective' ? 'subjectif' : 'factuel'}</div>
      <CriterionEdit
        key={draft.c.id}
        c={draft.c}
        categories={categoryList(criteria, draft.c.kind)}
        isNew
        onDone={(saved) => {
          setDraft(null)
          if (saved) setOpen(saved.id)
        }}
      />
    </div>
  )

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
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-[10px] font-extrabold tracking-wider text-accent uppercase">{cat}</span>
            <RadarPlacement category={cat} criteria={criteria} editable={can.editCriteria(role)} />
          </div>
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
                {open === c.id && <CriterionEdit c={c} categories={categoryList(criteria, c.kind)} />}
              </div>
            ))}
          </div>
          {draft?.at === cat && draft.c.kind === kind ? (
            <div className="mt-2">{draftEditor}</div>
          ) : (
            <button className="mt-1 min-h-11 w-full rounded-md text-left text-[11px] font-bold text-muted hover:text-accent" onClick={() => add(cat)}>
              + Ajouter dans « {cat} »
            </button>
          )}
        </div>
      ))}

      {draft && draft.c.kind === kind && (draft.at === null || !list.some((c) => c.category === draft.at)) ? (
        draftEditor
      ) : (
        <button className="btn-ghost min-h-11 text-xs" onClick={() => add(null)}>
          + Ajouter un critère {kind === 'subjective' ? 'subjectif' : 'factuel'}
        </button>
      )}
    </section>
  )
}

/**
 * Place de la catégorie sur le radar des avis (src/radarZones.ts) : zone du cadran et couleur, posées sur tous ses
 * critères (synchronisés comme le reste). « Auto » : déduites du nom de la catégorie.
 */
function RadarPlacement({ category, criteria, editable }: { category: string; criteria: Criterion[]; editable: boolean }) {
  const st = styleOf(categoryStyles(criteria), category)
  const auto = defaultZone(category)
  const zoneText = (z: RadarZone | null) => (z ? RADAR_ZONES.find((x) => x.id === z)!.label.toLowerCase() : 'dans l’espace libre')
  async function apply(patch: { radarZone?: RadarZone | null; radarColor?: string | null }) {
    const rows = criteria
      .filter((c) => c.category === category)
      .map((c) => {
        const next = { ...c }
        if (patch.radarZone !== undefined) next.radarZone = patch.radarZone ?? undefined
        if (patch.radarColor !== undefined) next.radarColor = patch.radarColor ?? undefined
        return next
      })
    await saveMany<Criterion>('criteria', rows)
  }
  if (!editable)
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
        Radar : {zoneText(st.zone)}
      </span>
    )
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
      <label className="flex items-center gap-1">
        Radar
        <select
          className="rounded border border-line bg-panel-2 px-1 py-1 text-[11px] text-fg"
          aria-label={`Zone du radar pour ${category}`}
          value={st.setZone ? st.zone! : ''}
          onChange={(e) => void apply({ radarZone: (e.target.value || null) as RadarZone | null })}
        >
          <option value="">Auto ({zoneText(auto)})</option>
          {RADAR_ZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
      </label>
      <span className="flex items-center" role="radiogroup" aria-label={`Couleur du radar pour ${category}`}>
        {RADAR_PALETTE.map((p) => {
          const on = st.color.toLowerCase() === p.color.toLowerCase()
          return (
            <button
              key={p.color}
              type="button"
              role="radio"
              aria-checked={on}
              title={p.label + (!st.setColor && p.color === defaultColor(category) ? ' (auto)' : '')}
              onClick={() => void apply({ radarColor: p.color === defaultColor(category) ? null : p.color })}
              className="flex h-8 w-6 items-center justify-center"
            >
              <span className={`block h-4 w-4 rounded-full ${on ? 'ring-2 ring-fg ring-offset-1 ring-offset-panel' : ''}`} style={{ background: p.color }} />
            </button>
          )
        })}
      </span>
    </span>
  )
}

const NEW_CATEGORY = '\u0000nouvelle'

/**
 * Fiche d'un critère (modification, ou ajout : `isNew`, rien n'est enregistré avant « Enregistrer »).
 * Catégorie choisie dans la liste des catégories existantes, ou « + Nouvelle catégorie… » (tapée ; si elle existe
 * déjà à la casse et aux espaces près, l'existante est reprise).
 */
function CriterionEdit({ c, categories, isNew, onDone }: { c: Criterion; categories: string[]; isNew?: boolean; onDone?: (saved: Criterion | null) => void }) {
  const [d, setD] = useState(c)
  // Texte brut des options (une par ligne), pour pouvoir taper librement.
  const [optText, setOptText] = useState((c.options ?? []).join('\n'))
  // Nouvelle catégorie en cours de saisie (null : catégorie choisie dans la liste).
  const [newCat, setNewCat] = useState<string | null>(categories.includes(c.category) ? null : c.category)
  const category = newCat === null ? d.category : resolveCategory(newCat, categories)
  const known = categories.includes(category)
  const eff = { ...d, category }
  // Zone / couleur du radar : réglées pour toute la catégorie (RadarPlacement), jamais par cette copie.
  const radar = (x: Criterion) => ({ ...x, updatedAt: 0, radarZone: undefined, radarColor: undefined })
  const dirty = isNew || JSON.stringify(radar(eff)) !== JSON.stringify(radar(c))
  const uid = useId()
  async function submit() {
    // Même catégorie : réglage du radar gardé ; autre catégorie : celui de la nouvelle (ou déduit de son nom).
    const saved = await save<Criterion>('criteria', category === c.category ? { ...eff, radarZone: c.radarZone, radarColor: c.radarColor } : { ...eff, radarZone: undefined, radarColor: undefined })
    if (isNew) return onDone?.(saved)
    setD(saved)
    setNewCat(null)
  }
  const set = <K extends keyof Criterion>(k: K, v: Criterion[K]) => setD((x) => ({ ...x, [k]: v }))
  const togglePos = (p: (typeof POSITIONS)[number]['id']) =>
    set('positions', d.positions?.includes(p) ? d.positions.filter((x) => x !== p) : [...(d.positions ?? []), p])

  return (
    <div className="flex flex-col gap-2 bg-panel-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`${uid}-nom`}>
            Nom
          </label>
          <input id={`${uid}-nom`} className="field min-h-11" autoFocus={isNew && newCat === null} placeholder="Nom du critère" value={d.label} onChange={(e) => set('label', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-cat`}>
            Catégorie
          </label>
          <select
            id={`${uid}-cat`}
            className="field min-h-11"
            value={newCat === null ? d.category : NEW_CATEGORY}
            onChange={(e) => {
              if (e.target.value === NEW_CATEGORY) setNewCat('')
              else {
                setNewCat(null)
                set('category', e.target.value)
              }
            }}
          >
            {categories.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
            <option value={NEW_CATEGORY}>+ Nouvelle catégorie…</option>
          </select>
        </div>
      </div>
      {newCat !== null && (
        <div>
          <label className="label" htmlFor={`${uid}-new`}>
            Nouvelle catégorie
          </label>
          <input
            id={`${uid}-new`}
            className="field min-h-11"
            autoFocus
            placeholder="Nom de la catégorie"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              // Échap : retour à la liste (catégorie d'avant).
              if (e.key === 'Escape' && categories.length) {
                e.stopPropagation()
                setNewCat(null)
              }
            }}
          />
          {category && (
            <p className="mt-1 text-[11px] text-muted">
              {known ? (
                <>« {category} » existe déjà : le critère y sera rangé.</>
              ) : (
                <>
                  Nouvelle catégorie · sur le radar : {(() => {
                    const z = defaultZone(category)
                    return z ? RADAR_ZONES.find((x) => x.id === z)!.label.toLowerCase() : 'dans l’espace libre'
                  })()}
                  <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: defaultColor(category) }} />
                </>
              )}
            </p>
          )}
        </div>
      )}
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
        <p className="text-[11px] text-amber-300"><Icon name="alert" className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />Changer d'échelle rend les anciennes valeurs difficiles à comparer avec les nouvelles.</p>
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
        <button className="btn-primary min-h-11 flex-1 text-xs" disabled={!dirty || !d.label.trim() || !category || (d.scale === 'choice' && (d.options?.length ?? 0) < 2)} onClick={() => void submit()}>
          Enregistrer
        </button>
        {isNew ? (
          <button className="btn min-h-11 text-xs text-muted" onClick={() => onDone?.(null)}>
            Annuler
          </button>
        ) : (
        <button
          className="btn text-xs text-muted hover:text-red-400"
          onClick={async () => {
            const n = (await db.measurements.where('criterionId').equals(c.id).count()) + (await db.evaluations.filter((e) => c.id in e.scores).count())
            if (n > 0) return inform(`Ce critère a ${plural(n, 'valeur enregistrée', 'valeurs enregistrées')}. Décoche « Actif » pour le masquer sans perdre l'historique.`)
            if (await ask(`Supprimer définitivement « ${c.label} » ?`, { ok: 'Supprimer' })) await remove('criteria', c.id)
          }}
        >
          Supprimer
        </button>
        )}
      </div>
    </div>
  )
}
