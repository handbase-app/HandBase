// Test de la lecture par périmètre indexée (src/syncLive.ts, pendant de supabase/058_lecture_perimetre.sql) : choix de la
// lecture selon le compte (administrateur, « tout », club, comité, joueur, rôle inconnu, fonction absente, tables hors liste),
// protocole des pages (>= curseur, égalités d'heure déjà reçues écartées, ancien filtre si une page pleine n'a qu'une heure),
// contre un serveur fictif qui rend exactement ce que rend hb_lire_perimetre (ou la lecture directe) ; et le script SQL tel que
// l'appli l'attend (nom, paramètres, SECURITY INVOKER, search_path, liste blanche). Données fictives seulement.
// La preuve de sécurité côté base (8 comptes, contre-essai) : tools/essai-sql-058/lancer.sh (Postgres jetable).
//
//   npx jiti tools/test-lecture-perimetre.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PERIMETER_TABLES, PULL_PAGE, pullReader, readPages, readScopedPages, type PageKey, type ScopedRequest } from '../src/syncLive'
import { scopeSignature } from '../src/perimeter'

let n = 0
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

// ---------- Choix de la lecture ----------

t('choix de la lecture : par périmètre pour les comptes qui ne voient pas tout, directe pour les autres', () => {
  assert.deepEqual([...PERIMETER_TABLES], ['players', 'measurements', 'evaluations', 'seen'])
  const club = scopeSignature({ all: false, depts: [], clubs: ['6383015'] })
  const comite = scopeSignature({ all: false, depts: ['83'], clubs: [] })
  const tout = scopeSignature({ all: true, depts: [], clubs: [] })
  for (const table of PERIMETER_TABLES) {
    // Administrateur : lecture directe (il voit tout), quel que soit le périmètre gardé.
    assert.equal(pullReader(table, 'admin', null, false), 'table', `admin ${table}`)
    assert.equal(pullReader(table, 'admin', club, false), 'table')
    // Niveau Fédération (encadrant qui voit tout) : connu par le périmètre « tout ».
    assert.equal(pullReader(table, 'preparateur', tout, false), 'table', `fédération ${table}`)
    // Club, comité, observateur : par périmètre.
    assert.equal(pullReader(table, 'observateur', club, false), 'perimetre', `club ${table}`)
    assert.equal(pullReader(table, 'preparateur', comite, false), 'perimetre', `comité ${table}`)
    // Appareil neuf : périmètre pas encore lu (premier chargement) ou rôle pas encore connu : par périmètre (la fonction
    // rend exactement la lecture directe pour tout compte ; seul le coût change).
    assert.equal(pullReader(table, 'preparateur', null, false), 'perimetre')
    assert.equal(pullReader(table, null, null, false), 'perimetre')
    // Compte joueur : sa fiche par la clé primaire (la lecture directe parcourrait les 500 000 fiches sous la règle).
    assert.equal(pullReader(table, 'joueur', null, false), 'perimetre')
    // Fonction absente du serveur (058 pas passé) : lecture directe.
    assert.equal(pullReader(table, 'observateur', club, true), 'table', `fonction absente ${table}`)
    // Signature illisible : périmètre inconnu, par périmètre.
    assert.equal(pullReader(table, 'observateur', '{pas du json', false), 'perimetre')
  }
  // Autres tables (« à revoir » : règle plus étroite ; vidéos, événements, structure…) : lecture directe.
  for (const table of ['rewatch', 'videos', 'events', 'groups', 'assignments', 'criteria'] as const) {
    assert.equal(pullReader(table, 'observateur', club, false), 'table', table)
  }
})

// ---------- Protocole des pages ----------

type Row = { id: string; server_updated_at: string; data: { id: string } }

/**
 * Serveur fictif : lignes triées (server_updated_at, id) ; { since } : server_updated_at >= since (hb_lire_perimetre, ou la
 * lecture directe de repli) ; { after } : strictement après (heure, id) (ancien filtre) ; au plus `cap` lignes par réponse.
 * heures : heure (en secondes) de chaque ligne ; les identifiants suivent l'ordre du serveur.
 */
function scopedServer(heures: number[], cap = PULL_PAGE) {
  const at = (s: number) => `2026-10-30T08:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000000+00:00`
  const rows: Row[] = heures
    .map((h, i) => ({ id: `r${String(i).padStart(6, '0')}`, server_updated_at: at(h), data: { id: `r${i}` } }))
    .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id))
  const calls: ScopedRequest[] = []
  const fetch = async (req: ScopedRequest) => {
    calls.push(req)
    const from = 'since' in req
      ? rows.filter((r) => r.server_updated_at >= req.since)
      : rows.filter((r) => r.server_updated_at > req.after.at || (r.server_updated_at === req.after.at && r.id > req.after.id))
    return from.slice(0, Math.min(PULL_PAGE, cap))
  }
  return { rows, calls, fetch, at }
}

