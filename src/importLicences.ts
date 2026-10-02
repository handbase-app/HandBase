import { db, newId, type Laterality, type Measurement, type Player } from './db'

/*
 * Import d'un export de licences Gest'Hand (CSV « ; », colonnes Nom, Prenom, sexe, Né(e) le,
 * Taille, Lateralite, Numero Licence, Type_demande, Etat, Num Club, Structure, Nationalite).
 * Le fichier est lu sur l'appareil ; toutes les colonnes sont reprises.
 *
 * Rapprochement avec les joueurs existants : numéro de licence, sinon nom + prénom + date de
 * naissance (une licence change en cas de mutation). Un joueur existant n'est que complété :
 * les informations saisies par le staff ne sont jamais écrasées, sauf les données administratives
 * (club, licence, état, nationalité), qui suivent la ligue (l'ancienne licence est gardée).
 */

export interface LicenceRow {
  lastName: string
  firstName: string
  sex?: 'M' | 'F'
  birthDate?: string
  height?: number
  laterality?: Laterality
  license?: string
  club?: string
  clubCode?: string
  /** État de la licence (QUALIFIE, EN_COURS…), pour choisir entre deux lignes d'une même personne. */
  status?: string
  requestType?: string
  nationality?: string
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase()

export const identityKey = (lastName: string, firstName: string, birthDate?: string) =>
  `${norm(lastName)}|${norm(firstName)}|${birthDate ?? ''}`

/** « JEAN-PIERRE » → « Jean-Pierre », « D'AMICO » → « D'Amico ». */
const title = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())

function parseDate(s: string): string | undefined {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined
}

/** Découpe une ligne CSV « ; » en tenant compte des guillemets. */
function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ';') out.push(cur), (cur = '')
    else cur += ch
  }
  out.push(cur)
  return out
}

export async function parseLicenceFile(file: File): Promise<LicenceRow[]> {
  const buf = await file.arrayBuffer()
  // Les exports Gest'Hand sont en Windows-1252 ; on tente d'abord l'UTF-8 strict.
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    text = new TextDecoder('windows-1252').decode(buf)
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) throw new Error('Fichier vide.')
  const head = splitLine(lines[0]).map((h) => norm(h))
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.startsWith(n)))
  const ix = {
    nom: col('nom'),
    prenom: col('prenom'),
    sexe: col('sexe'),
    naissance: col('nele', 'ne'),
    taille: col('taille'),
    lat: col('lateralite'),
    licence: col('numerolicence', 'licence'),
    numClub: col('numclub'),
    structure: col('structure'),
    etat: col('etat'),
    typeDemande: col('typedemande'),
    nationalite: col('nationalite'),
  }
  if (ix.nom < 0 || ix.prenom < 0) throw new Error('Colonnes « Nom » et « Prenom » introuvables : ce n’est pas un export de licences.')

  const rows: LicenceRow[] = []
  for (const line of lines.slice(1)) {
    const c = splitLine(line)
    const get = (i: number) => (i >= 0 ? (c[i] ?? '').trim() : '')
    const lastName = get(ix.nom)
    const firstName = get(ix.prenom)
    if (!lastName || !firstName) continue
    const sx = get(ix.sexe).toUpperCase()
    const lat = norm(get(ix.lat))
    const h = parseFloat(get(ix.taille).replace(',', '.'))
    rows.push({
      lastName: title(lastName),
      firstName: title(firstName),
      sex: sx === 'H' || sx === 'M' ? 'M' : sx === 'F' ? 'F' : undefined,
      birthDate: parseDate(get(ix.naissance)),
      // Taille plausible uniquement (cm) : les valeurs vides ou fantaisistes sont ignorées.
      height: h >= 80 && h <= 230 ? h : undefined,
      laterality: lat === 'droitier' || lat === 'gaucher' || lat === 'ambidextre' ? lat : undefined,
      license: get(ix.licence) || undefined,
      club: get(ix.structure) || undefined,
      clubCode: get(ix.numClub) || undefined,
      status: get(ix.etat).toUpperCase() || undefined,
      requestType: get(ix.typeDemande).toUpperCase() || undefined,
      nationality: get(ix.nationalite) ? title(get(ix.nationalite)) : undefined,
    })
  }
  return rows
}

export interface ImportPlan {
  create: LicenceRow[]
  update: { row: LicenceRow; player: Player; changes: Partial<Player> }[]
  unchanged: number
  duplicates: number
}

