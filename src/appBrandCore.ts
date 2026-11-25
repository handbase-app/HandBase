/*
 * Identité de l'appli (nom, logo, pictogramme), réglable par les administrateurs pour ne jamais recoder un changement de
 * nom : Réglages → Administration → « Appli : nom et logo ». Configuration partagée, table hb_config, clé « appli »
 * (supabase/044_structure.sql : toute clé en minuscules est acceptée, administrateurs seulement), valeur
 * { name?, logo?, mark? }. Rien de réglé, ou valeur illisible : Nextar (nom et logos fournis dans public/brand/).
 *
 * Distincte de l'identité de l'organisation (fédération, ligue… : clé « apparence », src/uiStyle.ts), montrée sur l'accueil.
 *
 * Fichier pur (ni Dexie ni React ni document) : testé par tools/test-appbrand.ts. L'état et l'affichage sont dans
 * src/appBrand.ts.
 */
import { logoOk } from './uiStyle'

/** Clé de la configuration de l'installation. */
export const APP_KEY = 'appli'
/** Nom par défaut de l'appli. */
export const DEFAULT_APP_NAME = 'Nextar'
export const APP_NAME_MAX = 30

export interface AppBrand {
  /** Nom de l'appli (sinon Nextar). */
  name?: string
  /** Logo complet (data URL PNG, JPEG, WebP ou SVG sûr : logoOk), pour l'écran de connexion. */
  logo?: string
  /** Pictogramme pour les petites tailles, à côté du nom écrit (en-tête). */
  mark?: string
}

/** Valeur lue (configuration, copie locale) → identité propre : champs invalides ignorés, nom nettoyé. */
export function cleanAppBrand(v: unknown): AppBrand {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const o = v as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, APP_NAME_MAX).trim() : ''
  const logo = typeof o.logo === 'string' && logoOk(o.logo) ? o.logo : undefined
  const mark = typeof o.mark === 'string' && logoOk(o.mark) ? o.mark : undefined
  return { ...(name ? { name } : {}), ...(logo ? { logo } : {}), ...(mark ? { mark } : {}) }
}

/** Lignes de hb_config (non supprimées) → identité de l'appli. */
export function resolveAppBrand(rows: readonly { id: string; key?: string; value: unknown; deleted?: boolean }[] = []): AppBrand {
  const row = rows.find((r) => !r.deleted && (r.key ?? r.id) === APP_KEY)
  return row ? cleanAppBrand(row.value) : {}
}

/** Rien de réglé : l'identité par défaut (Nextar). */
export const isDefaultAppBrand = (b: AppBrand) => !b.name && !b.logo && !b.mark

/** Nom affiché de l'appli. */
export const appNameOf = (b: AppBrand) => b.name || DEFAULT_APP_NAME

/**
 * Images à afficher : logo complet et pictogramme ; défauts = fichiers Nextar (base = import.meta.env.BASE_URL). Logo complet
 * par défaut : l'icône de l'appli (icon.svg : le mot « Nextar » et le nom du sport dessous), celle du sport de la
 * construction (public/ pour le handball, public-sport/<sport>/ sinon : vite.config.ts, tools/icones-sport.py).
 */
export function appImagesOf(b: AppBrand, base = '/') {
  const picto = `${base}brand/nextar-pictogramme.svg`
  // Pictogramme : le sien ; sinon le logo réglé (un logo seul suffit) ; sinon le pictogramme Nextar.
  const mark = b.mark ?? b.logo ?? picto
  // Logo complet : le sien ; sinon le pictogramme réglé ; sinon l'icône Nextar du sport, qui porte le mot « Nextar » :
  // seulement si l'appli s'appelle encore Nextar (autre nom sans logo : le pictogramme seul).
  const logo = b.logo ?? b.mark ?? (appNameOf(b).toLowerCase() === DEFAULT_APP_NAME.toLowerCase() ? `${base}icon.svg` : picto)
  return { logo, mark }
}

/** Nom de l'appli pour un nom de fichier : minuscules, sans accent ni espace (« Nextar » → « nextar »). */
export function appSlugOf(b: AppBrand) {
  const s = appNameOf(b)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'nextar'
}
