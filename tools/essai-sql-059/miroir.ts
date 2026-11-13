// Miroir de supabase/059_filet_econome.sql (lancer.sh) : l'appareil (src/filet.ts) recalcule, depuis les lignes telles qu'il les
// reçoit (JSON), les empreintes que Postgres a calculées : chaque ligne (id, heure en µs, data::text), puis la fenêtre ; et la
// décision : registre identique → rien à relire ; une ligne manquante, une ligne au contenu changé → relecture. Deux écritures
// que JavaScript ne refait pas à l'identique (1.50, 1e-7) : empreinte différente (relecture), jamais l'inverse.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideFilet, ledgerEndPull, readFiletAnswer, rowHash, suaMicros, windowHash, type FiletPrint, type Ledger } from '../../src/filet'

type Row = { id: string; sua: string; data: Record<string, unknown>; h: string }
type Case = { lignes: Row[]; filet: FiletPrint }
const [ordinaire, difficile] = readFileSync(process.argv[2], 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l) as Case)
const all = { ordinaire, difficile }

async function check(name: string, rows: Row[], filet: FiletPrint, expectDiffer: string[] = []) {
  let same = 0
  for (const r of rows) {
    const us = suaMicros(r.sua)
    assert.ok(us !== null, `heure illisible ${r.sua}`)
    const h = await rowHash(r.id, us!, r.data)
    if (expectDiffer.includes(r.id)) assert.notEqual(h, r.h, `${r.id} : attendu différent (écriture non refaite à l'identique)`)
    else {
      assert.equal(h, r.h, `${name} ${r.id} : empreinte de ligne différente`)
      same++
    }
  }
  // Fenêtre : avec les empreintes du serveur, la même empreinte que hb_filet.
  assert.equal(filet.n, rows.length, `${name} : nombre de lignes`)
  assert.equal(await windowHash(rows.map((r) => r.h)), filet.e, `${name} : empreinte de fenêtre`)
  // Décision de l'appareil, registre complet depuis le début de la fenêtre, empreintes calculées par l'appareil.
  const answer = readFiletAnswer({ players: filet }, false)!.players
  const entries = await Promise.all(rows.map(async (r) => ({ id: r.id, us: suaMicros(r.sua)!, h: await rowHash(r.id, suaMicros(r.sua)!, r.data) })))
  const ledger = (es: typeof entries): Ledger => ledgerEndPull({}, 'players', es, filet.w!)
  const d = await decideFilet(answer, ledger(entries).players)
  if (expectDiffer.length) assert.equal(d.why, 'differente', `${name} : écriture non refaite → relecture`)
  else {
    assert.equal(d.why, 'identique', `${name} : registre identique → rien à relire`)
    assert.equal(d.confirm?.cursor, filet.m)
    assert.equal(d.confirm?.ids.length, rows.length)
    assert.equal((await decideFilet(answer, ledger(entries.slice(1)).players)).why, 'differente', `${name} : ligne manquante → relecture`)
    const forged = await rowHash(rows[0].id, entries[0].us, { ...rows[0].data, lastName: 'Contenu forgé' })
    assert.equal((await decideFilet(answer, ledger([{ ...entries[0], h: forged }, ...entries.slice(1)]).players)).why, 'differente', `${name} : contenu changé → relecture`)
  }
  console.log(`  ${name} : ${same} empreintes de lignes identiques au serveur${expectDiffer.length ? `, ${expectDiffer.length} différentes comme attendu (${expectDiffer.join(', ')})` : ''} ; fenêtre ${filet.n} lignes : ok`)
}

await check('fenêtre ordinaire (administrateur, joueurs)', all.ordinaire.lignes, all.ordinaire.filet)
const hard = all.difficile.lignes
await check('contenu difficile', hard.filter((r) => r.id === 'z-1' || r.id === 'z-2'), { ...all.difficile.filet, n: 2, e: await windowHash(hard.filter((r) => r.id === 'z-1' || r.id === 'z-2').map((r) => r.h)) })
await check('écritures non refaites à l’identique', hard, all.difficile.filet, ['z-3', 'z-4'])
console.log('miroir : ok')
