/*
 * Quand fermer le lecteur vidéo posé à la racine (VideoDock.tsx) ? Seulement quand la personne a quitté l'écran de la
 * vidéo : la section « Vidéos » qui l'a ouverte n'est plus montée ET l'adresse a changé depuis la dernière fois qu'elle
 * l'était.
 *
 * Un changement de mise en page (téléphone tourné : fiche seule ↔ liste + panneau) démonte puis remonte la page sans
 * changer d'adresse : le lecteur attend la section, aussi longtemps qu'il faut (la fiche relit ses données ; sur un
 * téléphone chargé, bien plus d'1,5 s). Changer d'onglet de la fiche, de joueur, de page : l'adresse change, il se ferme.
 *
 * Logique pure (sans React ni navigateur) : test dans tools/test-lecteur-dock.ts.
 */

export type DockWatch = {
  /** Vidéo ouverte par la section `owner`, sur l'adresse `url`. */
  opened(owner: string, url: string): void
  /** Lecteur fermé. */
  closed(): void
  /** Section montée (`url` : adresse actuelle). */
  mount(owner: string, url: string): void
  /** Section démontée (`url` : adresse au moment du démontage, déjà la nouvelle si l'on a navigué). */
  unmount(owner: string, url: string): void
  /** L'adresse a changé (après le démontage des sections quittées). */
  navigated(url: string): void
  /** Sections montées pour ce propriétaire. */
  count(owner: string): number
}

/** `close` est appelé quand le lecteur doit se fermer (personne partie de l'écran de la vidéo). */
export function createDockWatch(close: () => void): DockWatch {
  const mounted = new Map<string, number>()
  // Vidéo ouverte : sa section, et l'adresse où cette section a été vue montée pour la dernière fois.
  let open: { owner: string; home: string } | null = null
  const count = (owner: string) => mounted.get(owner) ?? 0
  const check = (url: string) => {
    if (!open || count(open.owner) > 0 || url === open.home) return
    open = null
    close()
  }
  return {
    opened(owner, url) {
      open = { owner, home: url }
    },
    closed() {
      open = null
    },
    mount(owner, url) {
      mounted.set(owner, count(owner) + 1)
      if (open?.owner === owner) open.home = url
    },
    unmount(owner, url) {
      const n = count(owner) - 1
      if (n > 0) mounted.set(owner, n)
      else mounted.delete(owner)
      check(url)
    },
    navigated(url) {
      if (open && count(open.owner) > 0) open.home = url
      else check(url)
    },
    count,
  }
}
