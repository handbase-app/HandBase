/*
 * Rencontres FICTIVES pour les bases de démonstration (« Autour de moi », supabase/056_rencontres.sql) : écrit UN fichier SQL,
 * HORS du dépôt, qui fabrique les rencontres DANS la base visée à partir de ce qu'elle contient déjà (clubs de la structure,
 * joueurs) : aucune donnée n'est exportée ni écrite dans le fichier, seulement des règles. À passer APRÈS 056.
 *
 * Ce que fait le fichier, en une transaction :
 *  - sport de la base (ligne « sport » de hb_config ; sans elle : handball ; --sport pour l'imposer) et ses catégories de
 *    jeunes (src/sportContent.ts : U13, U15, U18 au handball ; M13, M15, M18 au volley) ;
 *  - un week-end par semaine, de celui de la semaine en cours à +N semaines (--semaines, 10 par défaut : 11 week-ends),
 *    dates prises au moment où le fichier est passé (current_date) ; catégorie de chaque joueur selon la saison du week-end ;
 *  - équipes : chaque club qui a des joueurs dans une catégorie et un sexe y a une équipe ; les clubs les plus fournis en
 *    ont 2 (20 % du haut) ou 3 (5 %) ; niveau plausible : équipe 1 nationale pour ~7 % des clubs en dernière catégorie
 *    (métropole seulement), régionale pour la moitié environ en U15 / U18 (20 % en U13), départementale sinon ; équipe 2
 *    régionale pour les plus forts ; équipe 3 départementale ;
 *  - poules : départementales (département ; moins de 4 équipes : la région), régionales (région), nationales (4 zones de
 *    la métropole) ; chaque week-end, ~15 % des équipes ne jouent pas (--repos), les autres sont appariées : voisines sur un
 *    serpentin qui change chaque semaine (départemental, régional : adversaires proches, ~33 km en moyenne sur la base de
 *    test), ou d'un bout à l'autre de la zone (national : ~120 km) ; deux équipes d'un même club ne se rencontrent pas ;
 *    qui reçoit : tiré au hasard ;
 *  - samedi ou dimanche, horaires selon la catégorie ; salle = ville et coordonnées du club qui reçoit (léger décalage), nom
 *    de salle FICTIF et générique (« Gymnase des Tilleuls »…) ; club sans coordonnées dans la structure : placé au centre
 *    de son département (calculé ici depuis les contours de l'appli, src/assets) avec un décalage ;
 *  - idempotent : les rencontres source = 'demo' sont effacées puis recréées ; tirages déterministes (empreinte md5 d'une
 *    clé : mêmes rencontres pour les mêmes week-ends et la même base, quel que soit l'ordre de lecture) — pas de random() ;
 *  - à la fin, une ligne de contrôle (nombre de rencontres, clubs, répartition par catégorie, par jour, taille de la table).
 *
 * Ordre de grandeur (offre gratuite de Supabase, 500 Mo) : base de test (40 000 joueurs, ~2 300 clubs) ≈ 66 000 rencontres
 * (estimé le 26/10/2026 : ~6 000 par week-end, 2 297 clubs), ~35 Mo index compris ; base volley (25 000 joueurs nés de 2008
 * à 2013, ~1 450 clubs : M15 et M18 seulement) ≈ 25 000 à 35 000. --estimer écrit à la place une requête de LECTURE seule qui
 * compte ce que le fichier créerait (sans rien écrire).
 *
 * Utilisation :
 *   npx jiti tools/seed-rencontres.ts <fichier.sql hors du dépôt> [--semaines 10] [--repos 0.15] [--sport handball|volley] [--estimer]
 *   puis : coller le fichier dans Supabase > SQL Editor (ou psql "<connexion>" -X -f <fichier.sql>), sur la base visée.
 * Retirer le jeu : delete from public.hb_rencontres where source = 'demo';
 */
import { geoCentroid } from 'd3-geo'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OFFICIAL_REGIONS } from '../src/regionsOfficial'
import { SPORT_CONTENT } from '../src/sportContent'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- Paramètres ----------

export interface SeedOptions {
  weeks: number
  rest: number
  sport?: string
  estimate?: boolean
}

