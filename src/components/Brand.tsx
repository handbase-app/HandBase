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

/** Étoile du logo Nextar (public/brand/nextar-pictogramme.svg), seule : bouton « Demander » de l'en-tête. Couleur : currentColor. */
export function NextarStar({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="375 76 90 84" className={`shrink-0 ${className}`} aria-hidden fill="currentColor">
      <path d="m 421.01323,80.131085 c 2.50032,2.357978 8.51964,24.419875 9.76319,28.742825 10.09394,0.0406 20.17464,0 30.25534,-0.10846 -7.59359,5.59679 -17.37004,12.6978 -24.34186,18.85019 3.04274,9.79776 6.03255,19.59553 8.95622,29.40686 -7.83172,-5.51549 -16.33814,-12.26416 -24.03757,-18.11843 -2.51357,0.90796 -20.61121,15.21839 -24.52708,18.14553 3.33378,-9.13375 6.70724,-20.62545 9.74997,-30.03023 -8.14923,-5.66453 -16.11325,-11.64076 -23.82591,-17.91513 9.47216,0.13551 19.619,-0.14907 29.1573,-0.23037 3.06921,-9.201497 5.97964,-19.405823 8.8504,-28.742826 z" />
    </svg>
  )
}
