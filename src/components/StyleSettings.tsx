import { useEffect, useRef, useState } from 'react'
import { remove, save, type ConfigItem } from '../db'
import { inform } from './Confirm'
import { SectionTitle } from './ui'
import {
  AUTO,
  currentAppearance,
  DARK_CHOICE,
  installationAppearance,
  LIGHT_CHOICE,
  previewAppearance,
  readPersonalStyle,
  readThemeChoice,
  resolveTheme,
  setPersonalStyle,
  setThemeChoice,
  THEMES,
  useThemeVersion,
  type Theme,
} from '../theme'
import { APPEARANCE_KEY, cleanAppearance, DEFAULT_STYLE, LOGO_MAX_CHARS, NAME_MAX, paletteOf, STYLES, styleById, svgDataUrl, svgLogoSafe, type Appearance, type UiStyle } from '../uiStyle'

/*
 * Réglages → Apparence (chacun) et Style de l'installation (administrateurs).
 *
 * Style de l'installation (src/uiStyle.ts) : choisi par l'organisation, enregistré dans la configuration partagée (table
 * hb_config, clé « apparence », mêmes droits que « Structure et sport » : administrateurs). Avant d'appliquer, l'aperçu
 * montre le style sur cet appareil seulement ; il s'arrête en quittant l'écran.
 */

/** Résumé de la rubrique Apparence. */
export function appearanceSummary() {
  const c = readThemeChoice()
  const t = resolveTheme(c)
  const s = styleById(currentAppearance().style)
  if (s.id === 'actuel') return c === AUTO ? `Auto (${t.label})` : t.label
  return `${s.label} · ${c === AUTO ? `Auto (${t.light ? 'clair' : 'sombre'})` : t.light ? 'Clair' : 'Sombre'}`
}

/**
 * Apparence de chacun, gardée sur cet appareil : son style (ou celui de l'installation), puis, style Actuel, les six
 * thèmes ; autre style, Clair / Sombre / Auto.
 */
export function AppearanceSettings() {
  useThemeVersion()
  const s = styleById(currentAppearance().style)
  return (
    <>
      <PersonalStylePicker />
      {s.id === 'actuel' ? <ThemePicker /> : <ModePicker style={s} />}
    </>
  )
}

