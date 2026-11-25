import { useEffect, useMemo, useState } from 'react'
import { today, type Player } from '../db'
import { useSportConfig } from '../installation'
import { cleanUsualTeam, LEVELS, sameTeam, seasonCategory, TEAM_NUMBERS, upperCategories, type UsualTeam } from '../rencontres'
import { saveMyTeam } from '../rencontresApi'
import { isPlayerRole, useRole } from '../roles'
import { sportContent } from '../sportContent'
import { supabase } from '../sync'
import { useUnsaved } from './Confirm'
import { Segmented, SectionTitle } from './ui'

/*
 * « Mon équipe » sur la page du jeune (/moi, src/pages/Me.tsx) : son équipe dans sa catégorie (1, 2 ou 3), le niveau, et la
 * catégorie où il joue s'il est surclassé. Enregistrée par le serveur (hb_player_set_team, supabase/056_rencontres.sql :
 * seule la clé usualTeam de SA fiche) ; le staff voit « U15 · Équipe 1 · Régional » sur la fiche et s'en sert pour
 * « Autour de moi ». Script pas encore passé : message clair, rien n'est perdu (le choix reste à l'écran).
 * Sans serveur (essai, local) : sur l'appareil seulement. Aperçu d'un administrateur avec le serveur : lecture seule.
 */
export function MyTeamCard({ p, canWrite }: { p: Player; canWrite: boolean }) {
  const role = useRole()
  const cats = sportContent(useSportConfig().sport).youthCategories
  const codes = useMemo(() => cats.map((c) => c.code), [cats])
  const saved = useMemo(() => cleanUsualTeam(p.usualTeam, codes), [p.usualTeam, codes])
  const [form, setForm] = useState<Pick<UsualTeam, 'n' | 'level' | 'playsIn'>>(saved)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const dirty = !sameTeam(form, saved)
  useUnsaved(dirty && canWrite)
  // La fiche change ailleurs (synchronisation, encadrant) sans choix en cours : on suit.
  useEffect(() => {
    if (!dirty) setForm(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])
  const own = seasonCategory(p.birthDate, today(), cats)
  // Surclassement : seulement les catégories au-dessus de la sienne (ou le choix déjà fait).
  const upper = upperCategories(own, cats, form.playsIn)
  const set = (patch: Partial<Pick<UsualTeam, 'n' | 'level' | 'playsIn'>>) => {
    setMsg(null)
    setForm((f) => cleanUsualTeam({ ...f, ...patch }, codes))
  }

  async function save() {
    if (!canWrite || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await saveMyTeam(p.id, form, isPlayerRole(role) && !!supabase)
      if (!r.ok) return setMsg({ ok: false, text: r.error })
      setForm(cleanUsualTeam(r.value, codes))
      setMsg({ ok: true, text: 'Enregistré, ton encadrant le voit.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="mon-equipe">
      <SectionTitle info="Ton équipe en championnat cette saison : ton encadrant sait ainsi où te voir jouer. Toucher à nouveau un choix l’efface.">Mon équipe</SectionTitle>
      {p.usualTeam?.src === 'staff' && !dirty && (p.usualTeam.n || p.usualTeam.level || p.usualTeam.playsIn) && (
        <p className="-mt-1 text-[11px] text-muted">Renseigné par ton encadrant : tu peux le corriger.</p>
      )}
      <div>
        <span className="label">Mon équipe{own ? ` en ${form.playsIn ?? own}` : ''}</span>
        <Segmented
          value={form.n ? String(form.n) : undefined}
          onChange={(v) => canWrite && set({ n: Number(v) === form.n ? undefined : (Number(v) as UsualTeam['n']) })}
          options={TEAM_NUMBERS.map((n) => ({ value: String(n), label: `Équipe ${n}` }))}
        />
      </div>
      <div>
        <span className="label">Niveau</span>
        <Segmented
          value={form.level}
          onChange={(v) => canWrite && set({ level: v === form.level ? undefined : v })}
          options={LEVELS.map((l) => ({ value: l.value, label: l.label }))}
        />
      </div>
      {upper.length > 0 && (
        <label className="block">
          <span className="label">Je joue en</span>
          <select className="field min-h-11 w-full" value={form.playsIn ?? ''} disabled={!canWrite} onChange={(e) => set({ playsIn: e.target.value || undefined })}>
            <option value="">{own ? `Ma catégorie (${own})` : 'Ma catégorie'}</option>
            {upper.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} (surclassement)
              </option>
            ))}
          </select>
        </label>
      )}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary min-h-11 px-5" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? 'Enregistrement…' : 'Enregistrer mon équipe'}
          </button>
          {msg && <span className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</span>}
        </div>
      )}
    </section>
  )
}
