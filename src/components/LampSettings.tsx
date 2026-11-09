import { useEffect, useState } from 'react'
import { save, TRIAL, type ConfigItem } from '../db'
import { CATALOGUE_MAX, cleanLampSettings, CRITERIA_MAX, LAMP_KEY, lampSettingsValue, pctText, type LampSettings, type Zone } from '../lamp'
import { supabase } from '../sync'
import { useLampSettings } from './LampStaff'
import { SectionTitle } from './ui'

/*
 * Réglages → « Lampe d'Aladin » (administrateurs ; src/lamp.ts, supabase/074_lampe.sql) : ouverture sur l'installation,
 * premier jour compté (lancement en cours de saison), zone des vacances par défaut, pont de l'Ascension, libellés des critères
 * des encadrants, catalogue des vœux (« offert par … » facultatif). Enregistré dans la configuration de l'installation
 * (hb_config, clé « lampe »), comme les autres réglages (hb_upsert inchangé). Les nombres (30 % par trimestre, plafond 90 %,
 * bonus 1 %, encadrants 10 %) sont rappelés ici ; ils se changent dans le réglage (clé « regles ») si le pôle le décide.
 */

export function LampSettingsEditor({ editable }: { editable: boolean }) {
  const current = useLampSettings()
  const base = JSON.stringify(lampSettingsValue(current))
  const [d, setD] = useState<LampSettings>(current)
  const [msg, setMsg] = useState('')
  useEffect(() => setD(current), [base]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(lampSettingsValue(cleanLampSettings(lampSettingsValue(d)))) !== base
  const r = d.rules
  const set = (patch: Partial<LampSettings>) => (setMsg(''), setD({ ...d, ...patch }))

  async function submit() {
    const value = lampSettingsValue(cleanLampSettings(lampSettingsValue(d)))
    await save<ConfigItem>('config', { id: LAMP_KEY, key: LAMP_KEY, value })
    setMsg('Enregistré.')
  }

  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="reglage-lampe">
      <SectionTitle
        info={
          <>
            Jauge de la saison de l’espace joueur : une journée de classe s’allume quand le jeune a fait son wellness, noté sa séance et rempli son cahier du hand. Le jeune ne voit que sa
            propre lampe ; le staff du groupe voit « Lampes du groupe ». Elle suit le wellness : sans wellness ouvert, pas de lampe.
          </>
        }
      >
        Lampe d’Aladin
      </SectionTitle>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={d.actif} disabled={!editable || TRIAL || !supabase} onChange={(e) => set({ actif: e.target.checked })} />
        Ouverte sur l’installation
        {(TRIAL || !supabase) && <span className="text-[11px] text-muted">(mode essai : toujours ouverte)</span>}
      </label>
      <p className="text-[11px] text-muted">
        Règles : 3 trimestres à {pctText(r.trimesterShare)} (journées allumées / jours demandés), + {pctText(r.weekendBonus)} par cahier de match après une semaine complète
        (assiduité plafonnée à {pctText(r.diligenceCap)}), + {pctText(r.coachShare)} des encadrants ({r.coachPointsMax} points par critère). Cahier du hand : {r.cahierMinFields} question
        {r.cahierMinFields > 1 ? 's' : ''} sur 3.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Premier jour compté</span>
          <input type="date" className="field min-h-11 w-full" disabled={!editable} value={d.debut ?? ''} onChange={(e) => set({ debut: e.target.value || undefined })} />
          <span className="text-[10px] text-muted">Vide : la rentrée. Pour un lancement en cours de saison.</span>
        </label>
        <label className="block">
          <span className="label">Zone des vacances par défaut</span>
          <select className="field min-h-11 w-full" disabled={!editable} value={d.zone ?? ''} onChange={(e) => set({ zone: (e.target.value || undefined) as Zone | undefined })}>
            <option value="">D’après le site du pôle</option>
            <option value="A">Zone A</option>
            <option value="B">Zone B</option>
            <option value="C">Zone C</option>
          </select>
          <span className="text-[10px] text-muted">Utilisée quand la zone du site n’est pas connue.</span>
        </label>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={d.pont} disabled={!editable} onChange={(e) => set({ pont: e.target.checked })} />
        Pont de l’Ascension compté comme vacances
      </label>

      <div>
        <span className="label">Critères des encadrants</span>
        <ul className="flex flex-col gap-1.5">
          {d.criteria.map((c, i) => (
            <li key={c.key} className="flex gap-2">
              <input
                className="field min-h-11 min-w-0 flex-1"
                maxLength={40}
                disabled={!editable}
                aria-label={`Critère ${i + 1}`}
                value={c.label}
                onChange={(e) => set({ criteria: d.criteria.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              />
              {editable && d.criteria.length > 1 && (
                <button className="btn-ghost min-h-11 px-3 text-xs" onClick={() => set({ criteria: d.criteria.filter((_, j) => j !== i) })}>
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && d.criteria.length < CRITERIA_MAX && (
          <button className="btn-soft mt-1.5 min-h-11 px-3 text-xs" onClick={() => set({ criteria: [...d.criteria, { key: `critere-${Date.now().toString(36)}`, label: '' }] })}>
            + Critère
          </button>
        )}
      </div>

      <div>
        <span className="label">Catalogue des vœux</span>
        <ul className="flex flex-col gap-2">
          {d.catalogue.map((w, i) => (
            <li key={w.id} className="flex flex-col gap-1 rounded-lg border border-line p-2 sm:flex-row">
              <input
                className="field min-h-11 min-w-0 flex-1"
                maxLength={100}
                disabled={!editable}
                aria-label={`Vœu ${i + 1}`}
                value={w.label}
                onChange={(e) => set({ catalogue: d.catalogue.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              />
              <input
                className="field min-h-11 min-w-0 sm:w-48"
                maxLength={60}
                disabled={!editable}
                placeholder="Offert par… (facultatif)"
                aria-label={`Offert par (vœu ${i + 1})`}
                value={w.by ?? ''}
                onChange={(e) => set({ catalogue: d.catalogue.map((x, j) => (j === i ? { ...x, by: e.target.value || undefined } : x)) })}
              />
              {editable && (
                <button className="btn-ghost min-h-11 px-3 text-xs" onClick={() => set({ catalogue: d.catalogue.filter((_, j) => j !== i) })}>
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && d.catalogue.length < CATALOGUE_MAX && (
          <button className="btn-soft mt-1.5 min-h-11 px-3 text-xs" onClick={() => set({ catalogue: [...d.catalogue, { id: `voeu-${Date.now().toString(36)}`, label: '' }] })}>
            + Vœu
          </button>
        )}
        <p className="mt-1 text-[10px] text-muted">Mineurs : la marque figure sur le lot seulement ; aucune publicité ciblée, aucune donnée partagée avec celui qui offre.</p>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary min-h-11 px-5" disabled={!dirty} onClick={() => void submit()}>
            Enregistrer
          </button>
          {msg && <span className="text-[11px] text-emerald-300">{msg}</span>}
        </div>
      )}
    </section>
  )
}
