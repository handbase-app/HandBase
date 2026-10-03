import { age, alive, counts, db, fmtDate, positionLabel } from './db'
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
    'Prénom', 'Nom', 'Naissance', 'Âge', 'Sexe', 'Taille mère (cm)', 'Taille père (cm)', 'Nationalité', 'Poste', 'Équipe', 'Licence', 'État licence', 'Type licence', 'Catégorie', 'Club', 'N° club', 'Département', 'Internat', 'Latéralité',
    ...factual.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label)),
    ...subjective.map((c) => `${c.label} (moy. avis)`),
    'Décalage pic Mirwald (ans)', 'Décalage pic Moore (ans)', 'Taille adulte prédite (cm)', '% taille adulte',
    'Nb avis', 'Lacunes', 'Notes',
  ]
  const rows = players.map((p) => {
    const l = latest.get(p.id)
    const evs = evaluations.filter((e) => e.playerId === p.id)
    const avg = (id: string) => {
      const v = evs.map((e) => e.scores[id]).filter((x) => typeof x === 'number')
      return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1).replace('.', ',') : ''
    }
    const num = (v: unknown) => (typeof v === 'number' ? String(v).replace('.', ',') : v)
    const r1 = (v: number | null | undefined) => (typeof v === 'number' ? num(Math.round(v * 10) / 10) : '')
    const snap = snapshots(p, measurements.filter((m) => m.playerId === p.id && !m.deleted)).at(-1)
    return [
      p.firstName, p.lastName, fmtDate(p.birthDate), age(p.birthDate) ?? '', p.sex === 'M' ? 'Garçon' : p.sex === 'F' ? 'Fille' : '',
      num(p.motherHeight), num(p.fatherHeight), p.nationality, positionLabel(p.position), p.team, p.license,
      p.licenseStatus, p.licenseRequestType, p.category, p.club, p.clubCode, department(p), p.boarding === true ? 'Oui' : p.boarding === false ? 'Non' : '', p.laterality,
      ...factual.map((c) => num(l?.get(c.id)?.value)),
      ...subjective.map((c) => avg(c.id)),
      r1(snap?.mirwald), r1(snap?.moore), r1(snap?.kr?.predicted), r1(snap?.kr?.pah),
      evs.length, p.gaps, p.notes,
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
  }
  download(`handbase-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json')
}

/** Restaure une sauvegarde : fusion, la version la plus récente de chaque ligne l'emporte. */
export async function importBackup(file: File) {
  const data = JSON.parse(await file.text())
  const tables = ['players', 'criteria', 'measurements', 'events', 'evaluations'] as const
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
