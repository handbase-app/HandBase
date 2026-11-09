// Test des humeurs multiples du « journal du hand » (Geoffroy, 09/11 : « on peut être content et motivé, fier et
// concentré… ») : jusqu'à 3 humeurs par note (src/playerSpace.ts : cleanMoods, noteMoods, journalAdd, journalEdit, moodTrend,
// moodTrendSummary ; src/playerJournal.ts : fromRow), lecture des notes d'avant (une seule humeur dans `mood`), « Télécharger
// mes données », et cohérence avec supabase/076_humeurs_multiples.sql (même liste, même ordre, 3 au plus, une seule fonction
// de chaque nom, droits). L'essai du serveur lui-même : bash tools/essai-sql-076/lancer.sh (Docker). Données fictives.
//
//   npx jiti tools/test-humeurs.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  cleanMood,
  cleanMoods,
  JOURNAL_MOODS,
  journalAdd,
  journalEdit,
  MAX_MOODS,
  moodCounts,
  moodFields,
  moodLabel,
  moodTrend,
  moodTrendSummary,
  myDataExport,
  noteMoods,
  type JournalNote,
} from '../src/playerSpace'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}
const NOW = '2026-11-09T18:00:00.000Z'

t('3 humeurs au plus, connues, sans doublon, dans l’ordre de la liste ; une seule humeur acceptée aussi', () => {
  assert.equal(MAX_MOODS, 3)
  assert.deepEqual(cleanMoods(['content', 'motive']), ['motive', 'content'])
  assert.deepEqual(cleanMoods(['fatigue', 'pensif', 'fier']), ['fier', 'pensif', 'fatigue'])
  assert.deepEqual(cleanMoods(['fatigue', 'serein', 'motive', 'content', 'fier']), ['motive', 'content', 'fier'])
  assert.deepEqual(cleanMoods(['triste', 'fier', 'fier', 'FIER', 3, null]), ['fier'])
  assert.deepEqual(cleanMoods('concentre'), ['concentre'])
  assert.deepEqual(cleanMoods('triste'), [])
  assert.deepEqual(cleanMoods(undefined), [])
  assert.deepEqual(cleanMoods([]), [])
  assert.deepEqual(cleanMoods({ 0: 'fier' }), [])
  assert.equal(cleanMood('content'), 'content')
  assert.deepEqual(moodFields([]), {})
  assert.deepEqual(moodFields(['fier', 'concentre']), { mood: 'fier', moods: ['fier', 'concentre'] })
})

t('humeurs d’une note : `moods`, sinon `mood` seule (notes d’avant 076, serveur pas encore passé)', () => {
  assert.deepEqual(noteMoods({ mood: 'pensif' }), ['pensif'])
  assert.deepEqual(noteMoods({ mood: 'fier', moods: ['fier', 'concentre'] }), ['fier', 'concentre'])
  assert.deepEqual(noteMoods({ moods: [] }), [])
  assert.deepEqual(noteMoods({ moods: [], mood: 'serein' }), ['serein'])
  assert.deepEqual(noteMoods({}), [])
  assert.deepEqual(noteMoods(null), [])
  // Valeur inconnue (version plus récente, donnée abîmée) : ignorée, comme aujourd'hui.
  assert.deepEqual(noteMoods({ moods: ['inconnue', 'content'] as never }), ['content'])
})

t('ajout sur l’appareil (mode essai) : 1, 2 ou 3 humeurs, au-delà les 3 premières de la liste, aucune possible', () => {
  let r = journalAdd([], 'Une', ['fier'], NOW, 'n1')
  assert.deepEqual(r.ok && r.note, { id: 'n1', at: NOW, text: 'Une', mood: 'fier', moods: ['fier'], shared: false })
  r = journalAdd([], 'Content et motivé', ['content', 'motive'], NOW, 'n2')
  assert.deepEqual(r.ok && [r.note!.mood, r.note!.moods], ['motive', ['motive', 'content']])
  r = journalAdd([], 'Pensif, fatigué mais toujours fier', ['pensif', 'fatigue', 'fier'], NOW, 'n3')
  assert.deepEqual(r.ok && r.note!.moods, ['fier', 'pensif', 'fatigue'])
  r = journalAdd([], 'Trop', ['fatigue', 'serein', 'motive', 'content'], NOW, 'n4')
  assert.deepEqual(r.ok && r.note!.moods, ['motive', 'content', 'serein'])
  r = journalAdd([], 'Sans humeur', [], NOW, 'n5')
  assert.ok(r.ok && !('mood' in r.note!) && !('moods' in r.note!))
  r = journalAdd([], 'Inconnue', ['triste'], NOW, 'n6')
  assert.ok(r.ok && r.note!.moods === undefined && r.note!.mood === undefined)
  r = journalAdd([], 'Une seule, comme avant', 'serein', NOW, 'n7')
  assert.deepEqual(r.ok && r.note!.moods, ['serein'])
})

