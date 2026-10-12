/*
 * Classeurs Excel (.xlsx) réduits au strict nécessaire, sans dépendance : des feuilles de texte et de nombres.
 *  - écriture : archive ZIP sans compression (Excel, LibreOffice et Numbers l'ouvrent sans souci) ;
 *  - lecture : première feuille (ou celle demandée), cellules texte, nombre ou booléen ; décompression par le
 *    navigateur (DecompressionStream « deflate-raw »). Formules : seule leur dernière valeur calculée est lue.
 * Utilisé par l'import / export des critères (criteriaFormat.ts, criteriaImport.ts).
 */

export type Cell = string | number | boolean | null | undefined
export interface Sheet {
  name: string
  rows: Cell[][]
  /** Largeur des colonnes (en caractères). */
  widths?: number[]
}

// ---------- Écriture ----------

const xmlEsc = (s: string) =>
  s
    // Caractères de contrôle interdits en XML 1.0.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** « A », « B »… « AA » : lettre(s) de la colonne i (0 = A). */
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + colName(i % 26))

function sheetXml(s: Sheet) {
  const rows = s.rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          if (v === null || v === undefined || v === '') return ''
          const ref = `${colName(ci)}${ri + 1}`
          // Première ligne en gras (style 1) : les en-têtes.
          const st = ri === 0 ? ' s="1"' : ''
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`
          if (typeof v === 'boolean') return `<c r="${ref}"${st} t="b"><v>${v ? 1 : 0}</v></c>`
          return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`
        })
        .join('')
      return `<row r="${ri + 1}">${cells}</row>`
    })
    .join('')
  const cols = s.widths?.length
    ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : ''
  // Ligne d'en-tête figée.
  const pane = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Archive ZIP « stockée » (sans compression). */
function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version
    lv.setUint16(6, 0x0800, true) // noms en UTF-8
    lv.setUint16(8, 0, true) // stocké
    lv.setUint16(10, 0, true) // heure
    lv.setUint16(12, 0x21, true) // date : 1er janvier 1980
    lv.setUint32(14, crc, true)
    lv.setUint32(18, f.data.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const head = new Uint8Array(46 + name.length)
    const cv = new DataView(head.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, f.data.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    head.set(name, 46)
    parts.push(local, f.data)
    central.push(head)
    offset += local.length + f.data.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, size, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Classeur .xlsx (octets) avec ces feuilles, dans cet ordre. */
export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const enc = new TextEncoder()
  const ns = 'http://schemas.openxmlformats.org'
  const files: { name: string; data: string }[] = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${xmlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.data) })))
}

// ---------- Lecture ----------

/** Fichiers d'une archive ZIP (méthodes « stockée » et « deflate »). */
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf)
  const bytes = new Uint8Array(buf)
  // Fin du répertoire central : cherchée depuis la fin (un commentaire peut suivre).
  let end = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('Ce n’est pas un fichier Excel (.xlsx) valide.')
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const dec = new TextDecoder()
  const out = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Fichier Excel abîmé.')
    const method = v.getUint16(p + 10, true)
    const csize = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = bytes.slice(start, start + csize)
    if (method === 0) out.set(name, raw)
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Navigateur trop ancien pour lire un fichier Excel : enregistre-le en CSV.')
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()))
    }
  }
  return out
}

const xml = (files: Map<string, Uint8Array>, name: string) => {
  const b = files.get(name)
  return b ? new DOMParser().parseFromString(new TextDecoder().decode(b), 'application/xml') : null
}

/** Texte d'un élément (chaînes partagées ou en ligne) : ses <t>, sans les indications phonétiques. */
const textOf = (el: Element) =>
  Array.from(el.getElementsByTagName('t'))
    .filter((t) => t.parentElement?.localName !== 'rPh' && t.parentElement?.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('')

/** Colonne (0 = A) d'une référence de cellule « AB12 ». */
const colIndex = (ref: string) => {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Lignes de la feuille `prefer` (par nom), sinon de la première feuille du classeur. */
export async function readXlsx(buf: ArrayBuffer, prefer?: string): Promise<Cell[][]> {
  const files = await unzip(buf)
  const wb = xml(files, 'xl/workbook.xml')
  if (!wb) throw new Error('Ce n’est pas un fichier Excel (.xlsx) valide.')
  const sheets = Array.from(wb.getElementsByTagName('sheet'))
  const sheet = sheets.find((s) => s.getAttribute('name') === prefer) ?? sheets[0]
  if (!sheet) throw new Error('Le classeur ne contient aucune feuille.')
  // Chemin de la feuille, via les relations du classeur.
  const rid = sheet.getAttribute('r:id') ?? sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const rels = xml(files, 'xl/_rels/workbook.xml.rels')
  const target = rels && Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target')
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml'
  const ws = xml(files, path)
  if (!ws) throw new Error('Feuille introuvable dans le classeur.')
  const sst = xml(files, 'xl/sharedStrings.xml')
  const shared = sst ? Array.from(sst.getElementsByTagName('si')).map(textOf) : []

  const rows: Cell[][] = []
  for (const row of Array.from(ws.getElementsByTagName('row'))) {
    const ri = Number(row.getAttribute('r') ?? rows.length + 1) - 1
    const cells: Cell[] = []
    let next = 0
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r')
      const ci = ref ? colIndex(ref) : next
      next = ci + 1
      const t = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? null
      let val: Cell = null
      if (t === 's') val = v === null ? null : (shared[Number(v)] ?? '')
      else if (t === 'inlineStr') val = textOf(c)
      else if (t === 'b') val = v === '1'
      else if (t === 'str' || t === 'e') val = v
      else if (v !== null && v !== '') val = Number(v)
      cells[ci] = val
    }
    rows[ri] = cells
  }
  // Lignes absentes (vides) : tableaux vides, pour garder les numéros de ligne.
  return Array.from({ length: rows.length }, (_, i) => rows[i] ?? [])
}
