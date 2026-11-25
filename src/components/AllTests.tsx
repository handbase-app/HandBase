import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { appName, appSlug } from '../appBrand'
import { useBackCloses } from '../backNav'
import { csvRows, families, fileSlug, fmtNum, frDate, gainKind, gainText, sparkXY, summaryText, testLines, toCsv, topProgress, type TestLine } from '../allTests'
import { criterionApplies, fmtDate, remove, save, today, type Criterion, type Measurement, type Player } from '../db'
import { smoothPath } from '../radarZones'
import { repereDirection, type ReperesConfig } from '../reperes'
import { installationAppearance, themeColor } from '../theme'
import { ask } from './Confirm'
import { FormActions, FormWindow } from './FormWindow'
import { ItemMenu, type MenuAnchor } from './ItemMenu'
import { MeasureMedal } from './Medal'
import { CriterionInput, fmtValue, Icon, playerName } from './ui'
import { FamIcon, famStyle } from './FamIcon'

/*
 * « Tous les tests » d'un joueur, la même vue pour le staff (fiche, onglet Tests) et pour le jeune (« Mes tests » de sa page
 * /moi, aperçu « Voir sa page » compris). Calculs : src/allTests.ts.
 *  - En haut : « N tests passés · dernier le … » et « Exporter » (menu accroché au bouton : PDF à imprimer, tableur CSV) ;
 *  - « Ses plus beaux progrès » (« Mes … » pour le jeune) : les 3 tests au plus grand progrès relatif, s'il y en a ;
 *  - un bloc par famille (picto et couleur de la famille, nombre de tests), rangés en 2 colonnes sans trou quand il y a la
 *    place (CSS columns), 1 sur téléphone ; une ligne par test passé, colonnes alignées dans le bloc : nom, « date · N
 *    mesures », petite courbe lissée (grise, dernier point dans la couleur de la famille), coupe du record devant la dernière
 *    valeur, gain depuis la première mesure en pastille (verte ↗ dans le bon sens, grise si le sens est inconnu) ; jamais un
 *    recul, jamais les autres joueurs ;
 *  - un toucher ouvre le test : courbe, « dernière / record / depuis le début », mesures datées ; « ‹ » (ou Retour) revient
 *    à la liste, sur la ligne ouverte. Staff qui peut saisir : modifier ou supprimer une mesure ; commentaires et auteurs des
 *    mesures pour le staff seulement (jamais au jeune ni dans ses exports).
 * Lien ?voir=mesure:<critère>[:<mesure>] (« Mes suivis ») : ce test s'ouvre, la ligne de la mesure marquée.
 */

const MAX_SPARK = 12