export function parseArgs(argv: readonly string[]): { out: string; opts: SeedOptions } {
  const opts: SeedOptions = { weeks: 10, rest: 0.15 }
  let out = ''
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--semaines') opts.weeks = Number(argv[++i])
    else if (a === '--repos') opts.rest = Number(argv[++i])
    else if (a === '--sport') opts.sport = argv[++i]
    else if (a === '--estimer') opts.estimate = true
    else if (!a.startsWith('--') && !out) out = a
    else throw new Error(`Argument inconnu : ${a}`)
  }
  if (!out) throw new Error('Fichier de sortie manquant : npx jiti tools/seed-rencontres.ts <fichier.sql hors du dépôt>')
  if (!Number.isInteger(opts.weeks) || opts.weeks < 0 || opts.weeks > 26) throw new Error('--semaines : un entier de 0 à 26')
  if (!(opts.rest >= 0 && opts.rest < 0.9)) throw new Error('--repos : une part entre 0 et 0,9')
  if (opts.sport && !SPORT_CONTENT[opts.sport]) throw new Error(`--sport : ${Object.keys(SPORT_CONTENT).join(' ou ')}`)
  return { out, opts }
}

/** Le fichier est-il dans le dépôt ? (refusé : les données générées n'y entrent jamais) */
export const insideRepo = (path: string, root = ROOT) => {
  const p = resolve(path)
  return p === root || p.startsWith(root + sep)
}

// ---------- Tables écrites dans le SQL (règles et géographie, aucune donnée de la base) ----------

/** Horaires et règles par rang de catégorie (0 : la plus jeune). */
const BY_RANK = [
  { nat: false, regCut: 0.8, sat: ['13:30', '14:00', '14:30', '15:00', '16:00'], sun: ['10:00', '10:30', '11:00', '14:00'], sunShare: 0.25 },
  { nat: false, regCut: 0.55, sat: ['14:00', '15:00', '15:30', '16:00', '17:00'], sun: ['10:30', '11:00', '14:00', '15:00'], sunShare: 0.3 },
  { nat: true, regCut: 0.5, sat: ['16:00', '17:00', '18:00', '18:30', '19:00'], sun: ['11:00', '14:00', '15:00', '16:00'], sunShare: 0.35 },
]

/** Noms de salles FICTIFS et génériques. */
export const VENUES = [
  'Gymnase des Tilleuls',
  'Gymnase du Parc',
  'Salle des Sports',
  'Gymnase municipal',
  'Complexe sportif des Écoles',
  'Salle omnisports',
  'Gymnase du Collège',
  'Halle des sports',
  'Gymnase des Pins',
  'Salle du Stade',
  'Gymnase des Platanes',
  'Gymnase du Lycée',
  'Gymnase des Cèdres',
  'Complexe sportif du Lac',
  'Salle des Peupliers',
  'Gymnase des Acacias',
]

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const arr = (xs: readonly (string | number)[]) => `array[${xs.map((x) => (typeof x === 'number' ? String(x) : q(x))).join(', ')}]`

function catsValues(): string {
  const rows: string[] = []
  for (const [sport, c] of Object.entries(SPORT_CONTENT)) {
    c.youthCategories.forEach((cat, i) => {
      const r = BY_RANK[Math.min(i, BY_RANK.length - 1)]
      rows.push(`(${q(sport)}, ${q(cat.code)}, ${i}, ${arr(cat.ages)}::int[], ${r.nat}, ${r.regCut}, ${arr(r.sat)}, ${arr(r.sun)}, ${r.sunShare})`)
    })
  }
  return rows.join(',\n    ')
}

type Geo = { features: { properties: { code: string }; geometry: unknown }[] }

/** Centre de chaque département (contours de l'appli : métropole et outre-mer) ; Corse : un seul département, « 20 ». */
export function deptCenters(): Map<string, [number, number]> {
  const read = (f: string) => JSON.parse(readFileSync(resolve(ROOT, 'src/assets', f), 'utf8')) as Geo
  const out = new Map<string, [number, number]>()
  const corse: [number, number][] = []
  for (const f of [...read('departements.json').features, ...read('outre-mer.json').features]) {
    const c = geoCentroid(f as Parameters<typeof geoCentroid>[0]) as [number, number]
    const code = f.properties.code
    if (code === '2A' || code === '2B') corse.push(c)
    else out.set(code, c)
  }
  if (corse.length) out.set('20', [corse.reduce((s, c) => s + c[0], 0) / corse.length, corse.reduce((s, c) => s + c[1], 0) / corse.length])
  return out
}

