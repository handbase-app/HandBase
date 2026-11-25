// Parité TS ↔ SQL des moyennes du groupe (tools/essai-sql-082/lancer.sh) : écrit sur la sortie un script SQL qui pose des
// réponses FICTIVES tirées au hasard (graine fixe) pour les fiches j-1 et j-2 du groupe g1 (tools/essai-sql-073/essais.sql),
// puis fait calculer par le serveur (hb_wellness_groupe_moyennes, 082, comme le créateur du groupe) les moyennes de
// plusieurs périodes, comparées à celles de src/wellness.ts (groupPeriod, formeDuJour) ; s'arrête au premier désaccord.
//
//   npx jiti tools/essai-sql-082/parite.ts > /tmp/parite.sql
import { addDays, groupPeriod, WELLNESS_KEYS, type PainEntry, type WellnessEntry } from '../../src/wellness'

// Tirage reproductible (mulberry32).
let seed = 82
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

// Jour « d'ancrage » côté TS : seuls les écarts comptent (le serveur part de son aujourd'hui, hb_wl_auj()).
const ANCHOR = '2030-06-15'
const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const out: string[] = []
out.push(`create or replace function pg_temp.proche(p_quoi text, p_sql text, p_ts text) returns void language plpgsql as $$
begin
  if not (p_sql is not distinct from p_ts or (p_sql is not null and p_ts is not null and abs(p_sql::numeric - p_ts::numeric) <= 0.011)) then
    raise exception 'ÉCHEC parité % : SQL % / TS %', p_quoi, p_sql, p_ts;
  end if;
end $$;`)

const byPlayer = new Map<string, WellnessEntry[]>()
const rows: string[] = []
const zones: Pick<PainEntry, 'zone' | 'cote'>[] = [{ zone: 'tete' }, { zone: 'genou', cote: 'g' }, { zone: 'lombaires' }, { zone: 'cheville', cote: 'd' }]
for (const pid of ['j-1', 'j-2']) {
  const list: WellnessEntry[] = []
  for (let n = 0; n <= 420; n++) {
    if (rnd() < 0.35) continue
    const scores: WellnessEntry['scores'] = {}
    for (const k of WELLNESS_KEYS) if (rnd() < 0.85) scores[k] = int(1, 10)
    const pain = rnd() < 0.2
    const pains: PainEntry[] = pain ? zones.slice(0, int(1, 3)).map((z) => ({ ...z, type: 'gene', intensite: int(1, 10) })) : []
    if (!Object.keys(scores).length && !pain) continue
    list.push({ day: addDays(ANCHOR, -n), scores, pain, ...(pain ? { pains } : {}) })
    rows.push(`(${q(pid)}, public.hb_wl_auj() - ${n}, ${q(JSON.stringify(scores))}, ${pain}, ${q(JSON.stringify(pain ? pains : []))})`)
  }
  byPlayer.set(pid, list)
}
out.push(`insert into public.hb_wellness (player_id, jour, scores, douleur, douleurs) values\n${rows.join(',\n')};`)

// Périodes (en jours avant aujourd'hui, bornes comprises) : jour, semaine, mois, l'an dernier, longues.
const periods: [string, number, number][] = [
  ['jour', 0, 0],
  ['semaine', 6, 0],
  ['mois', 29, 0],
  ['an', 378, 350],
  ['saison', 400, 0],
  ['vieux', 420, 300],
  ['milieu', 200, 170],
]
const C1 = '00000000-0000-0000-0000-0000000000c1'
let checks = 0
for (const [key, a, b] of periods) {
  const ts = groupPeriod(byPlayer.values(), addDays(ANCHOR, -a), addDays(ANCHOR, -b))
  const per = `jsonb_build_array(jsonb_build_object('cle', ${q(key)}, 'du', public.hb_wl_auj() - ${a}, 'au', public.hb_wl_auj() - ${b}))::text`
  const field = (f: string) => `essai.vu(${q(C1)}, format('select x -> ''periodes'' -> 0 ->> %L from public.hb_wellness_groupe_moyennes(''g1'', %L::jsonb) x', ${q(f)}, ${per}))`
  const fields: [string, number | null][] = [
    ['reponses', ts.answers],
    ['joueurs', ts.players],
    ...WELLNESS_KEYS.map((k) => [k, ts.avg[k]] as [string, number | null]),
    ['forme', ts.forme],
  ]
  for (const [f, v] of fields) {
    out.push(`select pg_temp.proche(${q(`${key} ${f}`)}, ${field(f)}, ${v === null ? 'null' : q(String(v))});`)
    checks++
  }
}
out.push(`do $$ begin raise notice 'ok : parité TS ↔ SQL des moyennes du groupe (${rows.length} réponses tirées au hasard, ${periods.length} périodes, ${checks} valeurs)'; end $$;`)
console.log(out.join('\n'))
