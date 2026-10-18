import { useAppBrand } from '../appBrand'

/*
 * Identité de l'appli à l'écran : Nextar par défaut, réglable par les administrateurs (Réglages → Administration → « Appli :
 * nom et logo » ; src/appBrandCore.ts). Distincte de celle de l'organisation qui l'utilise (fédération, ligue… : nom et
 * logo de Réglages → Style de l'installation, affichés sur l'accueil).
 *
 * Logos par défaut : public/brand/nextar.svg (pictogramme + mot) et public/brand/nextar-pictogramme.svg (pictogramme seul,
 * recentré dans son carré arrondi bleu nuit) pour les petites tailles, à côté du nom écrit en texte. Le carré a son propre
 * fond : lisible dans tous les styles, en clair comme en sombre.
 */

/**
 * Police du nom de l'appli : une linéale du système, la même dans tous les styles d'installation (le nom fait partie de
 * l'identité de l'appli, proche du mot dessiné dans le logo), pas la police de l'interface (chasse fixe dans Actuel).
 */
export const BRAND_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/** Pictogramme de l'appli (décoratif : le nom est toujours écrit à côté). */
export function AppMark({ className = 'h-7 w-7' }: { className?: string }) {
  const { mark } = useAppBrand()
  return <img src={mark} alt="" width={28} height={28} className={`shrink-0 object-contain select-none ${className}`} draggable={false} />
}

/** Lockup horizontal : pictogramme + nom de l'appli écrit à côté (taille du texte selon le parent, du pictogramme selon mark). */
export function AppLockup({ mark = 'h-7 w-7', className = '' }: { mark?: string; className?: string }) {
  const { name } = useAppBrand()
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      <AppMark className={mark} />
      <span className="truncate font-extrabold tracking-[-0.01em]" style={{ fontFamily: BRAND_FONT }}>
        {name}
      </span>
    </span>
  )
}