function deptValues(): string {
  const centers = deptCenters()
  const region = new Map(Object.entries(OFFICIAL_REGIONS).flatMap(([r, ds]) => ds.split(' ').map((d) => [d, r] as const)))
  const codes = [...new Set([...centers.keys(), ...region.keys()])].filter((d) => d !== '2A' && d !== '2B').sort()
  return codes
    .map((d) => {
      const c = centers.get(d)
      return `(${q(d)}, ${c ? c[1].toFixed(4) : 'null'}::double precision, ${c ? c[0].toFixed(4) : 'null'}::double precision, ${region.has(d) ? q(region.get(d)!) : 'null'})`
    })
    .join(',\n    ')
}

/** Nombre pseudo-aléatoire de [0, 1[ tiré d'une clé (empreinte md5 : déterministe, sans état). */
const rnd = (key: string) => `(('x' || substr(md5(${key}), 1, 13))::bit(52)::bigint / 4503599627370496.0)`

// ---------- Requête ----------

/** Les rencontres à créer (une requête SELECT, colonnes de hb_rencontres), calculées dans la base. */
export function fixturesQuery(o: SeedOptions): string {
  const sport = o.sport ? q(o.sport) : `(select data -> 'value' ->> 'sport' from public.hb_config where id = 'sport' and not deleted)`
  return `with
  params as (
    select coalesce(${sport}, 'handball') as sport,
           date_trunc('week', current_date)::date + 5 as sat0
  ),
  -- Catégories de jeunes de chaque sport (src/sportContent.ts) et règles par rang (horaires, niveaux).
  cats (sport, code, ix, ages, nat, reg_cut, sat_times, sun_times, sun_share) as (values
    ${catsValues()}
  ),
  -- Centre et région de chaque département (contours de l'appli ; src/regionsOfficial.ts).
  depts (dept, lat, lng, region) as (values
    ${deptValues()}
  ),
  weekends as (
    select k, p.sat0 + 7 * k as sat,
           extract(year from p.sat0 + 7 * k)::int + case when extract(month from p.sat0 + 7 * k) >= 9 then 1 else 0 end as season_end
      from params p, generate_series(0, ${o.weeks}) k
  ),
  seasons as (select distinct season_end from weekends),
  -- Joueurs : club (n° de club, à défaut début de la licence : comme hb_player_club), sexe, année de naissance.
  pl as (
    select case when coalesce(btrim(data ->> 'clubCode'), '') <> '' then btrim(data ->> 'clubCode')
                when coalesce(data ->> 'license', '') ~ '^\\d{13}$' then left(data ->> 'license', 7) end as club,
           data ->> 'sex' as sex,
           left(data ->> 'birthDate', 4)::int as born,
           nullif(btrim(data ->> 'club'), '') as club_name
      from public.hb_players
     where not deleted and data ->> 'sex' in ('M', 'F') and coalesce(data ->> 'birthDate', '') ~ '^\\d{4}-'
       and coalesce(data ->> 'review', '') <> 'refused' and not coalesce((data ->> 'purged')::boolean, false)
  ),
  -- Clubs de la structure placés (coordonnées) : une unité par n° de club.
  units as (
    select distinct on (btrim(data ->> 'clubNumber')) btrim(data ->> 'clubNumber') as club, id as unit_id,
           nullif(btrim(data ->> 'name'), '') as name, nullif(btrim(data ->> 'city'), '') as city,
           (data ->> 'lat')::double precision as lat, (data ->> 'lng')::double precision as lng
      from public.hb_units
     where not deleted and coalesce(btrim(data ->> 'clubNumber'), '') ~ '^\\d{7}$'
       and jsonb_typeof(data -> 'lat') = 'number' and jsonb_typeof(data -> 'lng') = 'number'
     order by btrim(data ->> 'clubNumber'), (data ->> 'levelId' = 'niveau-club') desc, id
  ),
  -- Clubs qui ont des joueurs : unité placée, sinon centre de leur département (décalé) ; département comme hb_player_dept.
  clubs as (
    select c.club, u.unit_id, coalesce(u.name, c.club_name, 'Club ' || c.club) as name, u.city,
           coalesce(u.lat, d.lat + (${rnd(`c.club || ':la'`)} - 0.5) * 0.3) as lat,
           coalesce(u.lng, d.lng + (${rnd(`c.club || ':lo'`)} - 0.5) * 0.4) as lng,
           c.dept, d.region
      from (select club, mode() within group (order by club_name) as club_name,
                   case left(club, 2) when '64' then '971' when '65' then '973' when '66' then '972' when '67' then '988'
                                      when '69' then '974' when '70' then '976' else substr(club, 3, 2) end as dept
              from pl where club ~ '^\\d{7}$' group by club) c
      left join units u on u.club = c.club
      left join depts d on d.dept = c.dept
     where u.club is not null or d.lat is not null
  ),
  -- Joueurs par club, catégorie (saison de chaque week-end) et sexe.
  counts as (
    select s.season_end, pl.club, ct.code as cat, ct.ix, ct.nat, ct.reg_cut, ct.sat_times, ct.sun_times, ct.sun_share, pl.sex, count(*) as n
      from pl
      join seasons s on true
      join params p on true
      join cats ct on ct.sport = p.sport and (s.season_end - pl.born) = any (ct.ages)
     where pl.club ~ '^\\d{7}$'
     group by s.season_end, pl.club, ct.code, ct.ix, ct.nat, ct.reg_cut, ct.sat_times, ct.sun_times, ct.sun_share, pl.sex
  ),
  ranked as (
    select k.*,
           percent_rank() over (partition by k.season_end, k.cat, k.sex order by k.n, ${rnd(`k.club || ':eq:' || k.cat || k.sex`)}) as size_rank,
           percent_rank() over (partition by k.season_end, k.cat, k.sex order by k.n + 2.5 * ${rnd(`k.club || ':niv:' || k.cat || k.sex`)}, k.club) as strength
      from counts k
  ),
  -- Équipes : 1, 2 ou 3 par club, catégorie et sexe ; niveau de chacune.
  teams as (
    select r.season_end, r.cat, r.ix, r.sat_times, r.sun_times, r.sun_share, r.sex, c.club, c.unit_id, c.name, c.city, c.lat, c.lng, c.dept, c.region, t.n as team,
           case when t.n = 1 and r.nat and r.strength >= 0.93 and length(c.dept) = 2 then 'national'
                when t.n = 1 and r.strength >= r.reg_cut then 'regional'
                when t.n = 2 and r.ix > 0 and r.strength >= 0.9 then 'regional'
                else 'departemental' end as level
      from ranked r
      join clubs c on c.club = r.club
      cross join lateral generate_series(1, case when r.size_rank >= 0.95 then 3 when r.size_rank >= 0.8 then 2 else 1 end) t(n)
  ),
  -- Poules : département (moins de 4 équipes : la région), région, zone nationale.
  pooled as (
    select t.*,
           case t.level
             when 'national' then 'n:' || case when t.lat >= 46.6 then 'N' else 'S' end || case when t.lng >= 2.6 then 'E' else 'O' end
             when 'regional' then 'r:' || coalesce(t.region, t.dept)
             else case when count(*) over (partition by t.season_end, t.cat, t.sex, t.level, t.dept) >= 4 then 'd:' || t.dept
                       else 'r:' || coalesce(t.region, t.dept) end
           end as pool
      from teams t
  ),
  -- Chaque week-end : équipes qui jouent (repos tirés au sort), rangées dans leur poule en serpentin (bandes de ~25 km
  -- perpendiculaires à une direction qui tourne chaque semaine) : deux voisines du rang sont proches sur la carte.
  turned as (
    select w.k, w.sat, p.*,
           p.lat * cos(w.k * 0.97) + p.lng * 0.7 * sin(w.k * 0.97) as u,
           -p.lat * sin(w.k * 0.97) + p.lng * 0.7 * cos(w.k * 0.97) as v
      from weekends w
      join pooled p on p.season_end = w.season_end
     where ${rnd(`p.club || ':' || p.cat || p.sex || p.team || ':' || w.sat`)} >= ${o.rest}
  ),
  playing as (
    select t.*,
           row_number() over (partition by t.sat, t.cat, t.sex, t.level, t.pool
                              order by t.team, floor(t.u / 0.25), case when floor(t.u / 0.25)::int % 2 = 0 then t.v else -t.v end, t.club) as rn,
           count(*) over (partition by t.sat, t.cat, t.sex, t.level, t.pool) as cnt
      from turned t
  ),
  -- Paires, sans jointure (une seule lecture triée par poule) : voisines (1-2, 3-4…) ; national : d'un bout à l'autre
  -- (1 avec n/2+1…). Le dernier d'un nombre impair attend. Deux équipes du même club côte à côte : pas ce week-end-là.
  partnered as (
    select pl.*, (case when pl.level = 'national' then greatest(pl.cnt / 2, 1) else 1 end)::int as off
      from playing pl
  ),
  leaded as (
    select x.*,
           lead(x.club, x.off) over w as b_club, lead(x.unit_id, x.off) over w as b_unit, lead(x.team, x.off) over w as b_team,
           lead(x.name, x.off) over w as b_name, lead(x.city, x.off) over w as b_city,
           lead(x.lat, x.off) over w as b_lat, lead(x.lng, x.off) over w as b_lng
      from partnered x
    window w as (partition by x.sat, x.cat, x.sex, x.level, x.pool order by x.rn)
  ),
  pairs as (
    select l.sat, l.cat, l.sex, l.level, l.pool, l.sat_times, l.sun_times, l.sun_share,
           l.sat || l.pool || l.cat || l.sex || l.level || l.club || l.team || l.b_club || l.b_team as k,
           l.club as a_club, l.unit_id as a_unit, l.team as a_team, l.name as a_name, l.city as a_city, l.lat as a_lat, l.lng as a_lng,
           l.b_club, l.b_unit, l.b_team, l.b_name, l.b_city, l.b_lat, l.b_lng
      from leaded l
     where l.b_club is not null and l.b_club <> l.club
       and case when l.level = 'national' then l.rn <= l.cnt / 2 else l.rn % 2 = 1 end
  ),
  sided as (
    select x.*, ${rnd(`x.k || ':dom'`)} < 0.5 as swap from pairs x
  ),
  homed as (
    select s.sat, s.cat, s.sex, s.level, s.k, s.sat_times, s.sun_times,
           case when s.level = 'national' then 0.6 else s.sun_share end as sun_share,
           case when s.swap then s.b_club else s.a_club end as h_club, case when s.swap then s.b_unit else s.a_unit end as h_unit,
           case when s.swap then s.b_team else s.a_team end as h_team, case when s.swap then s.b_name else s.a_name end as h_name,
           case when s.swap then s.b_city else s.a_city end as h_city,
           case when s.swap then s.b_lat else s.a_lat end as h_lat, case when s.swap then s.b_lng else s.a_lng end as h_lng,
           case when s.swap then s.a_club else s.b_club end as v_club, case when s.swap then s.a_unit else s.b_unit end as v_unit,
           case when s.swap then s.a_team else s.b_team end as v_team, case when s.swap then s.a_name else s.b_name end as v_name
      from sided s
  ),
  -- Salle du club qui reçoit : la principale, ou une deuxième pour ses équipes 2 et 3 (une fois sur deux).
  placed as (
    select h.*, case when h.h_team >= 2 and ${rnd(`h.h_club || ':v2'`)} < 0.5 then 2 else 1 end as v,
           ${rnd(`h.k || ':j'`)} < h.sun_share as sunday
      from homed h
  )
select 'demo:' || md5(p.k) as id,
       ((p.sat + case when p.sunday then 1 else 0 end)
         + (case when p.sunday then p.sun_times[1 + floor(${rnd(`p.k || ':h'`)} * array_length(p.sun_times, 1))::int]
                 else p.sat_times[1 + floor(${rnd(`p.k || ':h'`)} * array_length(p.sat_times, 1))::int] end)::time)
         at time zone 'Europe/Paris' as starts_at,
       round((p.h_lat + (${rnd(`p.h_club || ':vla' || p.v`)} - 0.5) * 0.006)::numeric, 5)::double precision as lat,
       round((p.h_lng + (${rnd(`p.h_club || ':vlo' || p.v`)} - 0.5) * 0.009)::numeric, 5)::double precision as lng,
       p.cat as category, p.sex, p.level,
       case p.level when 'national' then 'Championnat de France ' when 'regional' then 'Championnat régional ' else 'Championnat départemental ' end
         || p.cat || ' ' || case p.sex when 'F' then 'féminin' else 'masculin' end as competition,
       p.h_unit as home_unit_id, p.h_club as home_club, p.h_team::smallint as home_team, p.h_name as home_name,
       p.v_unit as away_unit_id, p.v_club as away_club, p.v_team::smallint as away_team, p.v_name as away_name,
       (${arr(VENUES)})[1 + floor(${rnd(`p.h_club || ':salle' || p.v`)} * ${VENUES.length})::int] as venue,
       p.h_city as city
  from placed p`
}

