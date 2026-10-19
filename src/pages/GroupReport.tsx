import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { Segmented, useMe } from '../components/ui'
import { alive, db, poleName, today, type Measurement, type Player } from '../db'
import { accord, setGender, SEX_LABELS, w } from '../gender'
import {
  birthYear,
  cellText,
  COLUMNS,
  cssString,
  currentPoles,
  isMixed,
  matchesSearch,
  missingOf,
  POLE_COLUMNS,
  poleChoices,
  poleKey,
  sectionTitles,
  sortRows,
  splitSections,
  stayOf,
  totalsByYear,
  type ColumnId,
  type Row,
  type SortBy,
  type Stay,
} from '../groupExport'
import { useRegionLabel } from '../lists'
import { can } from '../roles'
import { appName } from '../appBrand'
import { programmeLabel, usePoleMembers, usePoleRef } from '../components/PoleGroup'
import { periodIndexAt, seasonStatus, seasonStatusLabel, viewLabel } from '../poleSeason'
import { poleViewOf, withPoleView } from '../tabQuery'

/*
 * « Exporter en PDF » d'un groupe (/groupes/:id/rapport) : une feuille A4 à imprimer ou enregistrer en PDF
 * (window.print()), par exemple pour le président de la ligue. Colonnes calquées sur la liste de l'outil fédéral,
 * seulement l'identité et des informations administratives : aucune note, aucun avis, aucun commentaire. Rien n'est
 * envoyé : le document est imprimé ou enregistré sur l'appareil.
 * Retenus sur l'appareil : colonnes et ordre (pour tous les groupes) ; objet, destinataire, organisation, parties et
 * visas (pour chaque groupe). Recherche et « données incomplètes » : à l'écran seulement, l'impression garde tout le monde.
 */

// ---------- Réglages retenus ----------

type Cols = Record<ColumnId | 'obs', boolean>
interface DeviceOpts {
  cols: Cols
  sort: SortBy
}
const DEVICE_DEFAULTS: DeviceOpts = {
  cols: { ...(Object.fromEntries(COLUMNS.map((c) => [c.id, c.base])) as Record<ColumnId, boolean>), obs: false },
  sort: { key: 'nom', dir: 'asc' },
}

interface GroupOpts {
  objet: string
  dest: string
  org: string
  /** Séparer « déjà au pôle » / « nouveaux arrivants » (sinon une seule liste). */
  split: boolean
  /** Pôle de référence (poleKey) ou « any » ; vide : le plus probable. */
  pole?: string
  /** Choix à la main, joueur par joueur (séparation activée). */
  overrides: Record<string, Stay>
  visa: boolean
  visa1: string
  visa2: string
}
const GROUP_DEFAULTS: GroupOpts = {
  objet: '',
  dest: '',
  org: '',
  split: false,
  overrides: {},
  visa: false,
  visa1: 'Visa du responsable du pôle',
  visa2: 'Visa du Président de la Ligue',
}

const DEVICE_KEY = 'handbase.exportGroupe.reglages'
const groupKey = (id: string) => `handbase.exportGroupe.${id}`

function readStored<T extends object>(key: string, defaults: T, merge: (stored: Partial<T>) => Partial<T> = (s) => s): T {
  try {
    const o = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<T>
    return { ...defaults, ...merge(o) }
  } catch {
    return { ...defaults }
  }
}

