/*
 * Rapports en codes (page /rapport/:id, projet « Serveur MCP Nextar ») : lecture du Markdown rédigé par l'IA du coach, en
 * blocs et morceaux de texte que la page dessine elle-même (jamais de HTML injecté : un rapport ne peut ni lancer de script ni
 * charger d'image). Fichier PUR, testé par tools/test-mcp.ts. Les codes de joueur sont remplacés par les noms au moment du
 * dessin (src/codesJoueurs.ts, remplacerCodes), sur l'appareil.
 *
 * Reconnu : titres (#, ##, ###, ####), paragraphes, listes à puces (-, *, +) et numérotées (1. 1)), avec un niveau
 * d'indentation, citations (>), tableaux à barres (ligne de tirets, alignement ignoré), ligne de séparation (---), blocs de
 * code (```), et dans le texte : **gras**, *italique* / _italique_, `code`, liens [texte](https://…) (http et https
 * seulement ; le reste est gardé comme texte).
 */

export type Inline = { k: 't'; t: string } | { k: 'b'; c: Inline[] } | { k: 'i'; c: Inline[] } | { k: 'code'; t: string } | { k: 'a'; href: string; c: Inline[] }

export type Bloc =
  | { k: 'h'; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { k: 'p'; c: Inline[] }
  | { k: 'ul' | 'ol'; items: { depth: number; c: Inline[] }[]; start?: number }
  | { k: 'quote'; c: Inline[] }
  | { k: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { k: 'hr' }
  | { k: 'code'; t: string }

/** Morceaux de texte d'une ligne Markdown (gras, italique, code, liens). */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ k: 't', t: buf })
    buf = ''
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length && /[\\`*_[\]()#|>-]/.test(s[i + 1])) {
      buf += s[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ k: 'code', t: s.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] === ch) {
      const end = s.indexOf(ch + ch, i + 2)
      if (end > i + 2) {
        flush()
        out.push({ k: 'b', c: parseInline(s.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (ch === '*' || (ch === '_' && (i === 0 || /[\s(]/.test(s[i - 1])))) {
      const end = s.indexOf(ch, i + 1)
      if (end > i + 1 && !/\s/.test(s[i + 1]) && (ch === '*' || end + 1 >= s.length || /[\s.,;:!?)]/.test(s[end + 1]))) {
        flush()
        out.push({ k: 'i', c: parseInline(s.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(s.slice(i))
      if (m) {
        flush()
        if (/^https?:\/\//i.test(m[2])) out.push({ k: 'a', href: m[2], c: parseInline(m[1]) })
        else out.push(...parseInline(m[1]))
        i += m[0].length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  // Textes voisins réunis (un lien refusé redevient du texte).
  return out.reduce<Inline[]>((acc, x) => {
    const prev = acc[acc.length - 1]
    if (x.k === 't' && prev?.k === 't') acc[acc.length - 1] = { k: 't', t: prev.t + x.t }
    else acc.push(x)
    return acc
  }, [])
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const cellsOf = (l: string) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))

/** Blocs d'un rapport Markdown. */
export function parseMarkdown(md: string): Bloc[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: Bloc[] = []
  let para: string[] = []
  const flushPara = () => {
    if (para.length) out.push({ k: 'p', c: parseInline(para.join(' ')) })
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (!t) {
      flushPara()
      i++
      continue
    }
    // Bloc de code.
    if (t.startsWith('```')) {
      flushPara()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++])
      i++
      out.push({ k: 'code', t: body.join('\n') })
      continue
    }
    // Titre.
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(t)
    if (h) {
      flushPara()
      out.push({ k: 'h', level: Math.min(4, h[1].length) as 1 | 2 | 3 | 4, c: parseInline(h[2]) })
      i++
      continue
    }
    // Séparation.
    if (/^(-\s*){3,}$|^(\*\s*){3,}$|^(_\s*){3,}$/.test(t)) {
      flushPara()
      out.push({ k: 'hr' })
      i++
      continue
    }
    // Tableau : une ligne à barres suivie d'une ligne de tirets.
    if (t.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara()
      const head = cellsOf(t).map(parseInline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        const cs = cellsOf(lines[i]).map(parseInline)
        rows.push(head.map((_, j) => cs[j] ?? []))
        i++
      }
      out.push({ k: 'table', head, rows })
      continue
    }
    // Citation.
    if (t.startsWith('>')) {
      flushPara()
      const body: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) body.push(lines[i++].trim().replace(/^>\s?/, ''))
      out.push({ k: 'quote', c: parseInline(body.join(' ')) })
      continue
    }
    // Listes.
    const li = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/.exec(line)
    if (li) {
      flushPara()
      const kind: 'ul' | 'ol' = li[3] ? 'ol' : 'ul'
      const items: { depth: number; c: Inline[] }[] = []
      const start = li[3] ? +li[3] : undefined
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/.exec(lines[i])
        if (m) {
          if (!items.length || (m[3] ? 'ol' : 'ul') === kind || m[1].length >= 2) {
            items.push({ depth: m[1].length >= 2 ? 1 : 0, c: parseInline(m[4]) })
            i++
            continue
          }
          break
        }
        // Suite d'un élément (ligne indentée).
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          const last = items[items.length - 1]
          last.c = [...last.c, { k: 't', t: ' ' }, ...parseInline(lines[i].trim())]
          i++
          continue
        }
        break
      }
      out.push({ k: kind, items, ...(start !== undefined && start !== 1 ? { start } : {}) })
      continue
    }
    para.push(t)
    i++
  }
  flushPara()
  return out
}

/** Texte brut d'un morceau (titre de l'onglet, recherche). */
export const inlineText = (c: Inline[]): string => c.map((x) => (x.k === 't' || x.k === 'code' ? x.t : inlineText(x.c))).join('')
