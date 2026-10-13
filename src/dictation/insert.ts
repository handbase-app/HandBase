// Insertion du texte dicté dans un commentaire (fonction pure, testée dans tools/test-dictee.ts).
// À la position du curseur si le champ l'avait, sinon à la fin ; une espace est ajoutée de chaque côté si besoin.
// Rien n'est reformulé : seul l'espacement change. Avec une longueur maximale, le texte dicté est coupé.

export function insertDictation(
  value: string,
  text: string,
  sel?: { start: number; end: number } | null,
  maxLength?: number,
): { value: string; caret: number; cut: boolean } {
  const start = sel ? Math.max(0, Math.min(sel.start, value.length)) : value.length
  const end = sel ? Math.max(start, Math.min(sel.end, value.length)) : value.length
  const before = value.slice(0, start)
  const after = value.slice(end)
  const pre = before && !/\s$/.test(before) ? ' ' : ''
  const post = after && !/^[\s.,;:!?…)»]/.test(after) ? ' ' : ''
  let piece = text.trim()
  let cut = false
  if (maxLength != null) {
    const room = maxLength - before.length - after.length - pre.length - post.length
    if (piece.length > room) {
      piece = room > 0 ? piece.slice(0, room).trimEnd() : ''
      cut = true
    }
  }
  if (!piece) return { value, caret: start, cut }
  const inserted = pre + piece + post
  return { value: before + inserted + after, caret: before.length + pre.length + piece.length, cut }
}