/** Réglages retenus sur l'appareil (stockage indisponible : gardés pendant la visite). */
function useStored<T extends object>(key: string, read: () => T): [T, (patch: Partial<T>) => void] {
  const [v, setV] = useState(read)
  useEffect(() => {
    setV(read())
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<T>) =>
    setV((o) => {
      const n = { ...o, ...patch }
      try {
        localStorage.setItem(key, JSON.stringify(n))
      } catch {
        /* stockage indisponible */
      }
      return n
    })
  return [v, set]
}

const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
const heightOf = (m: Measurement) => (typeof m.value === 'number' ? m.value : Number(String(m.value).replace(',', '.')) || undefined)

// ---------- Page ----------

export function GroupReport() {
  const { id = '' } = useParams()
  const [me] = useMe()
  const regionLabel = useRegionLabel()
  const [dev, setDev] = useStored(DEVICE_KEY, () => readStored(DEVICE_KEY, DEVICE_DEFAULTS, (s) => ({ ...s, cols: { ...DEVICE_DEFAULTS.cols, ...(s.cols ?? {}) } })))
  const [opts, set] = useStored(groupKey(id), () => readStored(groupKey(id), GROUP_DEFAULTS, (s) => ({ ...s, overrides: { ...(s.overrides ?? {}) } })))
  // À l'écran seulement : recherche et fiches incomplètes (l'impression garde tout le groupe).
  const [q, setQ] = useState('')
  const [incomplete, setIncomplete] = useState(false)
  // Groupe Pôle (src/poleSeason.ts) : les membres de la vue de l'adresse (?saison=prochaine), colonnes statut de saison,
  // programme et référence PSQS ; retour au groupe sur la même vue.
  const loc = useLocation()
  const poleView = poleViewOf(loc.search)
  const grp = useLiveQuery(() => db.groups.get(id), [id])
  const ref = usePoleRef(grp?.poleUnitId)
  const pm = usePoleMembers(grp?.poleUnitId ? ref : null, poleView)
  const poleIds = grp?.poleUnitId ? (pm?.shown.map((p) => p.id) ?? []) : undefined
  const poleKeyIds = poleIds?.join(',')
  const data = useLiveQuery(async () => {
    const g = await db.groups.get(id)
    const players = alive((await db.players.bulkGet(poleIds ?? g?.playerIds ?? [])).filter((p): p is Player => !!p))
    // Dernière taille de chaque joueur du groupe (mesurée ou déclarée).
    const ids = new Set(players.map((p) => p.id))
    const last = new Map<string, Measurement>()
    for (const m of await db.measurements.where('criterionId').equals('taille').toArray()) {
      if (m.deleted || !ids.has(m.playerId) || !heightOf(m)) continue
      const cur = last.get(m.playerId)
      if (!cur || m.date > cur.date || (m.date === cur.date && m.updatedAt > cur.updatedAt)) last.set(m.playerId, m)
    }
    const rows: Row[] = players.map((p) => {
      const h = last.has(p.id) ? heightOf(last.get(p.id)!) : undefined
      if (!ref || !pm || !g?.poleUnitId) return { p, height: h }
      const i = periodIndexAt(p, ref, poleView === 'prochaine' ? pm.s.refNext : pm.s.refCurrent)
      return { p, height: h, pole: { status: seasonStatusLabel(seasonStatus(p, ref, pm.s), p.sex), programme: programmeLabel(i >= 0 ? p.poles?.[i]?.programme : undefined), psqs: ref.psqsRef ?? '' } }
    })
    return { g, players, rows }
  }, [id, poleKeyIds, ref, pm, poleView]) // eslint-disable-line react-hooks/exhaustive-deps
  const day = today()

  const g = data?.g
  const players = useMemo(() => data?.players ?? [], [data])
  const choices = useMemo(() => poleChoices(players, day, g?.name, regionLabel), [players, day, g?.name, regionLabel])
  // Pôle de référence : celui choisi (s'il existe encore), sinon le plus probable.
  const target = opts.pole === 'any' ? 'any' : (choices.find((c) => c.key === opts.pole)?.key ?? choices[0]?.key)

  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (!g || g.deleted || !can.seeGroup(g)) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>

  const { rows } = data
  const t = sectionTitles(players, g.sex)
  // Accord au genre (src/gender.ts) : groupe « Filles », ou toutes des filles sans sexe déclaré.
  const gg = setGender(g.sex, players)
  const gw = w(gg)
  const sections = opts.split
    ? (() => {
        const s = splitSections(rows, { today: day, target, overrides: opts.overrides, sort: dev.sort })
        return [
          { key: 'reste', title: t.stay, list: s.stay },
          { key: 'nouveau', title: t.arrivals, list: s.arrivals },
        ]
      })()
    : [{ key: 'tous', title: t.all, list: sortRows(rows, dev.sort, day) }]
  const isPole = !!g.poleUnitId
  const cols = COLUMNS.filter((c) => c.id === 'nom' || c.id === 'prenom' || (POLE_COLUMNS.includes(c.id) ? isPole : dev.cols[c.id]))
  const incompleteCount = rows.filter((r) => missingOf(r, day).length).length
  const filtering = !!q.trim() || incomplete
  const visible = (r: Row) => matchesSearch(r, q) && (!incomplete || missingOf(r, day).length > 0)
  const shownCount = rows.filter(visible).length

  const mixed = isMixed(g.sex, players)
  const totals = totalsByYear(players)
  const stayIds = new Set(opts.split ? sections[0].list.map((r) => r.p.id) : [])
  const yearStay = (y: string) => players.filter((p) => birthYear(p) === y && stayIds.has(p.id)).length
  const targetLabel = target && target !== 'any' ? choices.find((c) => c.key === target)?.label : undefined
  const edited = longDate(day)

  const sortBy = (key: ColumnId) => setDev({ sort: { key, dir: dev.sort.key === key && dev.sort.dir === 'asc' ? 'desc' : 'asc' } })

  // Cellules du document : noir sur blanc, filets fins.
  const th = 'border-b border-neutral-500 px-1 py-1 text-left align-bottom font-bold'
  const td = `border-b border-neutral-300 px-1 align-top ${dev.cols.obs ? 'h-[8mm] py-1.5' : 'py-1'}`
  const tdNum = 'border-b border-neutral-300 px-1 py-1 text-right tabular-nums'

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      {/* Pied de chaque page imprimée : nom du groupe et date à gauche, numéro de page à droite (Chrome, Edge). */}
      <style>{`@page group-report { @bottom-left { content: ${cssString(`${g.name} — édité le ${edited}`)}; } }`}</style>

      <div className="no-print flex flex-col gap-3">
        <BackButton fallback={`/groupes/${g.id}${isPole ? withPoleView('', poleView) : ''}`} label={g.name.toUpperCase()} className="self-start" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <h1 className="min-w-0 flex-1 text-lg font-extrabold">Exporter en PDF</h1>
          <button className="btn-primary min-h-11 px-4 py-2 text-xs" onClick={() => window.print()}>
            Imprimer / Enregistrer en PDF
          </button>
        </div>
        <p className="text-[11px] text-muted">
          Seulement l’identité et des informations administratives : aucune note ni aucun avis. Rien n’est envoyé : le document est imprimé ou enregistré sur
          cet appareil. Pour un PDF, choisis « Enregistrer au format PDF » comme imprimante.
        </p>

        <div className="card flex flex-col gap-3 p-3">
          <Field label="Objet">
            <input className="field" value={opts.objet} placeholder="Objet du document (ex. changement de saison, convocation…)" onChange={(e) => set({ objet: e.target.value })} />
          </Field>
          <Field label="Destinataire">
            <input className="field" value={opts.dest} placeholder="À l’attention de… (facultatif)" onChange={(e) => set({ dest: e.target.value })} />
          </Field>
          <Field label="Organisation">
            <input className="field" value={opts.org} placeholder="Ex. Ligue de handball… (facultatif)" onChange={(e) => set({ org: e.target.value })} />
          </Field>
          <p className="-mt-1 text-[11px] text-muted">Champ laissé vide : sa ligne n’apparaît pas sur le document.</p>

          <div>
            <div className="mb-1 text-[11px] font-bold text-muted">Colonnes (Nom et Prénom toujours présents)</div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {COLUMNS.filter((c) => c.id !== 'nom' && c.id !== 'prenom' && !POLE_COLUMNS.includes(c.id)).map((c) => (
                <Check key={c.id} checked={dev.cols[c.id]} onChange={(v) => setDev({ cols: { ...dev.cols, [c.id]: v } })}>
                  {c.label}
                </Check>
              ))}
              <Check checked={dev.cols.obs} onChange={(v) => setDev({ cols: { ...dev.cols, obs: v } })}>
                Observations (vide, à remplir à la main)
              </Check>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Ordre : touche le titre d’une colonne du tableau ci-dessous (une deuxième fois pour l’inverser).
              {isPole && ' Groupe Pôle : « Statut de saison », « Programme » et « Référence PSQS » sont toujours imprimés.'}
            </p>
          </div>

          <Check checked={opts.split} onChange={(v) => set({ split: v })}>
            Séparer : {gw.joueurs} déjà au pôle / {accord('nouveau arrivant', gg, 2)}
          </Check>
          {opts.split && <SplitSettings g={gg} players={players} day={day} choices={choices} target={target} opts={opts} set={set} region={regionLabel} />}

          <Check checked={opts.visa} onChange={(v) => set({ visa: v })}>
            Ajouter un cadre de visas
          </Check>
          {opts.visa && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="field" value={opts.visa1} aria-label="Premier visa" onChange={(e) => set({ visa1: e.target.value })} />
              <input className="field" value={opts.visa2} aria-label="Second visa" onChange={(e) => set({ visa2: e.target.value })} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-bold text-muted">Aperçu</div>
          <input className="field" type="search" value={q} placeholder={`${gw.Joueur} (nom, licence, club)`} aria-label={gw.Joueur} onChange={(e) => setQ(e.target.value)} />
          <Check checked={incomplete} onChange={setIncomplete}>
            {gw.Joueurs} avec des données incomplètes uniquement ({incompleteCount})
          </Check>
          {filtering && (
            <p className="text-[11px] text-muted">
              {shownCount} sur {players.length} à l’écran ; le document imprimé garde tout le groupe.
            </p>
          )}
          {incompleteCount > 0 && (
            <p className="text-[11px] text-muted">Données manquantes surlignées (licence, date de naissance, taille, latéralité, poste, club) ; « — » à l’impression.</p>
          )}
        </div>
      </div>

      <article className="group-report rounded-lg bg-white p-3 text-[11px] leading-snug text-neutral-900 shadow sm:p-6 print:rounded-none print:p-0 print:shadow-none">
        <div className="mb-4 border-b-2 border-neutral-900 pb-2">
          {opts.org.trim() && <div className="text-[12px] font-extrabold uppercase tracking-wide">{opts.org.trim()}</div>}
          <h2 className="mt-1 text-lg font-extrabold leading-tight">{g.name}</h2>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {opts.objet.trim() && <Line label="Objet">{opts.objet.trim()}</Line>}
            {opts.dest.trim() && <Line label="À l’attention de">{opts.dest.trim()}</Line>}
            {opts.split && targetLabel && <Line label="Pôle">{targetLabel}</Line>}
            {isPole && pm && <Line label="Vue">{viewLabel(poleView, pm.s)}</Line>}
            {isPole && ref?.psqsRef && <Line label="Référence PSQS">{ref.psqsRef}</Line>}
            <Line label="Effectif">
              {plural(players.length, t.one, t.many)}
              {opts.split && ` (${sections[0].list.length} déjà au pôle, ${plural(sections[1].list.length, gg === 'F' ? 'nouvelle arrivante' : 'nouvel arrivant', accord('nouveau arrivant', gg, 2))})`}
            </Line>
            <Line label="Édité le">
              {edited}
              {me.trim() && ` par ${me.trim()}`}
            </Line>
          </dl>
        </div>

        {sections.map((s) => (
          <section key={s.key} className="mb-4">
            {(opts.split || s.list.length === 0) && (
              <h3 className="mb-1 text-[12px] font-extrabold">
                {s.title} ({s.list.length})
              </h3>
            )}
            {s.list.length ? (
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={`${th} w-[1%] text-right`}>N°</th>
                      {cols.map((c) => (
                        <th
                          key={c.id}
                          className={th}
                          aria-sort={dev.sort.key === c.id ? (dev.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        >
                          {/* À l'écran : titre cliquable pour trier ; imprimé : texte seul (un bouton disparaît des en-têtes répétés). */}
                          <button type="button" className="text-left font-bold hover:underline print:hidden" onClick={() => sortBy(c.id)}>
                            {c.label}
                            <span className={`ml-0.5 ${dev.sort.key === c.id ? '' : 'text-neutral-300'}`}>
                              {dev.sort.key === c.id ? (dev.sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                            </span>
                          </button>
                          <span className="hidden print:inline">{c.label}</span>
                        </th>
                      ))}
                      {dev.cols.obs && <th className={`${th} min-w-[30mm]`}>Observations</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {s.list.map((r, i) => {
                      const miss = new Set<ColumnId>(missingOf(r, day))
                      return (
                        <tr key={r.p.id} className={visible(r) ? '' : 'hidden print:table-row'}>
                          <td className={`${td} text-right tabular-nums`}>{i + 1}</td>
                          {cols.map((c) => {
                            const v = cellText(r, c.id, day)
                            const gap = miss.has(c.id)
                            return (
                              <td
                                key={c.id}
                                className={`${td} ${c.id === 'nom' ? 'font-bold' : ''} ${c.id === 'naissance' || c.id === 'licence' || c.id === 'taille' ? 'whitespace-nowrap tabular-nums' : c.id === 'nom' || c.id === 'prenom' ? 'whitespace-nowrap' : ''} ${gap ? 'bg-amber-100 text-amber-800 print:bg-transparent print:text-inherit' : ''}`}
                                title={gap ? 'Donnée manquante' : undefined}
                              >
                                {v || (gap ? '—' : '')}
                              </td>
                            )
                          })}
                          {dev.cols.obs && <td className={td} />}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filtering && !s.list.some(visible) && <p className="no-print py-2 text-neutral-500">{gw.AucunJoueur} de cette partie ne correspond.</p>}
              </div>
            ) : (
              <p className="text-neutral-600">Aucun {t.one} dans cette partie.</p>
            )}
          </section>
        ))}

        {players.length > 0 && (
          <section className="mb-4 break-inside-avoid">
            <h3 className="mb-1 text-[12px] font-extrabold">Récapitulatif par année de naissance</h3>
            <table className="w-full max-w-md border-collapse">
              <thead>
                <tr>
                  <th className={th}>Année</th>
                  {opts.split && <th className={`${th} text-right`}>Déjà au pôle</th>}
                  {opts.split && <th className={`${th} text-right`}>Nouveaux</th>}
                  {mixed && <th className={`${th} text-right`}>{SEX_LABELS.M}</th>}
                  {mixed && <th className={`${th} text-right`}>{SEX_LABELS.F}</th>}
                  {mixed && totals.total.other > 0 && <th className={`${th} text-right`}>Non renseigné</th>}
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {[...totals.rows, totals.total].map((r) => {
                  const total = r === totals.total
                  const st = total ? stayIds.size : yearStay(r.year)
                  return (
                    <tr key={r.year || 'inconnue'} className={total ? 'font-bold' : ''}>
                      <td className="border-b border-neutral-300 px-1 py-1">{total ? 'Total' : r.year || 'Non renseignée'}</td>
                      {opts.split && <td className={tdNum}>{st}</td>}
                      {opts.split && <td className={tdNum}>{r.total - st}</td>}
                      {mixed && <td className={tdNum}>{r.M}</td>}
                      {mixed && <td className={tdNum}>{r.F}</td>}
                      {mixed && totals.total.other > 0 && <td className={tdNum}>{r.other}</td>}
                      <td className={tdNum}>{r.total}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}

        {opts.visa && (
          <section className="mb-4 mt-6 grid grid-cols-2 gap-4 break-inside-avoid">
            {[opts.visa1, opts.visa2].map((v, i) => (
              <div key={i} className="flex min-h-[38mm] flex-col border border-neutral-500 p-2">
                <div className="font-bold">{v.trim() || 'Visa'}</div>
                <div className="mt-3 text-neutral-600">Nom :</div>
                <div className="mt-2 text-neutral-600">Date :</div>
                <div className="mt-2 text-neutral-600">Signature :</div>
              </div>
            ))}
          </section>
        )}

        <p className="mt-4 border-t border-neutral-300 pt-1 text-[9px] text-neutral-600">Document édité avec {appName()} — {edited}</p>
      </article>
    </div>
  )
}

/** Pôle de référence et choix « Déjà au pôle » / « Nouveau » joueur par joueur (à l'écran seulement). */
function SplitSettings({
  g,
  players,
  day,
  choices,
  target,
  opts,
  set,
  region,
}: {
  /** Genre du groupe (src/gender.ts). */
  g: ReturnType<typeof setGender>
  players: Player[]
  day: string
  choices: ReturnType<typeof poleChoices>
  target: string | undefined
  opts: GroupOpts
  set: (patch: Partial<GroupOpts>) => void
  region: (id: string) => string | undefined
}) {
  const manual = Object.keys(opts.overrides).filter((pid) => players.some((p) => p.id === pid)).length
  const why = (p: Player) => {
    const cur = currentPoles(p, day)
    if (!cur.length) return `pas ${w(p.sex).inscrit} dans un pôle en cours`
    const same = cur.find((x) => target === 'any' || poleKey(x) === target)
    const x = same ?? cur[0]
    const since = x.from ? `, depuis le ${x.from.split('-').reverse().join('/')}` : ''
    return `${same ? '' : 'autre pôle : '}${poleName(x, region)}${since}`
  }
  const ordered = sortRows(
    players.map((p) => ({ p })),
    { key: 'nom', dir: 'asc' },
    day,
  )
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-2">
      {choices.length ? (
        <label className="flex flex-col gap-1 text-[11px] font-bold text-muted">
          Pôle de référence
          <select className="field" value={target ?? ''} onChange={(e) => set({ pole: e.target.value })}>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.count})
              </option>
            ))}
            <option value="any">N’importe quel pôle en cours</option>
          </select>
        </label>
      ) : (
        <p className="text-[11px] text-muted">{w(g).AucunJoueur} du groupe n’a de période en cours dans un Pôle Espoirs (fiche {w(g).joueur}) : choisis ci-dessous.</p>
      )}
      <p className="text-[11px] text-muted">
        « Déjà au pôle » : période en cours dans ce pôle sur la fiche {w(g).duJoueur} (entrée passée, pas de sortie ou sortie à venir). Les autres sont « {w(g).nouveaux} ». Tu
        peux changer chaque {w(g).joueur} à la main.
      </p>
      <details>
        <summary className="cursor-pointer text-xs font-bold">
          Répartition {w(g).joueur} par {w(g).joueur}{manual ? ` (${manual} ${accord('choisi', g, manual)} à la main)` : ''}
        </summary>
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {ordered.map(({ p }) => {
            const auto = stayOf(p, day, target)
            const v = stayOf(p, day, target, opts.overrides)
            return (
              <li key={p.id} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold">
                    {(p.lastName ?? '').toUpperCase()} {p.firstName}
                  </div>
                  <div className="text-[10px] text-muted">
                    {why(p)}
                    {opts.overrides[p.id] && ` · ${w(p.sex).choisi} à la main`}
                  </div>
                </div>
                <div className="shrink-0 sm:w-52">
                  <Segmented
                    value={v}
                    onChange={(nv) => {
                      const o = { ...opts.overrides }
                      if (nv === auto) delete o[p.id]
                      else o[p.id] = nv
                      set({ overrides: o })
                    }}
                    options={[
                      { value: 'reste', label: 'Déjà au pôle' },
                      { value: 'nouveau', label: w(p.sex).Nouveau },
                    ]}
                  />
                </div>
              </li>
            )
          })}
        </ul>
        {manual > 0 && (
          <button className="mt-1 text-xs text-muted underline hover:text-fg" onClick={() => set({ overrides: {} })}>
            Revenir à la répartition automatique
          </button>
        )}
      </details>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-bold text-muted">
      {label}
      {children}
    </label>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs">
      <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-bold">{label} :</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}