async function lire(heures: number[], since = '1970-01-01T00:00:00Z', pageSize = PULL_PAGE) {
  const srv = scopedServer(heures, pageSize)
  const got: string[] = []
  const more: boolean[] = []
  const received = await readScopedPages<Row>(since, srv.fetch, (rows, m) => {
    got.push(...rows.map((r) => r.id))
    more.push(m)
  }, pageSize)
  return { srv, got, more, received }
}

t('pages par périmètre : toutes les lignes, une fois, dans l’ordre (égalités d’heure à cheval sur deux pages)', async () => {
  // 2 500 lignes, 7 par seconde : chaque page finit au milieu d'une seconde.
  const heures = Array.from({ length: 2500 }, (_, i) => Math.floor(i / 7))
  const { srv, got, received, more } = await lire(heures)
  assert.equal(received, 2500)
  assert.deepEqual(got, srv.rows.map((r) => r.id), 'toutes, une fois, dans l’ordre')
  // Pages suivantes : « >= heure de la dernière ligne reçue » (jamais l'ancien filtre : aucune page n'a une seule heure).
  assert.ok(srv.calls.every((c) => 'since' in c), 'toujours >=')
  assert.equal((srv.calls[1] as { since: string }).since, srv.rows[999].server_updated_at, 'page 2 : depuis l’heure de la 1 000e ligne')
  // Les lignes de cette heure déjà reçues reviennent et sont écartées : pages de 1 000 brutes, moins les égalités.
  assert.equal(srv.calls.length, 3)
  assert.deepEqual(more, [true, true, false], 'avancement : pages pleines (brutes), puis la dernière')
  // Même résultat que la lecture d'avant (ancien filtre à chaque page).
  const old: string[] = []
  const prev = scopedServer(heures)
  await readPages<Row>(async (after: PageKey | null) => prev.fetch(after ? { after } : { since: '1970-01-01T00:00:00Z' }), (rows) => void old.push(...rows.map((r) => r.id)))
  assert.deepEqual(got, old, 'mêmes lignes que l’ancien protocole')
})

t('pages par périmètre : petites tailles, toutes les répartitions d’heures', async () => {
  for (const page of [1, 2, 3, 5, 8]) {
    for (const tie of [1, 2, 3, 5, 9, 20]) {
      const heures = Array.from({ length: 47 }, (_, i) => Math.floor(i / tie))
      const { srv, got } = await lire(heures, '1970-01-01T00:00:00Z', page)
      assert.deepEqual(got, srv.rows.map((r) => r.id), `pages de ${page}, ${tie} lignes par heure`)
    }
  }
})

t('page pleine d’une seule heure (import de masse) : page suivante à l’ancien filtre, puis retour à >=', async () => {
  // 2 600 lignes à la même seconde (import), puis 600 lignes étalées.
  const heures = [...Array.from({ length: 2600 }, () => 10), ...Array.from({ length: 600 }, (_, i) => 11 + Math.floor(i / 4))]
  const { srv, got, received } = await lire(heures)
  assert.equal(received, 3200)
  assert.deepEqual(got, srv.rows.map((r) => r.id), 'toutes, une fois, dans l’ordre')
  const kinds = srv.calls.map((c) => ('since' in c ? '>=' : 'après'))
  // 1re page (>=) : 1 000 lignes de la même heure → ancien filtre ; encore 1 000 de la même heure → ancien filtre ; puis
  // 600 de cette heure + 400 suivantes → retour à >= pour les 200 dernières.
  assert.deepEqual(kinds, ['>=', 'après', 'après', '>='], kinds.join(' '))
  // L'ancien filtre part de la DERNIÈRE ligne reçue (jamais d'une ligne déjà dépassée).
  assert.deepEqual((srv.calls[1] as { after: PageKey }).after, { at: srv.rows[999].server_updated_at, id: srv.rows[999].id })
  assert.deepEqual((srv.calls[2] as { after: PageKey }).after, { at: srv.rows[1999].server_updated_at, id: srv.rows[1999].id })
  // Jamais deux fois la même demande (pas de boucle sans fin).
  assert.equal(new Set(srv.calls.map((c) => JSON.stringify(c))).size, srv.calls.length)
})

