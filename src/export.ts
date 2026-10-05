import { age, alive, contextLabel, counts, db, fmtDate, positionLabel } from './db'
import { fmtValue } from './components/ui'
import { departmentLabel } from './lists'
import { snapshots } from './components/MaturityCard'
import { department } from './components/PlayerFilter'
import { latestByPlayer } from './pages/Players'

const esc = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Export CSV (séparateur « ; » pour Excel en français) : une ligne par joueur, dernières valeurs + moyenne des avis validés.
 *  `only` : limite l'export à ces joueurs (ceux affichés après les filtres). */
export async function exportCsv(only?: { id: string }[]) {
  const [all, criteria, measurements, evaluations] = await Promise.all([
    db.players.toArray().then(alive),
    db.criteria.orderBy('order').toArray().then(alive),
    db.measurements.toArray(),
    db.evaluations.toArray().then((es) => alive(es).filter(counts)),
  ])
  const keep = only && new Set(only.map((p) => p.id))
  const players = keep ? all.filter((p) => keep.has(p.id)) : all
  const factual = criteria.filter((c) => c.kind === 'factual')
  const subjective = criteria.filter((c) => c.kind === 'subjective')
  const latest = latestByPlayer(measurements)

  const head = [
    'Prénom', 'Nom', 'Naissance', 'Âge', 'Sexe', 'Taille mère (cm)', 'Taille père (cm)', 'Nationalité', 'Poste', 'Postes secondaires', 'Équipe', 'Licence', 'État licence', 'Type licence', 'Catégorie', 'Club', 'N° club', 'Département', 'Internat', 'Latéralité',
    ...factual.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label)),
    ...subjective.map((c) => `${c.label} (${c.scale === 'choice' ? 'avis le plus fréquent' : c.scale === 'text' ? 'avis' : 'moy. avis'})`),
    'Décalage pic Mirwald (ans)', 'Décalage pic Moore (ans)', 'Taille adulte prédite (cm)', '% taille adulte',
    'Nb avis', 'Fiche', 'Lacunes', 'Notes',
  ]
  const rows = players.map((p) => {
    const l = latest.get(p.id)
    const evs = evaluations.filter((e) => e.playerId === p.id)
    const avg = (c: (typeof subjective)[number]) => {
      if (c.scale === 'choice' || c.scale === 'text') {
        // Choix : le plus fréquent ; texte : toutes les réponses.
        const t = evs.map((e) => e.scores[c.id]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        if (c.scale === 'text') return [...new Set(t)].join(' | ')
        const n = new Map<string, number>()
        for (const x of t) n.set(x, (n.get(x) ?? 0) + 1)
        return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      }
      const v = evs.map((e) => e.scores[c.id]).filter((x): x is number => typeof x === 'number')
      return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1).replace('.', ',') : ''
    }
    const num = (v: unknown) => (typeof v === 'number' ? String(v).replace('.', ',') : v)
    const r1 = (v: number | null | undefined) => (typeof v === 'number' ? num(Math.round(v * 10) / 10) : '')
    const snap = snapshots(p, measurements.filter((m) => m.playerId === p.id && !m.deleted)).at(-1)
    return [
      p.firstName, p.lastName, fmtDate(p.birthDate), age(p.birthDate) ?? '', p.sex === 'M' ? 'Garçon' : p.sex === 'F' ? 'Fille' : '',
      num(p.motherHeight), num(p.fatherHeight), p.nationality, positionLabel(p.position), (p.secondaryPositions ?? []).map((x) => positionLabel(x)).join(', '), p.team, p.license,
      p.licenseStatus, p.licenseRequestType, p.category, p.club, p.clubCode, department(p), p.boarding === true ? 'Oui' : p.boarding === false ? 'Non' : '', p.laterality,
      ...factual.map((c) => num(l?.get(c.id)?.value)),
      ...subjective.map((c) => avg(c)),
      r1(snap?.mirwald), r1(snap?.moore), r1(snap?.kr?.predicted), r1(snap?.kr?.pah),
      evs.length, p.review === 'pending' ? 'Proposée' : p.review === 'refused' ? 'Hors cadre' : '', p.gaps, p.notes,
    ]
  })
  const csv = '﻿' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\n')
  download(`handbase-joueurs-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8')
}

/** Sauvegarde complète (JSON) de la base locale. */
export async function exportBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    criteria: await db.criteria.toArray(),
    measurements: await db.measurements.toArray(),
    events: await db.events.toArray(),
    evaluations: await db.evaluations.toArray(),
    groups: await db.groups.toArray(),
    lists: await db.lists.toArray(),
    alerts: await db.alerts.toArray(),
  }
  download(`handbase-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json')
}

/** Restaure une sauvegarde : fusion, la version la plus récente de chaque ligne l'emporte. */
export async function importBackup(file: File) {
  const data = JSON.parse(await file.text())
  const tables = ['players', 'criteria', 'measurements', 'events', 'evaluations', 'groups', 'lists', 'alerts'] as const
  let n = 0
  for (const t of tables) {
    const rows: { id: string; updatedAt: number }[] = data[t] ?? []
    await db.transaction('rw', db.table(t), db.outbox, async () => {
      for (const r of rows) {
        const cur = await db.table(t).get(r.id)
        if (!cur || r.updatedAt > cur.updatedAt) {
          await db.table(t).put(r)
          await db.outbox.add({ table: t, rowId: r.id })
          n++
        }
      }
    })
  }
  return n
}

const h = (v: unknown) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Copie de toutes les données d'un joueur (droit d'accès RGPD) : une page HTML lisible par une famille,
 * à ouvrir dans un navigateur ou imprimer en PDF. Tout y est, y compris les avis en attente ou hors cadre.
 */