/** Prépare l'import (sans rien écrire) pour afficher un aperçu. */
export async function planImport(rows: LicenceRow[]): Promise<ImportPlan> {
  // Les joueurs de démonstration (locaux) ne sont jamais rapprochés : ils ne doivent pas partir au serveur.
  const players = (await db.players.toArray()).filter((p) => !p.deleted && !p.id.startsWith('demo-'))
  const byLicence = new Map<string, Player>()
  const byIdentity = new Map<string, Player>()
  for (const p of players) {
    for (const l of [p.license, ...(p.previousLicenses ?? [])]) if (l) byLicence.set(l, p)
    byIdentity.set(identityKey(p.lastName, p.firstName, p.birthDate), p)
  }

  const plan: ImportPlan = { create: [], update: [], unchanged: 0, duplicates: 0 }

  // Une même personne peut figurer deux fois (deux demandes de licence) : on fusionne les lignes,
  // en privilégiant la licence qualifiée et en complétant les informations manquantes.
  const merged = new Map<string, LicenceRow>()
  const qualified = (r: LicenceRow) => (r.status ?? '').startsWith('QUALIFIE')
  for (const r of rows) {
    const key = identityKey(r.lastName, r.firstName, r.birthDate)
    const prev = merged.get(key)
    if (!prev) {
      merged.set(key, r)
      continue
    }
    plan.duplicates++
    const [main, other] = qualified(r) && !qualified(prev) ? [r, prev] : [prev, r]
    merged.set(key, {
      ...main,
      license: main.license ?? other.license,
      height: main.height ?? other.height,
      laterality: main.laterality ?? other.laterality,
      club: main.club ?? other.club,
      nationality: main.nationality ?? other.nationality,
    })
  }

  for (const [key, r] of merged) {
    const p = (r.license && byLicence.get(r.license)) || byIdentity.get(key)
    if (!p) {
      plan.create.push(r)
      continue
    }
    const changes: Partial<Player> = {}
    if (!p.sex && r.sex) changes.sex = r.sex
    if (!p.birthDate && r.birthDate) changes.birthDate = r.birthDate
    if (!p.laterality && r.laterality) changes.laterality = r.laterality
    if (r.club && p.club !== r.club) changes.club = r.club
    if (r.clubCode && p.clubCode !== r.clubCode) changes.clubCode = r.clubCode
    if (r.status && p.licenseStatus !== r.status) changes.licenseStatus = r.status
    if (r.requestType && p.licenseRequestType !== r.requestType) changes.licenseRequestType = r.requestType
    if (r.nationality && p.nationality !== r.nationality) changes.nationality = r.nationality
    if (r.license && p.license !== r.license) {
      changes.license = r.license
      if (p.license) changes.previousLicenses = [...new Set([...(p.previousLicenses ?? []), p.license])]
    }
    if (Object.keys(changes).length) plan.update.push({ row: r, player: p, changes })
    else plan.unchanged++
  }
  return plan
}

/** Écrit l'import dans la base locale ; la synchronisation l'envoie ensuite au serveur. */
export async function applyImport(plan: ImportPlan, sourceDate: string, onProgress?: (done: number, total: number) => void) {
  const now = Date.now()
  const author = 'Licence FFHB (déclarée)'
  const players: Player[] = []
  const measurements: Measurement[] = []

  for (const r of plan.create) {
    const id = newId()
    players.push({
      id,
      firstName: r.firstName,
      lastName: r.lastName,
      sex: r.sex,
      birthDate: r.birthDate,
      laterality: r.laterality,
      license: r.license,
      licenseStatus: r.status,
      licenseRequestType: r.requestType,
      club: r.club,
      clubCode: r.clubCode,
      nationality: r.nationality,
      updatedAt: now,
    })
    if (r.height !== undefined)
      measurements.push({ id: newId(), playerId: id, criterionId: 'taille', value: r.height, date: sourceDate, author, updatedAt: now })
  }
  for (const u of plan.update) players.push({ ...u.player, ...u.changes, updatedAt: now })

  // Taille déclarée pour les joueurs existants qui n'ont encore aucune taille.
  const existingIds = new Set(plan.update.map((u) => u.player.id))
  if (existingIds.size) {
    const withHeight = new Set(
      (await db.measurements.where('criterionId').equals('taille').toArray()).filter((m) => !m.deleted).map((m) => m.playerId),
    )
    for (const u of plan.update)
      if (u.row.height !== undefined && !withHeight.has(u.player.id))
        measurements.push({ id: newId(), playerId: u.player.id, criterionId: 'taille', value: u.row.height, date: sourceDate, author, updatedAt: now })
  }

  // Écriture par paquets pour garder l'appli réactive.
  const total = players.length + measurements.length
  let done = 0
  const CHUNK = 500
  for (const [table, list] of [
    ['players', players],
    ['measurements', measurements],
  ] as const) {
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = list.slice(i, i + CHUNK)
      await db.transaction('rw', db.table(table), db.outbox, async () => {
        await db.table(table).bulkPut(part)
        await db.outbox.bulkAdd(part.map((r) => ({ table, rowId: r.id })))
      })
      done += part.length
      onProgress?.(done, total)
    }
  }
  return { players: players.length, created: plan.create.length, updated: plan.update.length, measurements: measurements.length }
}