t('pages par périmètre : table vide, une ligne, page exacte, curseur au milieu', async () => {
  assert.equal((await lire([])).received, 0)
  assert.equal((await lire([5])).received, 1)
  const exact = await lire(Array.from({ length: 1000 }, (_, i) => i))
  assert.equal(exact.received, 1000)
  assert.equal(exact.srv.calls.length, 2, 'page pleine : une demande de plus (vide de nouveautés)')
  // Curseur au milieu (synchronisation ordinaire) : seulement les lignes depuis le curseur (>=, l'heure du curseur comprise).
  const heures = Array.from({ length: 50 }, (_, i) => i)
  const srv = scopedServer(heures)
  const since = srv.at(30)
  const got: string[] = []
  await readScopedPages<Row>(since, srv.fetch, (rows) => void got.push(...rows.map((r) => r.id)))
  assert.deepEqual(got, srv.rows.slice(30).map((r) => r.id))
})

t('pages par périmètre : une ligne validée en retard, à l’heure de la dernière reçue, arrive quand même', async () => {
  // Le serveur rend, à la 2e demande, une ligne de plus à l'heure déjà vue (validée après la 1re page) : reçue, pas écartée.
  const srv = scopedServer(Array.from({ length: 1000 }, (_, i) => Math.floor(i / 10)))
  const lastAt = srv.rows[999].server_updated_at
  let second = false
  const got: string[] = []
  await readScopedPages<Row>(
    '1970-01-01T00:00:00Z',
    async (req) => {
      const page = await srv.fetch(req)
      if (second) return [...page, { id: 'r999999', server_updated_at: lastAt, data: { id: 'tard' } }]
      second = true
      return page
    },
    (rows) => void got.push(...rows.map((r) => r.id)),
  )
  assert.equal(got.length, 1001)
  assert.equal(got[got.length - 1], 'r999999')
  assert.equal(new Set(got).size, got.length, 'aucune ligne en double')
})

// ---------- Le script SQL tel que l'appli l'attend ----------

t('058 : fonction, paramètres, sécurité (SECURITY INVOKER, search_path, liste blanche, droits), index, relançable', () => {
  const raw = readFileSync(new URL('../supabase/058_lecture_perimetre.sql', import.meta.url), 'utf8')
  const sql = raw.replace(/^\s*--.*$/gm, '')
  // L'appli appelle supabase.rpc('hb_lire_perimetre', { p_table, p_curseur, p_limite }).
  assert.ok(sql.includes('create or replace function public.hb_lire_perimetre(p_table text, p_curseur timestamptz, p_limite integer default 1000)'))
  assert.ok(sql.includes('returns table (id text, data jsonb, server_updated_at timestamptz)'), 'mêmes colonnes que la lecture directe')
  assert.ok(/language plpgsql stable security invoker set search_path = public, pg_temp/.test(sql), 'INVOKER et search_path fixé')
  assert.ok(!/security definer/i.test(sql), 'jamais SECURITY DEFINER')
  assert.ok(sql.includes("p_table not in ('players', 'measurements', 'evaluations', 'seen')"), 'liste blanche')
  assert.ok(sql.includes("raise exception 'Connexion requise'"))
  // Périmètre calculé par les fonctions des règles de lecture, jamais reçu de l'appareil.
  assert.ok(sql.includes('public.hb_scope_all()') && sql.includes('public.hb_scope_clubs(), public.hb_scope_depts(), auth.uid()::text, public.hb_my_player_id()'))
  assert.ok(sql.includes('revoke all on function public.hb_lire_perimetre(text, timestamptz, integer) from public, anon;'))
  assert.ok(sql.includes('grant execute on function public.hb_lire_perimetre(text, timestamptz, integer) to authenticated;'))
  // Colonne générée et index, relançables.
  assert.ok(sql.includes("add column if not exists created_by text generated always as (data ->> %2$L) stored"))
  for (const i of ['club_sua on public.hb_%1$s (scope_club, server_updated_at, id)', 'dept_sua on public.hb_%1$s (scope_dept, server_updated_at, id)', 'auteur_sua on public.hb_%1$s (created_by, server_updated_at, id)']) {
    assert.ok(sql.includes(`create index if not exists hb_%1$s_${i}`), i)
  }
  // Requête de contrôle et retour arrière (commenté).
  assert.ok(raw.includes('as colonnes_4') && raw.includes('as index_12'))
  assert.ok(raw.includes('-- drop function if exists public.hb_lire_perimetre(text, timestamptz, integer);'))
  // L'appli : même nom et mêmes paramètres.
  const app = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.ok(app.includes("supabase!.rpc('hb_lire_perimetre', { p_table: table, p_curseur: req.since, p_limite: PULL_PAGE })"))
})

chain.then(
  () => console.log(`\n${n} tests réussis.`),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
