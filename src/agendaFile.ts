import { eventIcs, type AgendaEvent } from './agenda'
import { appUrl, flash } from './components/ItemMenu'

/*
 * Remise d'un fichier .ics fabriqué sur l'appareil (src/agenda.ts) : rien n'est envoyé à aucun service.
 *  - Appareil tactile qui sait partager ce fichier (navigator.canShare({ files })) : la feuille de partage du téléphone
 *    (Agenda, Calendrier, Fichiers…) ; abandonnée par l'utilisateur : rien d'autre ; refusée par le navigateur : le
 *    téléchargement.
 *  - Sinon : téléchargement (Blob text/calendar, lien temporaire retiré une minute plus tard : sur iPhone, le
 *    téléchargement attend une confirmation, il faut que le lien vive jusque-là). Ouvrir le fichier l'ajoute à l'agenda.
 * À appeler directement dans le geste (toucher, clic) : le partage l'exige ; le fichier est donc fabriqué avant, sans attente.
 */

const TYPE = 'text/calendar;charset=utf-8'
/** Durée de vie du lien du téléchargement (ms). */
const REVOKE_MS = 60_000

const touch = () => {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function download(ics: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: TYPE }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  // Dans la page (Firefox l'exige), retiré aussitôt.
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS)
  flash('Fichier d’agenda enregistré : ouvre-le pour l’ajouter à ton agenda')
}

/** Partage (téléphone) ou téléchargement du fichier ; rend ce qui a été fait. */
export async function offerIcs(ics: string, fileName: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (touch() && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && typeof File === 'function') {
    let file: File | null = null
    try {
      file = new File([ics], fileName, { type: TYPE })
    } catch {
      file = null
    }
    let ok = false
    try {
      ok = !!file && navigator.canShare({ files: [file] })
    } catch {
      ok = false
    }
    if (file && ok) {
      try {
        await navigator.share({ files: [file], title })
        return 'shared'
      } catch (e) {
        // Fermée par l'utilisateur : rien d'autre. Autre refus (droits, type) : le téléchargement.
        if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled'
      }
    }
  }
  download(ics, fileName)
  return 'downloaded'
}

/**
 * « Ajouter à mon agenda » (menu ⋮ de la page d'un événement) : son jour, son heure s'il en a une, son lieu, l'adresse de
 * sa page et le NOMBRE de joueurs de sa liste (« N jeunes à voir »), jamais leurs noms. Faux si le jour n'est pas valable.
 */
export function eventToAgenda(ev: AgendaEvent): boolean {
  const out = eventIcs(ev, { url: appUrl(`/evenements/${ev.id}`) })
  if (!out) return false
  void offerIcs(out.ics, out.fileName, ev.name)
  return true
}
