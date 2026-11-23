// Parité TS ↔ SQL des alertes wellness (tools/essai-sql-080/lancer.sh) : écrit sur la sortie un script SQL qui fait calculer
// par le serveur (hb_wla_serie, hb_wla_demande, hb_wla_feries du script 080) LES MÊMES CAS que src/wellnessAlerts.ts
// (tools/alertes-wellness-cas.ts, puis 600 cas tirés au hasard, graine fixe) et s'arrête au premier désaccord. Données fictives.
//
//   npx jiti tools/essai-sql-080/parite.ts > /tmp/parite.sql
import { isRequestedDay, publicHolidays, type Zone } from '../../src/lamp'
import { addDays, type WellnessEntry } from '../../src/wellness'
import { ALERT_NOTES, requestedDayFor, ruleStreak, type AlertRule } from '../../src/wellnessAlerts'
import { CAS, type Cas } from '../alertes-wellness-cas'

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const out: string[] = []
out.push(`create or replace function pg_temp.egal(p_quoi text, p_vu text, p_attendu text) returns void language plpgsql as $$
begin
  if p_vu is distinct from p_attendu then raise exception 'ÉCHEC parité % : SQL % / TS %', p_quoi, p_vu, p_attendu; end if;
end $$;`)

// ---------- Jours fériés et jours demandés ----------
for (let y = 2020; y <= 2040; y++)
  out.push(`select pg_temp.egal('fériés ${y}', (select string_agg(d::text, ',' order by d) from unnest(public.hb_wla_feries(${y})) d), ${q(publicHolidays(y).join(','))});`)
const zones: (Zone | null)[] = [null, 'A', 'B', 'C']
for (const z of zones)
  for (const pont of [true, false]) {
    const days: string[] = []
    for (let d = '2026-09-01'; d <= '2027-08-31'; d = addDays(d, 1)) if (isRequestedDay(d, z, { pont })) days.push(d)
    out.push(`select pg_temp.egal('jours demandés zone ${z ?? 'aucune'} pont ${pont}', (select string_agg(d::date::text, ',' order by d) from generate_series('2026-09-01'::date, '2027-08-31'::date, interval '1 day') d where public.hb_wla_demande(d::date, ${z ? q(z) : 'null'}, ${pont})), ${q(days.join(','))});`)
  }

// ---------- Séries ----------
function sqlCase(c: Cas, label: string) {
  const req = requestedDayFor(c.zone ?? null)
  const demandes: string[] = []
  for (let d = addDays(c.today, -60); d <= c.today; d = addDays(d, 1)) if (req(d)) demandes.push(d)
  const ts = ruleStreak(c.regle, c.entries, c.today, { requestedDay: req, account: c.account, since: c.since }).length
  const jours = JSON.stringify(c.entries.map((e) => ({ day: e.day, scores: e.scores, pain: e.pain })))
  out.push(
    `select pg_temp.egal(${q(label)}, public.hb_wla_serie(${q(JSON.stringify(c.regle))}::jsonb, ${q(jours)}::jsonb, ${q(c.today)}::date, array[${demandes.map(q).join(',')}]::date[], ${!!c.account}, ${c.since ? q(c.since) + '::date' : 'null'})::text, ${q(String(ts))});`,
  )
  return ts
}
for (const c of CAS) sqlCase(c, c.nom)

// Graine fixe (mulberry32) : les mêmes cas à chaque essai.
let seed = 80080
const rnd = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]
const hist = new Map<string, number>()
for (let i = 0; i < 600; i++) {
  const today = addDays('2026-10-01', int(0, 240))
  const level = int(2, 9)
  const answerRate = pick([0.3, 0.7, 0.9, 1])
  const entries: WellnessEntry[] = []
  for (let d = addDays(today, -55); d <= today; d = addDays(d, 1)) {
    if (rnd() > answerRate) continue
    const drift = d > addDays(today, -6) && rnd() < 0.5 ? -int(0, 5) : 0
    const v = () => Math.max(1, Math.min(10, level + drift + int(-1, 1)))
    const kind = rnd()
    const scores = kind < 0.08 ? {} : kind < 0.2 ? { energie: v(), sommeil: v() } : { energie: v(), fraicheur: v(), humeur: v(), sommeil: v() }
    const pain = Object.keys(scores).length === 0 || rnd() < 0.25
    entries.push({ day: d, scores, pain })
  }
  const type = pick(['seuil', 'douleur', 'chute', 'silence'] as const)
  const jours = int(1, 4)
  const regle: AlertRule =
    type === 'seuil'
      ? { type, note: pick(ALERT_NOTES), max: int(3, 8), jours }
      : type === 'chute'
        ? { type, note: pick(ALERT_NOTES), baisse: int(1, 4), jours }
        : { type, jours }
  const c: Cas = { nom: `hasard ${i}`, regle, entries, today, zone: pick(zones), account: rnd() < 0.8, since: rnd() < 0.3 ? addDays(today, -int(0, 20)) : null, attendu: 0 }
  const ts = sqlCase(c, `hasard ${i} (${type})`)
  const k = `${type}:${ts > 0 ? 'série' : 'zéro'}`
  hist.set(k, (hist.get(k) ?? 0) + 1)
}
out.push(`do $$ begin raise notice 'ok : parité TS ↔ SQL sur ${CAS.length} cas communs, 600 cas tirés au hasard (${[...hist].sort().map(([k, v]) => `${k} ${v}`).join(', ')}), fériés 2020-2040, jours demandés d''une saison (4 zones, pont oui / non)'; end $$;`)
console.log(out.join('\n'))
