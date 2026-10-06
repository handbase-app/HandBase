import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CourtPicker } from '../components/CourtPicker'
import { department } from '../components/PlayerFilter'
import { departmentChoices } from '../lists'
import { ProposePlayer } from '../components/ProposePlayer'
import { Collapsible, CriterionInput, getMe, groupBy, NumberField, resizeImage, Segmented } from '../components/ui'
import { alive, criterionApplies, db, newId, positionLabel, save, today, type HeightSource, type Measurement, type Player } from '../db'
import { latestByPlayer } from './Players'
import { can, useRole } from '../roles'

type Values = Record<string, number | string | undefined>

export default function PlayerForm() {
  const { id } = useParams()
  const editing = !!id
  const nav = useNavigate()
  const role = useRole()
  // Ouvert depuis la notation : on y revient après l'enregistrement (adresse interne à l'appli uniquement).
  const [params] = useSearchParams()
  const retour = params.get('retour')
  const back = retour && retour.startsWith('/') && !retour.startsWith('//') ? retour : null
  const criteria = useLiveQuery(() => db.criteria.orderBy('order').toArray().then((cs) => alive(cs).filter((c) => c.active && c.kind === 'factual')))
  const [p, setP] = useState<Partial<Player>>({})
  const [values, setValues] = useState<Values>({})
  const [initial, setInitial] = useState<Values>({})
  const [testDate, setTestDate] = useState(today())
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(!editing)

  useEffect(() => {
    if (!id) return
    void (async () => {
      const player = await db.players.get(id)
      if (!player) return nav('/joueurs')
      const ms = await db.measurements.where('playerId').equals(id).toArray()
      const latest = latestByPlayer(ms).get(id)
      const v: Values = {}
      latest?.forEach((m, cid) => (v[cid] = m.value))
      setP(player)
      setValues(v)
      setInitial(v)
      setLoaded(true)
    })()
  }, [id, nav])

  const set = <K extends keyof Player>(k: K, v: Player[K]) => setP((x) => ({ ...x, [k]: v }))

  async function submit() {
    if (!p.firstName?.trim() || !p.lastName?.trim()) {
      setError('Le prénom et le nom sont obligatoires.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const player = await save<Player>('players', {
      ...p,
      motherHeightSource: p.motherHeight !== undefined ? (p.motherHeightSource ?? 'declaree') : undefined,
      fatherHeightSource: p.fatherHeight !== undefined ? (p.fatherHeightSource ?? 'declaree') : undefined,
      id: p.id ?? newId(),
      firstName: p.firstName.trim(),
      lastName: p.lastName.trim(),
    } as Player)
    const author = getMe() || undefined
    for (const [cid, v] of Object.entries(values)) {
      if (v === undefined || v === '' || v === initial[cid]) continue
      await save<Measurement>('measurements', { id: newId(), playerId: player.id, criterionId: cid, value: v, date: testDate, author })
    }
    nav(back ?? `/joueurs/${player.id}`, { replace: true })
  }

  if (!loaded || !criteria) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  // Observateur : il propose une fiche minimale, et ne modifie que la sienne tant qu'elle n'est pas traitée.
  if (!can.editPlayers(role)) {
    if (editing && !can.editPlayer(role, p))
      return <div className="py-20 text-center text-sm text-muted">Ton rôle (observateur) ne permet pas de modifier cette fiche.</div>
    return (
      <div className="flex flex-col gap-4">
        <button onClick={() => nav(-1)} className="self-start text-xs font-bold text-muted">
          ← {editing ? 'MODIFIER MA PROPOSITION' : 'PROPOSER UN JOUEUR'}
        </button>
        <ProposePlayer initial={editing ? p : undefined} onDone={(pl) => (pl ? nav(`/joueurs/${pl.id}`, { replace: true }) : nav(-1))} />
      </div>
    )
  }

  // Profil rapide seulement (gabarit + critères physiologiques) : de quoi repérer un joueur vite.
  // Les tests détaillés se saisissent ensuite, fiche enregistrée, avec « Nouvelle séance de tests ».
  const shown = criteria.filter((c) => criterionApplies(c, p.position) && (c.category === 'Gabarit' || c.category === 'Critères physiologiques'))
  const testsFilled = shown.filter((c) => values[c.id] !== undefined && values[c.id] !== '' && values[c.id] !== initial[c.id]).length

  return (
    <div className="flex flex-col gap-3 pb-16">
      <div className="flex items-center justify-between">
        <button onClick={() => nav(-1)} className="text-xs font-bold text-muted">
          ← {editing ? 'MODIFIER LA FICHE' : 'NOUVEAU JOUEUR'}
        </button>
      </div>

      {error && <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>}

      {/* Identité : toujours visible (prénom et nom obligatoires). */}
      <div className="card flex flex-col gap-3 p-4">
        <div className="flex items-start gap-4">
        {/* Photo */}
        <label className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-line text-muted hover:border-accent">
          {p.photo ? (
            <img src={p.photo} alt="" className="h-full w-full object-cover" />
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              <span className="mt-1 text-[10px]">Photo joueur</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) set('photo', await resizeImage(f))
            }}
          />
        </label>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <span className="label">Nom *</span>
              <input className="field" value={p.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} />
            </div>
            <div>
              <span className="label">Prénom *</span>
              <input className="field" value={p.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} />
            </div>
          </div>
          <div>
            <span className="label">Date de naissance</span>
            <input type="date" className="field" value={p.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value || undefined)} />
          </div>

          <div>
            <span className="label">Sexe</span>
            <Segmented
              value={p.sex}
              onChange={(v) => set('sex', v)}
              options={[
                { value: 'M', label: 'Garçon' },
                { value: 'F', label: 'Fille' },
              ]}
            />
          </div>
          </div>
        </div>
      </div>

      <Collapsible title="Profil sportif" summary={[positionLabel(p.position) !== '—' && positionLabel(p.position), p.laterality].filter(Boolean).join(' · ') || 'Poste, latéralité'} defaultOpen={!editing || params.get('ouvrir') === 'poste'}>
        <div>
          <span className="label">Poste</span>
          <CourtPicker
            value={p.position}
            secondary={p.secondaryPositions}
            onChange={(pos, sec) => setP((x) => ({ ...x, position: pos, secondaryPositions: sec.length ? sec : undefined }))}
          />
        </div>
        <div>
          <span className="label">Latéralité</span>
          <Segmented
            value={p.laterality}
            onChange={(v) => set('laterality', v)}
            options={[
              { value: 'droitier', label: 'Droitier' },
              { value: 'gaucher', label: 'Gaucher' },
              { value: 'ambidextre', label: 'Ambidextre' },
            ]}
          />
        </div>
      </Collapsible>

      <Collapsible title="Club et licence" summary={[p.club, p.license, p.team].filter(Boolean).join(' · ') || 'Club, licence, équipe, département, nationalité, internat'}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="label">Équipe</span>
            <input className="field" placeholder="Senior A" value={p.team ?? ''} onChange={(e) => set('team', e.target.value)} />
          </div>
          <div>
            <span className="label">Licence</span>
            <input className="field" value={p.license ?? ''} onChange={(e) => set('license', e.target.value)} />
          </div>
          <div>
            <span className="label">Catégorie / niveau</span>
            <input className="field" placeholder="-18 nat" value={p.category ?? ''} onChange={(e) => set('category', e.target.value)} />
          </div>
          <div>
            <span className="label">Club</span>
            <input className="field" value={p.club ?? ''} onChange={(e) => set('club', e.target.value)} />
          </div>
          <div>
            <span className="label">Département</span>
            {/* Lu dans le n° de club ou de licence s'il y en a un ; sinon à choisir. */}
            <select
              className="field"
              value={p.department ?? ''}
              disabled={!!department({ clubCode: p.clubCode, license: p.license })}
              onChange={(e) => set('department', e.target.value || undefined)}
            >
              <option value="">{department({ clubCode: p.clubCode, license: p.license }) ?? '—'}</option>
              {departmentChoices().map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
              {p.department && !departmentChoices().some((d) => d.value === p.department) && <option value={p.department}>{p.department}</option>}
            </select>
          </div>
          <div>
            <span className="label">Nationalité</span>
            <input className="field" placeholder="France" value={p.nationality ?? ''} onChange={(e) => set('nationality', e.target.value || undefined)} />
          </div>
        </div>
        <div>
          <span className="label">Internat</span>
          <Segmented
            value={p.boarding === true ? 'oui' : p.boarding === false ? 'non' : undefined}
            onChange={(v) => set('boarding', v === 'oui')}
            options={[
              { value: 'oui', label: 'Oui' },
              { value: 'non', label: 'Non' },
            ]}
          />
        </div>
      </Collapsible>

      <Collapsible
        title="Profil physique"
        summary="Taille, poids, explosivité, puissance, vitesse, détente, tir"
        count={testsFilled ? `${testsFilled} saisi${testsFilled > 1 ? 's' : ''}` : undefined}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted">
            De quoi sortir un profil rapidement ; laisser vide ce qui n’est pas connu. Les tests détaillés (sprint, sauts, force…) se saisissent
            ensuite depuis la fiche : onglet Tests, « Nouvelle séance de tests ».
          </div>
          <div className="w-36 shrink-0">
            <span className="label">Date des tests</span>
            <input type="date" className="field" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
          </div>
        </div>
        {groupBy(shown, (c) => c.category).map(([cat, cs]) => (
          <div key={cat} className="rounded-lg border border-line p-3">
            <div className="section-title">{cat}</div>
            <div className={`grid gap-3 ${cs.every((c) => c.scale === 'number') ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {cs.map((c) => (
                <div key={c.id} className={c.scale === 'number' ? '' : 'flex items-center justify-between gap-3'}>
                  <span className={c.scale === 'number' ? 'label' : 'text-xs font-bold'} title={c.description}>
                    {c.label}
                  </span>
                  <CriterionInput c={c} value={values[c.id]} onChange={(v) => setValues((x) => ({ ...x, [c.id]: v }))} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {editing && <div className="text-[11px] text-muted">Seules les valeurs modifiées sont ajoutées à l'historique, à la date des tests.</div>}
      </Collapsible>

      <Collapsible title="Taille des parents" summary={[p.motherHeight && `mère ${p.motherHeight} cm`, p.fatherHeight && `père ${p.fatherHeight} cm`].filter(Boolean).join(' · ') || 'Facultatif : pour la taille adulte prédite'}>
        <div className="text-[11px] text-muted">Parents biologiques. Sert à estimer la taille adulte ; une taille déclarée est corrigée (souvent surestimée).</div>
        {(
          [
            ['motherHeight', 'motherHeightSource', 'Mère'],
            ['fatherHeight', 'fatherHeightSource', 'Père'],
          ] as const
        ).map(([hk, sk, label]) => (
          <div key={hk} className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div>
              <span className="label">{label}</span>
              <NumberField value={p[hk]} unit="cm" onChange={(v) => set(hk, v)} />
            </div>
            <div className="w-44">
              <Segmented<HeightSource>
                value={p[sk] ?? (p[hk] !== undefined ? 'declaree' : undefined)}
                onChange={(v) => set(sk, v)}
                options={[
                  { value: 'mesuree', label: 'Mesurée' },
                  { value: 'declaree', label: 'Déclarée' },
                ]}
              />
            </div>
          </div>
        ))}
      </Collapsible>

      <Collapsible title="Notes" summary={[p.gaps && 'lacunes', p.notes && 'notes'].filter(Boolean).join(' · ') || 'Lacunes mobilité, observations'}>
        <div>
          <span className="label">Lacunes mobilité / souplesse</span>
          <textarea className="field min-h-16" placeholder="Chaîne P. G ++ / RE…" value={p.gaps ?? ''} onChange={(e) => set('gaps', e.target.value)} />
        </div>
        <div>
          <span className="label">Notes</span>
          <textarea className="field min-h-20" placeholder="Observations…" value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </Collapsible>

      {/* Enregistrer : toujours visible, collé au-dessus de la barre du bas. */}
      <div className="sticky bottom-[calc(52px+env(safe-area-inset-bottom))] z-10 -mx-4 flex items-center gap-3 border-t border-line bg-bg px-4 py-2">
        <button className="btn-primary flex-1" onClick={() => void submit()}>
          Enregistrer
        </button>
        <button className="btn text-muted" onClick={() => nav(-1)}>
          Annuler
        </button>
      </div>
    </div>
  )
}