/** Choix du style par la personne : celui de l'installation (par défaut) ou un des quatre. */
function PersonalStylePicker() {
  const mine = readPersonalStyle()
  const org = styleById(installationAppearance().style)
  const light = resolveTheme(readThemeChoice()).light
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>Style</SectionTitle>
      <button
        type="button"
        onClick={() => setPersonalStyle(null)}
        aria-pressed={!mine}
        className={`rounded-lg border p-2 text-left text-xs ${!mine ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
      >
        <span className="block font-bold">Celui de l’installation</span>
        <span className="text-[10px] text-muted">{org.label}, choisi par l’organisation</span>
      </button>
      <div className="grid grid-cols-2 gap-2">
        {STYLES.map((st) => (
          <StyleTile key={st.id} s={st} on={mine === st.id} light={light} onPick={() => setPersonalStyle(st.id)} />
        ))}
      </div>
      <p className="text-[11px] text-muted">Ton style est gardé sur cet appareil ; il ne change rien pour les autres.</p>
    </section>
  )
}

/** Choix du thème (style Actuel) : chaque vignette montre ses couleurs. */
function ThemePicker() {
  const choice = readThemeChoice()
  const tile = (id: string, label: string, t: Theme) => (
    <button
      key={id}
      onClick={() => setThemeChoice(id)}
      className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs ${choice === id ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
    >
      <span className="flex h-9 w-12 shrink-0 flex-col justify-between overflow-hidden rounded-md border p-1" style={{ background: t.colors.bg, borderColor: t.colors.line }}>
        <span className="h-2 rounded-sm" style={{ background: t.colors.panel }} />
        <span className="flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm" style={{ background: t.colors.accent }} />
          <span className="h-1 flex-1 rounded-sm" style={{ background: t.colors.muted }} />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold">{label}</span>
        <span className="text-[10px] text-muted">{id === AUTO ? 'suit le téléphone' : [t.light ? 'clair' : 'sombre', t.note].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  )
  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {tile(AUTO, 'Auto', resolveTheme(AUTO))}
        {THEMES.map((t) => tile(t.id, t.label, t))}
      </div>
      <p className="text-[11px] text-muted">Le thème est gardé sur cet appareil. « Auto » passe en Clair ou en Nuit selon le réglage du téléphone.</p>
    </section>
  )
}

/** Clair / Sombre / Auto pour un style de l'installation (les thèmes clairs donnent la version claire, les sombres la sombre). */
function ModePicker({ style }: { style: UiStyle }) {
  const choice = readThemeChoice()
  const cur = choice === AUTO ? AUTO : resolveTheme(choice).light ? LIGHT_CHOICE : DARK_CHOICE
  const opts: { id: string; label: string; note: string; light: boolean }[] = [
    { id: AUTO, label: 'Auto', note: 'suit le téléphone', light: resolveTheme(AUTO).light },
    { id: LIGHT_CHOICE, label: 'Clair', note: 'fond clair', light: true },
    { id: DARK_CHOICE, label: 'Sombre', note: 'fond sombre', light: false },
  ]
  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {opts.map((o) => {
          const p = paletteOf(style, o.light)!
          return (
            <button
              key={o.id}
              onClick={() => setThemeChoice(o.id)}
              aria-pressed={cur === o.id}
              className={`flex flex-col items-start gap-1.5 rounded-lg border p-2 text-left text-xs ${cur === o.id ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
            >
              <span className="flex h-8 w-full flex-col justify-between overflow-hidden rounded-md border p-1" style={{ background: p.bg, borderColor: p.line }}>
                <span className="h-2 rounded-sm" style={{ background: p.panel }} />
                <span className="flex items-center gap-1">
                  <span className="h-2 w-4 rounded-sm" style={{ background: p.brand }} />
                  <span className="h-1 flex-1 rounded-sm" style={{ background: p.muted }} />
                </span>
              </span>
              <span className="block font-bold">{o.label}</span>
              <span className="text-[10px] text-muted">{o.note}</span>
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-muted">
        Style <b>{style.label}</b>. Clair, Sombre ou Auto : gardé sur cet appareil.
      </p>
    </section>
  )
}

/** Vignette d'aperçu d'un style : fond, carte, bloc mis en avant, titre dans sa police, arrondis. */
function StyleTile({ s, on, light, onPick }: { s: UiStyle; on: boolean; light: boolean; onPick: () => void }) {
  const t = resolveTheme(light ? LIGHT_CHOICE : DARK_CHOICE)
  const p = paletteOf(s, light)
  const c = p ?? { bg: t.colors.bg, panel: t.colors.panel, line: t.colors.line, muted: t.colors.muted, fg: t.colors.fg, accent: t.colors.accent, onAccent: '#ffffff' }
  const emph = p ? p.emph : { bg: `color-mix(in srgb, ${t.colors.accent} 15%, ${t.colors.panel})`, fg: t.colors.fg, accent: t.colors.accent }
  const r = s.radius ?? { sm: '0.25rem', md: '0.375rem', lg: '0.5rem' }
  const head = s.fonts?.heading ?? 'var(--font-mono)'
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left text-xs ${on ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
    >
      <span className="flex w-full flex-col gap-1 overflow-hidden border p-1.5" style={{ background: c.bg, borderColor: c.line, borderRadius: r.lg, color: c.fg }}>
        <span
          className="block truncate text-[13px] leading-tight font-extrabold"
          style={{ fontFamily: head, textTransform: s.upperHeadings ? 'uppercase' : undefined, color: c.fg }}
        >
          Bilan
        </span>
        <span className="flex items-center gap-1 px-1.5 py-1" style={{ background: emph.bg, color: emph.fg, borderRadius: r.md }}>
          <span className="text-[11px] font-extrabold" style={{ fontFamily: s.fonts?.figures ?? 'var(--font-mono)', color: emph.accent }}>
            86 %
          </span>
          <span className="h-1 flex-1 rounded-full" style={{ background: emph.fg, opacity: 0.4 }} />
        </span>
        <span className="flex items-center gap-1">
          <span className="px-1.5 text-[9px] font-bold" style={{ background: p ? (p.primary ?? p.brand) : c.accent, color: p ? (p.onPrimary ?? p.onBrand) : c.onAccent, borderRadius: r.sm }}>
            OK
          </span>
          <span className="h-3 flex-1 border" style={{ background: c.panel, borderColor: c.line, borderRadius: r.sm }} />
        </span>
      </span>
      <span className="block font-bold">{s.label}</span>
      <span className="text-[10px] leading-snug text-muted">{s.note}</span>
      {s.fonts && <span className="text-[10px] text-muted">{s.fonts.names}</span>}
    </button>
  )
}

/** Image choisie → petit logo (data URL ≤ LOGO_MAX_CHARS), réduit sur l'appareil. */
export async function shrinkLogo(file: File): Promise<string | null> {
  // SVG : gardé tel quel (net à toutes les tailles), seulement s'il est sûr et léger (blancs entre balises retirés).
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    try {
      const text = (await file.text()).replace(/>\s+</g, '><').trim()
      if (!svgLogoSafe(text)) return null
      const d = svgDataUrl(text)
      return d.length <= LOGO_MAX_CHARS ? d : null
    } catch {
      return null
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    for (const [w, h] of [
      [320, 96],
      [240, 72],
      [160, 48],
    ]) {
      const k = Math.min(1, w / img.naturalWidth, h / img.naturalHeight)
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, Math.round(img.naturalWidth * k))
      cv.height = Math.max(1, Math.round(img.naturalHeight * k))
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
      for (const [type, q] of [
        ['image/png', undefined],
        ['image/webp', 0.9],
        ['image/webp', 0.75],
      ] as const) {
        const d = cv.toDataURL(type, q)
        if (d.startsWith(`data:${type}`) && d.length <= LOGO_MAX_CHARS) return d
      }
    }
    return null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Style de l'installation (administrateurs) : 4 vignettes, puis nom et logo de l'organisation (accueil). Choisir montre l'aperçu sur cet
 * appareil ; « Appliquer à l'installation » l'enregistre pour tous (synchronisé).
 */
export function InstallationStyle({ editable }: { editable: boolean }) {
  useThemeVersion()
  const saved = installationAppearance()
  const [draft, setDraft] = useState<Appearance>(saved)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const sig = JSON.stringify(saved)
  // Changement reçu (autre appareil) : le brouillon repart de la valeur enregistrée.
  useEffect(() => setDraft(JSON.parse(sig) as Appearance), [sig])
  const changed = JSON.stringify(cleanAppearance(draft)) !== sig
  // Aperçu tant que le brouillon diffère ; arrêté en quittant l'écran.
  useEffect(() => {
    previewAppearance(changed ? cleanAppearance(draft) : null)
  }, [draft, changed])
  useEffect(() => () => previewAppearance(null), [])
  const light = resolveTheme(readThemeChoice()).light

  async function apply() {
    const value = cleanAppearance(draft)
    setBusy(true)
    try {
      if (value.style === DEFAULT_STYLE && !value.name && !value.logo) await remove('config', APPEARANCE_KEY)
      else await save<ConfigItem>('config', { id: APPEARANCE_KEY, key: APPEARANCE_KEY, value })
    } finally {
      setBusy(false)
    }
  }

  async function pickLogo(f?: File) {
    if (!f) return
    const d = await shrinkLogo(f)
    if (!d) return inform('Image illisible, trop lourde ou SVG refusé. Choisis un petit logo (SVG, PNG, JPEG ou WebP) ; un SVG ne doit contenir qu’un dessin (ni script ni lien externe).')
    setDraft({ ...draft, logo: d })
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <SectionTitle info="Polices, arrondis, titres, blocs mis en avant et couleurs de toute l’appli, pour tous les comptes de l’installation. Chacun garde ensuite son choix Clair / Sombre / Auto (Apparence).">
        Style de l’installation
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 side:grid-cols-2 xl:grid-cols-4">
        {STYLES.map((s) => (
          <StyleTile key={s.id} s={s} light={light} on={draft.style === s.id} onPick={() => editable && setDraft({ ...draft, style: s.id })} />
        ))}
      </div>
      {/* Identité de l'organisation (fédération, ligue…), distincte de celle de l'appli (Nextar, fixe : src/components/Brand.tsx). */}
      <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-3">
        <h3 className="text-sm font-bold">Organisation : nom et logo</h3>
        <p className="text-[11px] text-muted">Par exemple le logo de votre fédération ; affiché sur l’accueil et les rapports.</p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="label" htmlFor="style-name">
          Nom de l’organisation
        </label>
        <input
          id="style-name"
          className="field"
          disabled={!editable}
          maxLength={NAME_MAX}
          placeholder="Sinon : l’unité au sommet de la structure"
          value={draft.name ?? ''}
          onChange={(e) => setDraft({ ...draft, name: e.target.value || undefined })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="label">Logo de l’organisation (facultatif)</span>
        <div className="flex items-center gap-3">
          {/* Fond blanc, comme sur l'accueil. */}
          <span className="flex h-12 w-24 shrink-0 items-center justify-center rounded-md border border-line bg-white">
            {draft.logo ? <img src={draft.logo} alt="Logo" className="max-h-10 max-w-22 object-contain" /> : <span className="text-[10px] text-neutral-500">aucun</span>}
          </span>
          {editable && (
            <>
              <button type="button" className="btn-ghost text-xs" onClick={() => file.current?.click()}>
                Choisir une image
              </button>
              {draft.logo && (
                <button type="button" className="btn-ghost text-xs" onClick={() => setDraft({ ...draft, logo: undefined })}>
                  Retirer
                </button>
              )}
              <input ref={file} type="file" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pickLogo(e.target.files?.[0])} />
            </>
          )}
        </div>
        <p className="text-[11px] text-muted">Réduit sur cet appareil (50 Ko au plus), montré en grand sur l’accueil, sur fond blanc. SVG ou PNG carré de préférence.</p>
      </div>
      {changed && editable && (
        <div className="sticky bottom-[calc(var(--nav-b)+0.5rem)] flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-panel p-2 text-xs shadow-lg">
          <span className="min-w-0 flex-1">
            Aperçu sur cet appareil : <b>{styleById(draft.style).label}</b>. Les autres comptes ne voient rien tant que ce n’est pas appliqué.
          </span>
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setDraft(saved)}>
            Annuler
          </button>
          <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void apply()}>
            Appliquer à l’installation
          </button>
        </div>
      )}
    </section>
  )
}
