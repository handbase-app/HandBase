import type { PdfItem } from './matchSheet'

/*
 * Lecture d'un PDF dans le navigateur avec pdf.js (pdfjs-dist, version « legacy » pour les navigateurs un peu anciens).
 * Ce module, la bibliothèque et son worker ne sont chargés qu'au clic sur « Importer une feuille de match » (import
 * dynamique). Le fichier reste sur l'appareil : rien n'est envoyé, le PDF n'est pas gardé.
 */

/** Taille maximale acceptée (une feuille de match fait quelques dizaines de Ko). */
const MAX_BYTES = 5 * 1024 * 1024

/** Éléments de texte positionnés de toutes les pages (y compté depuis le haut de la page). */
export async function readPdfItems(file: Blob): Promise<PdfItem[]> {
  if (file.size > MAX_BYTES) throw new Error('Fichier trop lourd pour une feuille de match (5 Mo au plus).')
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, stopAtErrors: false }).promise
  try {
    const out: PdfItem[] = []
    for (let n = 1; n <= Math.min(doc.numPages, 6); n++) {
      const page = await doc.getPage(n)
      const height = page.getViewport({ scale: 1 }).height
      const tc = await page.getTextContent()
      for (const it of tc.items) {
        if (!('str' in it) || !it.str.trim()) continue
        out.push({ page: n, x: it.transform[4], y: height - it.transform[5], w: it.width, h: it.height, str: it.str })
      }
    }
    return out
  } finally {
    void doc.destroy()
  }
}
