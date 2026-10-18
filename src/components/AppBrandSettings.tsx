import { useEffect, useRef, useState } from 'react'
import { remove, save, type ConfigItem } from '../db'
import { appBrand, useAppBrand } from '../appBrand'
import { APP_KEY, APP_NAME_MAX, appImagesOf, appNameOf, cleanAppBrand, DEFAULT_APP_NAME, isDefaultAppBrand, type AppBrand } from '../appBrandCore'
import { inform } from './Confirm'
import { shrinkLogo } from './StyleSettings'
import { BRAND_FONT } from './Brand'

/*
 * Réglages → Administration → « Appli : nom et logo » (administrateurs) : nom et logos de l'appli elle-même (Nextar par
 * défaut), pour qu'un changement de nom ne demande jamais de recoder. Enregistré dans la configuration partagée (clé
 * « appli », src/appBrandCore.ts), mêmes droits que le style de l'installation. Distinct de « Organisation : nom et logo »
 * (Style de l'installation), qui est celui de la fédération ou de la ligue.
 *
 * Ne suivent pas ce réglage (figés à la construction) : nom et icône de l'appli installée (manifeste), titre du tout premier
 * affichage (index.html).
 */
export function AppBrandSettings({ editable }: { editable: boolean }) {
  useAppBrand()
  const saved = appBrand()
  const sig = JSON.stringify(saved)
  const [draft, setDraft] = useState<AppBrand>(saved)
  const [busy, setBusy] = useState(false)
  // Changement reçu (autre appareil) : le brouillon repart de la valeur enregistrée.
  useEffect(() => setDraft(JSON.parse(sig) as AppBrand), [sig])
  const clean = cleanAppBrand(draft)
  const changed = JSON.stringify(clean) !== sig
  const img = appImagesOf(clean, import.meta.env.BASE_URL)

  async function apply(value: AppBrand) {
    setBusy(true)
    try {
      if (isDefaultAppBrand(value)) await remove('config', APP_KEY)
      else await save<ConfigItem>('config', { id: APP_KEY, key: APP_KEY, value })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] text-muted">
        Nom et logo de l’appli elle-même, partout où elle se nomme : en-tête, onglet du navigateur, connexion, textes de confidentialité et
        charte, documents édités, messages d’accès. Le nom et le logo de votre fédération se règlent dans Style de l’installation.
      </p>

      {/* Aperçu : en-tête (pictogramme + nom) et écran de connexion (logo complet). */}
      <div className="flex items-center gap-4 rounded-lg border border-line bg-panel-2 p-3">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[17px] leading-none">
          <img src={img.mark} alt="" className="h-7 w-7 shrink-0 object-contain" />
          <span className="truncate font-extrabold tracking-[-0.01em]" style={{ fontFamily: BRAND_FONT }}>
            {appNameOf(clean)}
          </span>
        </span>
        <img src={img.logo} alt="" className="h-14 w-14 shrink-0 object-contain" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="label" htmlFor="app-name">
          Nom de l’appli
        </label>
        <input
          id="app-name"
          className="field"
          disabled={!editable}
          maxLength={APP_NAME_MAX}
          placeholder={DEFAULT_APP_NAME}
          value={draft.name ?? ''}
          onChange={(e) => setDraft({ ...draft, name: e.target.value || undefined })}
        />
      </div>
      <LogoField
        label="Pictogramme (en-tête, petites tailles)"
        help="Carré, lisible en tout petit ; le nom est écrit à côté."
        value={draft.mark}
        editable={editable}
        onChange={(mark) => setDraft({ ...draft, mark })}
      />
      <LogoField
        label="Logo complet (écran de connexion)"
        help="Sans logo complet : le pictogramme. Réduits sur cet appareil (50 Ko au plus) ; SVG sûr, PNG, JPEG ou WebP."
        value={draft.logo}
        editable={editable}
        onChange={(logo) => setDraft({ ...draft, logo })}
      />

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {!isDefaultAppBrand(saved) && (
            <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void apply({})}>
              Revenir à {DEFAULT_APP_NAME}
            </button>
          )}
          {changed && (
            <>
              <button type="button" className="btn-ghost ml-auto px-3 py-1.5 text-xs" onClick={() => setDraft(saved)}>
                Annuler
              </button>
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void apply(clean)}>
                Appliquer à l’installation
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function LogoField({ label, help, value, editable, onChange }: { label: string; help: string; value?: string; editable: boolean; onChange: (v?: string) => void }) {
  const file = useRef<HTMLInputElement>(null)
  async function pick(f?: File) {
    if (!f) return
    const d = await shrinkLogo(f)
    if (!d) return inform('Image illisible, trop lourde ou SVG refusé. Choisis une petite image (SVG, PNG, JPEG ou WebP) ; un SVG ne doit contenir qu’un dessin (ni script ni lien externe).')
    onChange(d)
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2">
          {value ? <img src={value} alt="" className="max-h-10 max-w-10 object-contain" /> : <span className="text-[10px] text-muted">défaut</span>}
        </span>
        {editable && (
          <>
            <button type="button" className="btn-ghost text-xs" onClick={() => file.current?.click()}>
              Choisir une image
            </button>
            {value && (
              <button type="button" className="btn-ghost text-xs" onClick={() => onChange(undefined)}>
                Retirer
              </button>
            )}
            <input ref={file} type="file" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          </>
        )}
      </div>
      <p className="text-[11px] text-muted">{help}</p>
    </div>
  )
}
