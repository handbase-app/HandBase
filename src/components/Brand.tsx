import { useId } from 'react'
import { useAppBrand } from '../appBrand'

/*
 * Identité de l'appli à l'écran : Nextar par défaut, réglable par les administrateurs (Réglages → Administration → « Appli :
 * nom et logo » ; src/appBrandCore.ts). Distincte de celle de l'organisation qui l'utilise (fédération, ligue… : nom et
 * logo de Réglages → Style de l'installation, affichés sur l'accueil).
 *
 * Logos par défaut (25/10/2026 : « Next Star », le X du nom est une étoile filante) : public/brand/nextar.svg (le mot
 * Nextar dans son carré bleu nuit) et public/brand/nextar-pictogramme.svg (le X et l'étoile seuls, carré arrondi bleu nuit) pour les petites tailles, à côté du nom écrit en texte. Le carré a son propre
 * fond : lisible dans tous les styles, en clair comme en sombre.
 *
 * Un logo par sport (25/10/2026, « proposition A ») : le même logo, le nom du sport écrit dessous en menthe. Icônes de
 * l'appli et logo de l'écran de connexion : icon.svg et ses PNG, du sport de la construction (tools/icones-sport.py,
 * vite.config.ts) ; écran d'ouverture : index.html ; capsule « Demander » : le mot dessiné puis le sport en texte
 * (src/components/Demander.tsx). Les favicons et le pictogramme restent sans texte, les mêmes pour tous les sports.
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

/**
 * Le mot « Nextar » du logo (le X est une étoile filante), en ligne : bouton « Demander » de l'en-tête. Lettres en
 * currentColor (suivent le thème), traînée et étoile aux couleurs du logo. `spin` : l'étoile tourne (demande en cours).
 */
export function NextarWordmark({ className = 'h-5', spin = false }: { className?: string; spin?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="50 60 870 215" className={`w-auto shrink-0 ${className}`} aria-hidden>
      <defs>
        <linearGradient id={`c${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#61D0D1" stopOpacity="0" />
          <stop offset="0.6" stopColor="#61D0D1" stopOpacity="0.85" />
          <stop offset="1" stopColor="#89F7B3" />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#89F7B3" />
          <stop offset="1" stopColor="#61D0D1" />
        </linearGradient>
      </defs>
      <path
        fill="currentColor"
        d="M61.68 262H97.3V122.38L177.64 262H217.42V69.86H181.8V209.74L102.24 69.86H61.68Z M393.18 205.32C394.22 200.12 394.48 197 394.48 191.8C394.48 147.34 363.02 114.58 320.12 114.58C277.74 114.58 244.2 148.12 244.2 190.5C244.2 232.62 278.26 265.38 322.2 265.38C345.86 265.38 364.32 256.8 379.4 239.38C384.86 232.62 388.5 226.64 390.84 219.36H353.14C344.3 229.76 335.72 233.66 321.42 233.66C300.88 233.66 285.8 222.74 281.64 205.32ZM280.6 174.9C286.06 156.18 300.1 146.3 320.64 146.3C341.96 146.3 356 156.44 360.42 174.9Z M598.32 262H632.9V149.42H653.7V117.96H632.9V69.86H598.32V117.96H581.42V149.42H598.32Z M816.98 117.96H785.26V137.2C773.3 121.34 759 114.58 738.2 114.58C695.56 114.58 664.88 146.56 664.88 190.5C664.88 233.92 695.3 265.38 737.42 265.38C757.7 265.38 771.48 259.14 785.26 243.28V262H816.98ZM741.84 146.3C766.54 146.3 784.22 164.76 784.22 191.02C784.22 201.42 780.06 213.38 773.82 220.66C766.8 229.24 755.62 233.66 742.36 233.66C717.14 233.66 699.72 216.5 699.72 191.28C699.72 165.02 717.14 146.3 741.84 146.3Z M842.72 262H877.3V181.92C876.52 160.6 887.44 148.64 908.24 147.86V114.58H905.64C890.82 114.58 883.54 118.74 874.44 132V117.96H842.72Z M403.1,118.0 h43.2 L559.1,262.0 h-43.2 Z"
      />
      <path d="M406.66,260.20 L557.88,138.67 A18.91,18.91 0 0 0 531.43,111.65 L406.66,260.20Z" fill={`url(#c${id})`} />
      <path
        className={spin ? 'wait-spin' : undefined}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        d="M589.56,99.23 L554.36,103.37 L533.87,74.44 L526.93,109.20 L493.09,119.74 L524.00,137.09 L523.56,172.53 L549.62,148.49 L583.19,159.86 L568.38,127.66Z"
        fill={`url(#s${id})`}
        stroke={`url(#s${id})`}
        strokeWidth="4.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Pictogramme Nextar en ligne (public/brand/nextar-pictogramme.svg : X et étoile filante sur le carré bleu nuit) : bouton
 * « Demander » du menu de gauche sur téléphone couché (AskButton, src/components/Demander.tsx). `spin` : l'étoile tourne
 * (demande en cours), le carré reste immobile.
 */
export function NextarPictogram({ className = 'h-9 w-9', spin = false }: { className?: string; spin?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 512 512" className={`shrink-0 ${className}`} aria-hidden>
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0A182D" />
          <stop offset="1" stopColor="#1A3C46" />
        </linearGradient>
        <linearGradient id={`c${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#61D0D1" stopOpacity="0" />
          <stop offset="0.6" stopColor="#61D0D1" stopOpacity="0.85" />
          <stop offset="1" stopColor="#89F7B3" />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#89F7B3" />
          <stop offset="1" stopColor="#61D0D1" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="72" fill={`url(#b${id})`} />
      <path d="M129.0,161.0 h69.0 L359.0,391.0 h-69.0 Z" fill="#F9F9FA" />
      <path d="M134.75,388.12 L358.07,193.10 A30.19,30.19 0 0 0 313.93,151.90 L134.75,388.12Z" fill={`url(#c${id})`} />
      <path
        className={spin ? 'wait-spin' : undefined}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        d="M407.71,131.10 L351.49,137.70 L318.78,91.51 L307.70,147.01 L253.65,163.85 L303.01,191.54 L302.32,248.14 L343.92,209.76 L397.53,227.90 L373.88,176.48Z"
        fill={`url(#s${id})`}
        stroke={`url(#s${id})`}
        strokeWidth="6.9"
        strokeLinejoin="round"
      />
    </svg>
  )
}