const INSERT_COLS = 'id, starts_at, lat, lng, category, sex, level, competition, home_unit_id, home_club, home_team, home_name, away_unit_id, away_club, away_team, away_name, venue, city'

export function seedSql(o: SeedOptions, now = new Date()): string {
  const head = `-- Rencontres FICTIVES (source = 'demo') pour « Autour de moi » : fichier écrit par tools/seed-rencontres.ts le
-- ${now.toISOString().slice(0, 10)} (${o.weeks + 1} week-ends à partir de celui de la semaine où il est passé, ${Math.round(o.rest * 100)} % d'équipes au repos chaque
-- week-end, sport : ${o.sport ?? 'celui de la base (hb_config), handball sans réglage'}). Rien d'exporté : tout est calculé dans la base à partir
-- de ses clubs et de ses joueurs. À passer APRÈS supabase/056_rencontres.sql. Peut être relancé : le jeu précédent est remplacé.
`
  if (o.estimate)
    return `${head}-- ESTIMATION (lecture seule) : ce que le fichier créerait, sans rien écrire.
with f as (
${fixturesQuery(o)}
)
select count(*) as rencontres,
       count(distinct home_club) as clubs_qui_recoivent,
       (select jsonb_object_agg(k, n) from (select category || ' ' || sex || ' ' || level as k, count(*) as n from f group by 1) x) as par_categorie,
       min(starts_at) as premiere, max(starts_at) as derniere
  from f;
`
  return `${head}
begin;

do $$
begin
  if to_regclass('public.hb_rencontres') is null then
    raise exception 'Passer d''abord supabase/056_rencontres.sql';
  end if;
end $$;

delete from public.hb_rencontres where source = 'demo';

insert into public.hb_rencontres (${INSERT_COLS}, source)
select ${INSERT_COLS}, 'demo' from (
${fixturesQuery(o)}
) f
on conflict (id) do nothing;

commit;

-- Contrôle : rencontres du jeu, clubs, répartition par catégorie, sexe et niveau, par jour ; taille de la table.
select (select count(*) from public.hb_rencontres where source = 'demo' and not deleted) as rencontres_demo,
       (select count(distinct c) from (select home_club as c from public.hb_rencontres where source = 'demo'
                                       union select away_club from public.hb_rencontres where source = 'demo') x) as clubs,
       (select jsonb_object_agg(k, n) from (select category || ' ' || sex || ' ' || level as k, count(*) as n
                                              from public.hb_rencontres where source = 'demo' group by 1) x) as par_categorie,
       (select jsonb_object_agg(d, n) from (select to_char(starts_at at time zone 'Europe/Paris', 'YYYY-MM-DD') as d, count(*) as n
                                              from public.hb_rencontres where source = 'demo' group by 1) x) as par_jour,
       pg_size_pretty(pg_total_relation_size('public.hb_rencontres')) as taille_table;
`
}

// ---------- Ligne de commande ----------

function main(argv: readonly string[]) {
  const { out, opts } = parseArgs(argv)
  if (insideRepo(out)) throw new Error(`Refusé : ${resolve(out)} est dans le dépôt. Les fichiers générés n'y entrent jamais : choisir un dossier hors du dépôt.`)
  const dir = dirname(resolve(out))
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Dossier introuvable : ${dir}`)
  writeFileSync(out, seedSql(opts), 'utf8')
  console.log(`${opts.estimate ? 'Estimation (lecture seule)' : 'Rencontres fictives'} : ${resolve(out)}`)
  console.log(`${opts.weeks + 1} week-ends, ${Math.round(opts.rest * 100)} % au repos, sport : ${opts.sport ?? 'celui de la base'}.`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