export async function exportPlayer(id: string) {
  const p = await db.players.get(id)
  if (!p) return
  const [criteria, measurements, evaluations, events, groups] = await Promise.all([
    db.criteria.toArray(),
    db.measurements.where('playerId').equals(id).toArray().then(alive),
    db.evaluations.where('playerId').equals(id).toArray().then(alive),
    db.events.toArray(),
    db.groups.toArray().then(alive),
  ])
  const crit = new Map(criteria.map((c) => [c.id, c]))
  const ev = new Map(events.map((e) => [e.id, e]))
  const dept = department(p)
  const state = (r?: string) => (r === 'pending' ? 'en attente de validation' : r === 'refused' ? 'hors cadre (ne compte pas)' : '')
  const table = (head: string[], rows: unknown[][]) =>
    rows.length
      ? `<table><tr>${head.map((x) => `<th>${h(x)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((x) => `<td>${h(x)}</td>`).join('')}</tr>`).join('')}</table>`
      : '<p class="m">Aucune.</p>'

  const info: [string, unknown][] = [
    ['Nom', p.lastName], ['Prénom', p.firstName], ['Sexe', p.sex === 'M' ? 'Garçon' : p.sex === 'F' ? 'Fille' : ''],
    ['Date de naissance', p.birthDate && fmtDate(p.birthDate)], ['Nationalité', p.nationality], ['Club', p.club], ['N° de club', p.clubCode],
    ['Département', dept && departmentLabel(dept)], ['Licence', p.license], ['Anciennes licences', p.previousLicenses?.join(', ')],
    ['État de la licence', p.licenseStatus], ['Type de licence', p.licenseRequestType], ['Équipe', p.team], ['Catégorie / niveau', p.category],
    ['Internat', p.boarding === true ? 'Oui' : p.boarding === false ? 'Non' : ''], ['Latéralité', p.laterality],
    ['Poste', positionLabel(p.position)], ['Postes secondaires', (p.secondaryPositions ?? []).map((x) => positionLabel(x)).join(', ')],
    ['Taille de la mère', p.motherHeight !== undefined ? `${p.motherHeight} cm` : ''], ['Taille du père', p.fatherHeight !== undefined ? `${p.fatherHeight} cm` : ''],
    ['Lacunes', p.gaps], ['Notes', p.notes], ['Photo', p.photo ? 'Oui (enregistrée)' : ''],
    ['Fiche', p.review === 'pending' ? 'Proposée, en attente de validation' : p.review === 'refused' ? 'Hors cadre' : ''],
    ['Commentaire de validation', p.reviewNote], ['Fiche créée par', p.createdByName],
  ]

  const meas = [...measurements]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((m) => [fmtDate(m.date), crit.get(m.criterionId)?.label ?? m.criterionId, fmtValue(crit.get(m.criterionId), m.value), m.note, m.author])

  const avis = [...evaluations]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => {
      const scores = Object.entries(e.scores)
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => `<li>${h(crit.get(k)?.label ?? k)} : ${h(fmtValue(crit.get(k), v))}</li>`)
        .join('')
      const where = e.eventId ? (ev.get(e.eventId)?.name ?? 'Événement') : contextLabel(e)
      return `<div class="avis"><b>${h(fmtDate(e.date))} · ${h(where)}</b> — par ${h(e.observer)}${state(e.review) ? ` <i>(${h(state(e.review))})</i>` : ''}
        ${e.overall !== undefined ? `<div>Note globale : ${h(e.overall)}/5</div>` : ''}${e.minutesObserved ? `<div>Temps observé : ${h(e.minutesObserved)} min</div>` : ''}
        ${scores ? `<ul>${scores}</ul>` : ''}${e.strengths ? `<div>Points forts : ${h(e.strengths)}</div>` : ''}${e.improvements ? `<div>À travailler : ${h(e.improvements)}</div>` : ''}
        ${e.reviewNote ? `<div class="m">Commentaire de validation : ${h(e.reviewNote)}</div>` : ''}</div>`
    })
    .join('')

  const evts = events
    .filter((e) => !e.deleted && (e.playerIds ?? []).includes(id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => [fmtDate(e.date), e.name, e.place])
  const grps = groups.filter((g) => g.playerIds.includes(id)).map((g) => [g.name, g.description])

  const name = `${p.lastName.toUpperCase()} ${p.firstName}`
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Données HandBase – ${h(name)}</title><style>
body{font:14px/1.45 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#111}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f3f3f3}
.m{color:#666}.avis{border:1px solid #ddd;border-radius:6px;padding:8px 10px;margin:8px 0}.avis ul{margin:4px 0;padding-left:18px}
</style></head><body>
<h1>${h(name)}</h1><p class="m">Copie de toutes les données enregistrées dans HandBase, éditée le ${h(new Date().toLocaleDateString('fr-FR'))}.</p>
<h2>Fiche</h2>${table(['Information', 'Valeur'], info.filter(([, v]) => v !== undefined && v !== null && v !== ''))}
<h2>Mesures et tests (${meas.length})</h2>${table(['Date', 'Test', 'Valeur', 'Commentaire', 'Saisi par'], meas)}
<h2>Avis des observateurs (${evaluations.length})</h2>${avis || '<p class="m">Aucun.</p>'}
<h2>Rassemblements et événements (${evts.length})</h2>${table(['Date', 'Événement', 'Lieu'], evts)}
<h2>Groupes (${grps.length})</h2>${table(['Groupe', 'Description'], grps)}
</body></html>`
  const file = `${p.lastName}_${p.firstName}`.normalize('NFD').replace(/[^a-zA-Z0-9_]/g, '')
  download(`handbase-donnees-${file}.html`, html, 'text/html;charset=utf-8')
}