t('correction : humeurs remplacées, retirées, date et partage gardés', () => {
  const base: JournalNote[] = [{ id: 'a', at: '2026-11-01T08:00:00.000Z', text: 'Avant', mood: 'pensif', shared: true }]
  let r = journalEdit(base, 'a', 'Après', ['concentre', 'fier'], NOW)
  assert.deepEqual(r.ok && r.note, { id: 'a', at: '2026-11-01T08:00:00.000Z', text: 'Après', mood: 'fier', moods: ['fier', 'concentre'], shared: true, editedAt: NOW })
  r = journalEdit(r.ok ? r.notes : base, 'a', 'Après', [], NOW)
  assert.ok(r.ok && r.note!.mood === undefined && r.note!.moods === undefined)
  assert.equal((journalEdit(base, 'a', 'x', ['fier', 'motive', 'content', 'serein'], NOW) as { note: JournalNote }).note.moods!.length, 3)
})

t('tendance (staff) : chaque humeur d’une note compte une fois, le nombre de notes ne change pas ; phrase accordée', () => {
  const now = new Date('2026-11-11T12:00:00') // mercredi
  const notes: JournalNote[] = [
    { id: '1', at: '2026-11-10T09:00:00', text: 'secret 1', mood: 'motive', moods: ['motive', 'content'] },
    { id: '2', at: '2026-11-09T09:00:00', text: 'secret 2', mood: 'fier', moods: ['fier', 'concentre'] },
    { id: '3', at: '2026-11-09T19:00:00', text: 'secret 3', mood: 'fier', moods: ['fier', 'pensif', 'fatigue'] },
    { id: '4', at: '2026-11-09T20:00:00', text: 'secret 4' },
    { id: '5', at: '2026-11-03T09:00:00', text: 'avant 076', mood: 'content' },
  ]
  const tr = moodTrend(notes, now)
  assert.deepEqual(tr.weeks[7], { from: '2026-11-09', notes: 4, moods: { motive: 1, content: 1, fier: 2, concentre: 1, pensif: 1, fatigue: 1 } })
  assert.deepEqual(tr.weeks[6], { from: '2026-11-02', notes: 1, moods: { content: 1 } })
  assert.equal(tr.weeks.reduce((s, w) => s + w.notes, 0), 5)
  assert.ok(!JSON.stringify(tr).includes('secret'))
  assert.deepEqual(moodCounts(tr).slice(0, 2), [{ mood: 'content', n: 2 }, { mood: 'fier', n: 2 }])
  assert.equal(moodTrendSummary(tr, 'F'), 'surtout contente, un peu fière, un peu motivée')
  assert.equal(moodTrendSummary(tr, 'M'), 'surtout content, un peu fier, un peu motivé')
})

t('accords au féminin, une pastille par humeur', () => {
  const ms = cleanMoods(['pensif', 'fatigue', 'fier'])
  assert.deepEqual(ms.map((m) => moodLabel(m, 'F')), ['fière', 'pensive', 'fatiguée'])
  assert.deepEqual(ms.map((m) => moodLabel(m, 'M')), ['fier', 'pensif', 'fatigué'])
})

t('« Télécharger mes données » : toutes les humeurs de chaque note', () => {
  const d = myDataExport({ prenom: 'Alix' }, undefined, [
    { id: 'a', at: '2026-11-01T08:00:00.000Z', text: 'Deux', mood: 'fier', moods: ['fier', 'concentre'] },
    { id: 'b', at: '2026-10-01T08:00:00.000Z', text: 'Ancienne', mood: 'serein' },
    { id: 'c', at: '2026-09-01T08:00:00.000Z', text: 'Aucune' },
  ], NOW)
  assert.deepEqual(d.journal.map((x) => x.humeurs), [['fier', 'concentre'], ['serein'], []])
})

t('serveur (076) : même liste et même ordre, 3 au plus, mood = la première, une seule fonction de chaque nom, droits', () => {
  const sql = readFileSync(new URL('../supabase/076_humeurs_multiples.sql', import.meta.url), 'utf8')
  const list = sql.match(/array_position\(array\[([^\]]*)\]/)
  assert.ok(list, 'ordre des humeurs dans hb_self_moods')
  assert.deepEqual(list![1].split(',').map((x) => x.trim().replace(/'/g, '')), JOURNAL_MOODS.map((m) => m.id))
  assert.match(sql, /order by 2\s+limit 3\)/)
  assert.ok(sql.includes('public.hb_self_mood(x)'), 'liste fermée via hb_self_mood')
  assert.ok(sql.includes('drop function if exists public.hb_player_journal_add(text, text);'))
  assert.ok(sql.includes('drop function if exists public.hb_player_journal_edit(text, text, text);'))
  assert.ok(sql.includes('hb_player_journal_add(p_text text, p_mood text default null, p_moods text[] default null)'))
  assert.ok(sql.includes('hb_player_journal_edit(p_id text, p_text text, p_mood text default null, p_moods text[] default null)'))
  for (const f of ['hb_player_journal_add(text, text, text[])', 'hb_player_journal_edit(text, text, text, text[])', 'hb_player_mood_trend(text)']) {
    assert.ok(sql.includes(`revoke all on function public.${f} from public, anon;`), f)
    assert.ok(sql.includes(`grant execute on function public.${f} to authenticated;`), f)
  }
  assert.ok(sql.includes("'moods', case when cardinality(n.moods) > 0"), 'la note renvoie moods')
  assert.ok(sql.includes("'mood', n.mood"), 'et mood pour les anciennes versions')
  assert.ok(sql.includes('unnest(case when cardinality(j.moods) > 0 then j.moods'), 'tendance : chaque humeur compte')
  assert.ok(!/hb_upsert\s*\(/.test(sql), 'hb_upsert pas touché')
})

console.log(`\n${n} tests ok`)
