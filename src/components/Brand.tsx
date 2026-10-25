import { useAppBrand } from '../appBrand'

/*
 * Identité de l'appli à l'écran : Nextar par défaut, réglable par les administrateurs (Réglages → Administration → « Appli :
 * nom et logo » ; src/appBrandCore.ts). Distincte de celle de l'organisation qui l'utilise (fédération, ligue… : nom et
 * logo de Réglages → Style de l'installation, affichés sur l'accueil).
 *
 * Logos par défaut (25/10/2026 : « Next Star », le X du nom est une étoile filante) : public/brand/nextar.svg (le mot
 * Nextar dans son carré bleu nuit) et public/brand/nextar-pictogramme.svg (le X et l'étoile seuls, carré arrondi bleu nuit) pour les petites tailles, à côté du nom écrit en texte. Le carré a son propre
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

/** Étoile filante du logo Nextar (public/brand/nextar-pictogramme.svg, X + étoile), seule : bouton « Demander » de l'en-tête. Couleur : currentColor. */
export function NextarStar({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="250 86 164 166" className={`shrink-0 ${className}`} aria-hidden fill="currentColor">
      <path d="M407.71,131.10 L351.49,137.70 L318.78,91.51 L307.70,147.01 L253.65,163.85 L303.01,191.54 L302.32,248.14 L343.92,209.76 L397.53,227.90 L373.88,176.48Z" stroke="currentColor" strokeWidth="6.9" strokeLinejoin="round" />
    </svg>
  )
}
