import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { groupBy, Segmented, useMe } from '../components/ui'
import { alive, db, newId, POSITIONS, remove, save, type Criterion, type CriterionScale } from '../db'
import { clearDemo, loadDemo } from '../demo'
import { exportBackup, importBackup } from '../export'
import { supabase, syncNow, useSyncState } from '../sync'
import { ask, inform } from '../components/Confirm'

const SCALES: { value: CriterionScale; label: string }[] = [
  { value: 'score5', label: 'Note 1 à 5' },
  { value: 'score3', label: 'Note 0 à 3' },
  { value: 'score2', label: 'Note 0 à 2' },
  { value: 'number', label: 'Valeur (unité)' },
  { value: 'text', label: 'Texte' },
]

export default function Settings() {
  const [me, setMe] = useMe()
  const [draft, setDraft] = useState(me)
  const [msg, setMsg] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold">Réglages</h1>

      <section className="card flex flex-col gap-2 p-4">
        <div className="section-title">Mon nom (observateur)</div>
        {supabase ? (
          <p className="text-xs">
            <b>{me}</b> <span className="text-muted">— lié à ton compte, il signe tes avis et tes mesures.</span>
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Prénom Nom" />
              <button className="btn-primary shrink-0" disabled={draft.trim() === me} onClick={() => setMe(draft.trim())}>
                OK
              </button>
            </div>
            <p className="text-[11px] text-muted">Utilisé pour signer tes avis et tes mesures sur cet appareil.</p>
          </>
        )}
      </section>

      <Account />

      <CriteriaEditor />

      <section className="card flex flex-col gap-2 p-4">
        <div className="section-title">Sauvegarde</div>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1 text-xs" onClick={() => void exportBackup()}>
            Exporter (JSON)
          </button>
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
        </div>
        {msg && <p className="text-[11px] text-emerald-300">{msg}</p>}
      </section>

      <section className="card flex flex-col gap-2 p-4">
        <div className="section-title">Données de démonstration</div>
        <p className="text-[11px] text-muted">
          24 joueurs fictifs (U18), 5 observateurs, 4 matchs / tournois et leurs avis, pour tester l'app. Elles restent sur cet appareil et
          s'effacent sans toucher à tes vraies données.
        </p>
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
    </div>
  )
}

function Account() {
  const { state, lastError } = useSyncState()
  const [email, setEmail] = useState('')

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
      <div className="section-title">Compte & synchronisation</div>
      <p className="text-xs">
        Connecté : <b>{email}</b>
      </p>
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
      <div className="section-title">Critères</div>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'subjective', label: 'Subjectifs (plusieurs avis)' },
          { value: 'factual', label: 'Factuels (préparateur)' },
        ]}
      />
      <p className="text-[11px] text-muted">
        {kind === 'subjective'
          ? 'Notés par chaque observateur ; « Rapide » = inclus dans le mode d’évaluation rapide.'
          : 'Une seule valeur par date, saisie par le préparateur physique, avec historique.'}{' '}
        Masquer un critère conserve son historique.
      </p>

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
        <button className="btn-primary flex-1 text-xs" disabled={!dirty || !d.label.trim()} onClick={async () => setD(await save<Criterion>('criteria', d))}>
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