export function AllTests({
  player,
  criteria,
  measurements,
  reperes,
  mine = false,
  editable = false,
  staff = false,
  title,
  focus,
  familyExtra,
  empty,
}: {
  player: Player
  criteria: Criterion[]
  /** Mesures de ce joueur (les autres sont ignorées). */
  measurements: Measurement[]
  reperes: ReperesConfig
  /** Page du jeune : « Mes tests », « Mes plus beaux progrès ». */
  mine?: boolean
  /** Staff qui peut saisir des mesures : modifier, supprimer. */
  editable?: boolean
  /** Vue du staff : commentaires et auteurs des mesures, tests pas encore passés. */
  staff?: boolean
  title?: string
  focus?: { id: string; row?: string; n: number }
  /** Ajout au bas d'une carte de famille (ratio Shirado / Sorensen de la fiche). */
  familyExtra?: (family: string, lines: TestLine[]) => ReactNode
  /** Aucun test passé. */
  empty?: ReactNode
}) {
  const dirOf = useMemo(() => {
    const rc = new Map(reperes.criteria.map((x) => [x.criterionId, x]))
    return (c: Criterion) => repereDirection(rc.get(c.id), c)
  }, [reperes])
  const lines = useMemo(() => testLines(criteria, measurements, dirOf, player.id), [criteria, measurements, dirOf, player.id])
  const fams = useMemo(() => families(lines), [lines])
  const top = useMemo(() => topProgress(lines), [lines])
  const [openId, setOpenId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const [printing, setPrinting] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // Test ouvert par un lien (?voir=mesure:…).
  useEffect(() => {
    if (focus && lines.some((l) => l.c.id === focus.id)) setOpenId(focus.id)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = lines.find((l) => l.c.id === openId)
  // Retour du téléphone : revient à la liste (on reste sur la fiche, ou sur sa page).
  useBackCloses(() => close(), !!open)
  const lastOpened = useRef<string | null>(null)
  const show = (id: string) => {
    lastOpened.current = id
    setOpenId(id)
    requestAnimationFrame(() => toTop(box.current))
  }
  function close() {
    setOpenId(null)
    // Retour sur la ligne du test ouvert (même endroit de la liste).
    requestAnimationFrame(() => box.current?.querySelector(`[data-test-line="${CSS.escape(lastOpened.current ?? '')}"]`)?.scrollIntoView({ block: 'center' }))
  }

  const summary = summaryText(lines)
  const notYet = staff
    ? criteria.filter((c) => c.kind === 'factual' && !c.deleted && c.active !== false && criterionApplies(c, player.position) && !lines.some((l) => l.c.id === c.id))
    : []

  function downloadCsv() {
    const blob = new Blob([toCsv(csvRows(lines))], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${appSlug()}-${mine ? 'mes-tests' : `tests-${fileSlug(`${player.firstName} ${player.lastName}`)}`}-${today()}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div ref={box} className="@container flex flex-col gap-3" data-testid="tous-les-tests">
      {open ? (
        <TestDetail line={open} player={player} reperes={reperes} editable={editable} staff={staff} focus={focus?.id === open.c.id ? focus : undefined} onBack={close} />
      ) : (
        <>
          {(title || lines.length > 0) && (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {title && <div className="section-title mb-0.5">{title}</div>}
                {summary && <div className="text-xs text-muted">{summary}</div>}
              </div>
              {lines.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost min-h-9 shrink-0 px-3.5 py-1.5 text-xs"
                  aria-haspopup="menu"
                  aria-expanded={!!menu}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({ x: r.right, y: r.bottom, top: r.top, alignRight: true })
                  }}
                >
                  <Icon name="download" className="h-3.5 w-3.5" /> Exporter
                </button>
              )}
            </div>
          )}

          {!lines.length && (empty ?? <p className="text-xs text-muted">Aucun test pour l’instant.</p>)}

          {top.length > 0 && (
            <section>
              <div className="mb-1.5 text-[11px] font-extrabold tracking-wider text-muted uppercase">{mine ? 'Mes plus beaux progrès' : 'Ses plus beaux progrès'}</div>
              <div className="grid gap-2 @xl:grid-cols-3">
                {top.map((l) => (
                  <button key={l.c.id} type="button" onClick={() => show(l.c.id)} className="card flex min-w-0 items-center gap-2.5 px-3 py-2.5 text-left transition hover:border-muted" style={famStyle(l.family)}>
                    <FamIcon family={l.family} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-muted" title={l.c.label}>
                        {l.c.label}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[17px] leading-tight font-extrabold whitespace-nowrap tabular-nums">{fmtValue(l.c, l.last.value)}</span>
                        <GainPill line={l} />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {fams.length > 0 && (
            <section>
              {top.length > 0 && <div className="mb-1.5 text-[11px] font-extrabold tracking-wider text-muted uppercase">{mine ? 'Tous mes tests' : 'Tous ses tests'}</div>}
              {/* Blocs empilés en colonnes (pas de trou à côté d’un petit bloc) : 2 à partir de 768 px de large (noms lisibles en entier), 1 en dessous (téléphone, page du jeune). */}
              <div className="-mb-3 @3xl:columns-2 @3xl:gap-x-3">
                {fams.map(([f, ls]) => (
                  <section key={f} aria-label={f} className="card mb-3 break-inside-avoid overflow-hidden" style={famStyle(f)}>
                    <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
                      <FamIcon family={f} size={28} />
                      <h3 className="min-w-0 flex-1 truncate text-[13.5px] leading-tight font-extrabold">{f}</h3>
                      <span className="shrink-0 text-[11.5px] font-bold text-muted tabular-nums">{ls.length}</span>
                    </div>
                    {/* Une grille pour tout le bloc (lignes en sous-grille) : nom, courbe et valeur aux mêmes places. */}
                    <div className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(5.75rem,auto)] gap-x-2.5">
                      {ls.map((l) => (
                        <TestRow key={l.c.id} line={l} player={player} reperes={reperes} onOpen={() => show(l.c.id)} />
                      ))}
                    </div>
                    {familyExtra?.(f, ls)}
                  </section>
                ))}
              </div>
            </section>
          )}

          {notYet.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer px-1 font-bold">Tests pas encore passés ({notYet.length})</summary>
              <p className="mt-1 px-1 leading-relaxed">{notYet.map((c) => c.label).join(' · ')}</p>
            </details>
          )}
        </>
      )}

      {menu && (
        <ItemMenu
          anchor={menu}
          title="Exporter"
          subtitle={mine ? 'mes tests' : playerName(player)}
          onClose={() => setMenu(null)}
          items={[
            { label: mine ? 'Mes tests en PDF' : 'Ses tests en PDF', icon: 'printer', hint: 'une page à garder ou imprimer', onSelect: () => setPrinting(true) },
            { label: 'Tableur (CSV)', icon: 'download', hint: 'une ligne par mesure', onSelect: downloadCsv },
          ]}
        />
      )}
      {printing && <TestsReport player={player} lines={lines} mine={mine} reperes={reperes} onClose={() => setPrinting(false)} />}
    </div>
  )
}

/**
 * Haut de la vue sous ce qui reste collé en haut (onglets de la fiche, sinon l'en-tête de l'appli), dans le panneau de droite
 * (ordinateur) ou la page ; seulement si le haut est caché.
 */
function toTop(el: HTMLElement | null) {
  if (!el) return
  const stuck = document.querySelector<HTMLElement>('[data-fiche-onglets]') ?? document.querySelector<HTMLElement>('header')
  const margin = (stuck ? Math.max(0, stuck.getBoundingClientRect().bottom) : 60) + 12
  const box = el.closest<HTMLElement>('.md-panel')
  const top = el.getBoundingClientRect().top
  const above = box ? top - box.getBoundingClientRect().top - (stuck && box.contains(stuck) ? stuck.offsetHeight + 12 : 12) : top - margin
  if (above >= 0) return
  if (box) box.scrollTo({ top: box.scrollTop + above })
  else window.scrollTo({ top: window.scrollY + above })
}

/** Gain depuis la première mesure : pastille verte « +0,38 m ↗ » (bon sens), grise sans flèche (sens inconnu) ; rien sinon. */
function GainPill({ line }: { line: TestLine }) {
  const g = gainText(line)
  if (!g) return null
  const up = gainKind(line) === 'up'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[11px] font-extrabold whitespace-nowrap tabular-nums ${up ? 'bg-gain/15 text-gain' : 'bg-panel-2 text-muted'}`}>
      {g}
      {up && ' ↗'}
    </span>
  )
}

/** Coupe du record (la dernière mesure est sa meilleure). */
function Trophy({ size = 'h-3.5 w-3.5' }: { size?: string }) {
  return (
    <span role="img" aria-label="Record" title="Record" className="inline-flex shrink-0 text-amber-300">
      <Icon name="trophy" strokeWidth={2.2} className={size} />
    </span>
  )
}

const SPARK_W = 64
const SPARK_H = 24

/** Petite courbe lissée d'un test (ses dernières mesures) : trait gris, dernier point dans la couleur de la famille (--fam). */
function Spark({ line }: { line: TestLine }) {
  const pts = sparkXY(line.points.slice(-MAX_SPARK).map((p) => p.value), SPARK_W, SPARK_H, 3)
  if (!pts.length) return <span aria-hidden />
  const [x, y] = pts[pts.length - 1]
  return (
    <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden className="block overflow-visible">
      <path d={smoothPath(pts, false, 0.5)} fill="none" style={{ stroke: 'color-mix(in srgb, var(--color-muted) 60%, transparent)' }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x} cy={y} r="3" style={{ fill: 'var(--fam)' }} />
    </svg>
  )
}

/** Courbe de « Ses tests en PDF » (noire, lissée). */
function PrintSpark({ line }: { line: TestLine }) {
  const pts = sparkXY(line.points.slice(-MAX_SPARK).map((p) => p.value), 64, 16, 2)
  if (!pts.length) return null
  return (
    <svg width={64} height={16} viewBox="0 0 64 16" aria-hidden className="shrink-0 overflow-visible">
      <path d={smoothPath(pts, false, 0.5)} fill="none" stroke="#111111" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function plural(n: number, word: string) {
  return `${n} ${word}${n > 1 ? 's' : ''}`
}

/** Une ligne d'un bloc (sous-grille du bloc) : nom et « date · N mesures » | courbe | coupe, valeur, médaille, gain. */
function TestRow({ line: l, player, reperes, onOpen }: { line: TestLine; player: Player; reperes: ReperesConfig; onOpen: () => void }) {
  const text = l.c.scale === 'text' || l.c.scale === 'choice'
  return (
    <button
      type="button"
      data-test-line={l.c.id}
      data-voir={`mesure:${l.c.id}`}
      onClick={onOpen}
      className="col-span-3 grid grid-cols-subgrid items-center border-t border-line/60 px-3.5 py-2 text-left transition hover:bg-fg/5"
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-bold" title={l.c.label}>
          {l.c.label}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {frDate(l.last.date)} · {plural(l.all.length, 'mesure')}
        </span>
      </span>
      <Spark line={l} />
      <span className={`flex min-w-0 flex-col items-end ${text ? 'max-w-[9rem]' : ''}`}>
        <span className="flex max-w-full items-center gap-1 text-sm font-extrabold whitespace-nowrap tabular-nums">
          {l.record && <Trophy />}
          <span className="truncate">{fmtValue(l.c, l.last.value)}</span>
          <MeasureMedal cfg={reperes} c={l.c} value={l.last.value} who={player} day={l.last.date} size={14} />
        </span>
        {gainText(l) && (
          <span className="mt-0.5">
            <GainPill line={l} />
          </span>
        )}
      </span>
    </button>
  )
}

const monthYear = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })

/** Un test ouvert : courbe, chiffres clés, mesures datées (staff : modifier, supprimer). */
function TestDetail({
  line: l,
  player,
  reperes,
  editable,
  staff,
  focus,
  onBack,
}: {
  line: TestLine
  player: Player
  reperes: ReperesConfig
  editable: boolean
  staff: boolean
  focus?: { row?: string }
  onBack: () => void
}) {
  const [editing, setEditing] = useState<Measurement | null>(null)
  const g = gainText(l)
  const kind = gainKind(l)
  const unit = l.c.unit ? ` ${l.c.unit}` : ''
  const kpis: [string, string, boolean?][] = [[fmtValue(l.c, l.last.value), 'dernière']]
  if (l.best !== undefined && l.points.length >= 2) kpis.push([`${fmtNum(l.best)}${unit}`, 'record'])
  if (g) kpis.push([g, 'depuis le début', kind === 'up'])
  const rows = [...l.all].reverse()
  return (
    <div data-voir={`mesure:${l.c.id}`} className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onBack} aria-label="Tous les tests" title="Tous les tests" className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl leading-none font-bold text-fg hover:bg-fg/5">
          ‹
        </button>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-base leading-tight font-extrabold">{l.c.label}</h2>
          <div className="text-xs text-muted">
            {l.family} · {plural(l.all.length, 'mesure')}
            {l.all.length > 1 ? ` depuis ${monthYear(l.all[0].date)}` : ` le ${frDate(l.last.date)}`}
          </div>
        </div>
      </div>

      {(l.points.length > 1 || kpis.length > 1) && (
        <div className="card flex flex-col gap-3 p-3">
          {l.points.length > 1 && (
            // Le doigt promène l'infobulle de la courbe : pas de glisser vers un autre joueur ici (useSwipeNav).
            <div className="h-48" data-noswipe>
              <ResponsiveContainer>
                <LineChart data={l.points.map((p) => ({ date: `${p.date.slice(5, 7)}/${p.date.slice(2, 4)}`, day: p.date, v: p.value }))} margin={{ left: -18, right: 12, top: 8 }}>
                  <CartesianGrid stroke={themeColor('line')} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: themeColor('muted'), fontSize: 9 }} />
                  <YAxis domain={['auto', 'auto']} tickFormatter={(v: number) => fmtNum(Math.round(v * 100) / 100)} tick={{ fill: themeColor('muted'), fontSize: 9 }} />
                  <Tooltip
                    contentStyle={{ background: themeColor('panel'), border: `1px solid ${themeColor('line')}`, fontSize: 11 }}
                    labelFormatter={(_, p) => (p?.[0]?.payload?.day ? frDate(p[0].payload.day as string) : '')}
                    formatter={(v) => [fmtValue(l.c, v as number), l.c.label]}
                  />
                  <Line type="monotone" dataKey="v" stroke={themeColor('accent')} strokeWidth={2} dot={{ r: 3, fill: themeColor('accent') }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className={`grid gap-2 ${kpis.length === 3 ? 'grid-cols-3' : kpis.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {kpis.map(([v, label, up]) => (
              <div key={label} className="rounded-lg bg-panel-2 px-2 py-2 text-center">
                <div className={`text-base font-extrabold whitespace-nowrap ${up ? 'text-gain' : ''}`}>{v}</div>
                <div className="text-[10px] text-muted">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <section>
        <div className="mb-1 px-1 text-[11px] font-extrabold tracking-wider text-muted uppercase">Mesures</div>
        <div className="card divide-y divide-line overflow-hidden">
          {rows.map((m) => (
            // Mesure visée (?voir=mesure:<critère>:<mesure>, nouveauté de « Mes suivis ») : sa ligne reste marquée.
            <div key={m.id} className={`flex items-center justify-between gap-3 px-3.5 py-2 text-xs ${focus?.row === m.id ? 'bg-accent/10' : ''}`}>
              <span className="min-w-0">
                <span className="font-bold">{fmtDate(m.date)}</span>
                {staff && m.note && <span className="ml-2 text-[11px] text-amber-200">« {m.note} »</span>}
                {/* Venue d'un tableau collé (src/components/ImportMesures.tsx) : la trace, sous la date. */}
                {staff && m.imported && <span className="block text-[11px] text-muted">importé, validé par {m.imported.by || m.author || 'un encadrant'}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                <span className="flex items-center gap-1 text-sm font-bold">
                  {fmtValue(l.c, m.value)}
                  <MeasureMedal cfg={reperes} c={l.c} value={m.value} who={player} day={m.date} size={14} />
                </span>
                {staff && m.author && !m.imported && <span className="text-[10px] text-muted">{m.author}</span>}
                {editable && (
                  <>
                    <button type="button" className="-m-1 rounded-full p-1.5 text-muted hover:text-fg" title="Modifier cette mesure" aria-label="Modifier cette mesure" onClick={() => setEditing(m)}>
                      <Icon name="pencil" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="-m-1 rounded-full p-1.5 text-muted hover:text-red-400"
                      title="Supprimer cette mesure"
                      aria-label="Supprimer cette mesure"
                      onClick={async () => (await ask('Supprimer cette mesure ?', { ok: 'Supprimer' })) && void remove('measurements', m.id)}
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
      {editing && <MeasureEdit c={l.c} m={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Modifier une mesure : valeur, date, commentaire (la mesure garde son identifiant). */
function MeasureEdit({ c, m, onClose }: { c: Criterion; m: Measurement; onClose: () => void }) {
  const [value, setValue] = useState<number | string | undefined>(m.value)
  const [date, setDate] = useState(m.date)
  const [note, setNote] = useState(m.note ?? '')
  const ok = value !== undefined && value !== '' && !!date
  async function submit() {
    if (!ok) return
    await save<Measurement>('measurements', { ...m, value: value!, date, note: note.trim() || undefined })
    onClose()
  }
  return (
    <FormWindow title={`Modifier · ${c.label}`} onClose={onClose} width={420} phoneFull={false}>
      <label className="flex flex-col">
        <span className="label">Date</span>
        <input type="date" required className="field" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="flex flex-col">
        <span className="label">Valeur</span>
        <CriterionInput c={c} value={value} onChange={setValue} />
      </div>
      <label className="flex flex-col">
        <span className="label">Commentaire (staff)</span>
        <input className="field" maxLength={200} value={note} placeholder="blessé, D>G…" onChange={(e) => setNote(e.target.value)} />
      </label>
      <FormActions>
        <button type="button" className="btn-primary min-h-10 px-4 text-xs" disabled={!ok} onClick={() => void submit()}>
          Enregistrer
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4 text-xs" onClick={onClose}>
          Annuler
        </button>
      </FormActions>
    </FormWindow>
  )
}

/**
 * « Ses tests en PDF » (« Mes tests en PDF ») : une page propre, blanche, imprimée ou « Enregistrer au format PDF » par
 * l'impression du navigateur (même feuille et mêmes règles d'impression que le « Bilan à imprimer », classe family-report :
 * src/index.css). Tout est fait sur l'appareil. Jamais les commentaires ni les auteurs des mesures.
 */
function TestsReport({ player: p, lines, mine, reperes, onClose }: { player: Player; lines: TestLine[]; mine: boolean; reperes: ReperesConfig; onClose: () => void }) {
  const org = installationAppearance().name
  const brand = [appName(), org && org.toLowerCase() !== appName().toLowerCase() ? org : ''].filter(Boolean).join(' · ')
  const top = topProgress(lines)
  return (
    <FormWindow title={mine ? 'Mes tests en PDF' : 'Ses tests en PDF'} onClose={onClose} width={820} guard={false}>
      {/* Téléphone : sans les colonnes « Mesures » et « Courbe » à l'écran (elles sont imprimées). */}
      <p className="text-[11px] text-muted">Rien n’est envoyé : pour un PDF, choisis « Enregistrer au format PDF » comme imprimante.</p>
      <article className="report-sheet family-report rounded-lg bg-white p-4 text-[12px] leading-snug text-neutral-900 shadow sm:p-8 print:rounded-none print:p-0 print:shadow-none" aria-label="Aperçu des tests">
        <div className="keep mb-4 border-b-2 border-neutral-900 pb-2">
          <div className="text-[10px] font-bold tracking-widest text-neutral-500 uppercase">{brand}</div>
          <h2 className="text-lg font-extrabold">
            Tests de {p.firstName} {p.lastName.toUpperCase()}
          </h2>
          <div className="font-bold">{summaryText(lines)}</div>
        </div>
        {top.length > 0 && (
          <section className="keep mb-4">
            <h3 className="mb-1.5 text-[11px] font-extrabold tracking-wider uppercase">Plus beaux progrès</h3>
            <p>{top.map((l) => `${l.c.label} : ${gainText(l)}`).join(' · ')}</p>
          </section>
        )}
        <div className="flex flex-col gap-3">
          {families(lines).map(([f, ls]) => (
            <table key={f} className="keep w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-neutral-400">
                  <th className="py-1 pr-2 font-extrabold">{f}</th>
                  <th className="w-24 py-1 pr-2 font-bold text-neutral-600">Dernière</th>
                  <th className="w-20 py-1 pr-2 font-bold text-neutral-600">Date</th>
                  <th className="hidden w-16 py-1 pr-2 font-bold text-neutral-600 sm:table-cell print:table-cell">Mesures</th>
                  <th className="w-20 py-1 pr-2 font-bold text-neutral-600">Depuis le début</th>
                  <th className="hidden w-20 py-1 font-bold text-neutral-600 sm:table-cell print:table-cell">Courbe</th>
                </tr>
              </thead>
              <tbody>
                {ls.map((l) => (
                  <tr key={l.c.id} className="border-b border-neutral-200">
                    <td className="py-1 pr-2">
                      {l.c.label}
                      {l.record && <span className="ml-1 text-[9px] font-bold uppercase"> · record</span>}
                    </td>
                    <td className="py-1 pr-2 font-bold whitespace-nowrap tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        {fmtValue(l.c, l.last.value)}
                        <MeasureMedal cfg={reperes} c={l.c} value={l.last.value} who={p} day={l.last.date} size={12} />
                      </span>
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{frDate(l.last.date)}</td>
                    <td className="hidden py-1 pr-2 tabular-nums sm:table-cell print:table-cell">{l.all.length}</td>
                    <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{gainText(l) ?? ''}</td>
                    <td className="hidden py-1 sm:table-cell print:table-cell">
                      <PrintSpark line={l} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-2 border-t border-neutral-300 pt-2 text-[10px] text-neutral-600">
          <span>Édité le {fmtDate(today())}</span>
          <span className="text-[12px] font-extrabold tracking-wider text-neutral-900">{appName()}</span>
        </div>
      </article>
      <FormActions>
        <button type="button" className="btn-primary min-h-10 px-4 text-xs" onClick={() => window.print()}>
          Imprimer / PDF
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4 text-xs" onClick={onClose}>
          Fermer
        </button>
      </FormActions>
    </FormWindow>
  )
}
