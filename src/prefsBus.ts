/*
 * Signal « une préférence liée au compte a changé sur cet appareil » (thème de couleurs, style personnel, filtre garçons /
 * filles). Sans aucune dépendance : appelé par src/theme.ts et les filtres de joueurs, écouté par src/preferences.ts qui
 * envoie au compte (sans que ces fichiers aient à connaître la synchronisation).
 */
const subs = new Set<() => void>()

export function onPrefsChanged(f: () => void) {
  subs.add(f)
  return () => void subs.delete(f)
}

export const prefsChanged = () => subs.forEach((f) => f())
