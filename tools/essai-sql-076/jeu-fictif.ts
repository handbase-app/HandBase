// SQL du journal écrit par tools/seed-activite-poles.ts (06_journal.sql), sur un petit jeu FICTIF (fiche j-2 de
// tools/essai-sql-076/avant.sql), pour l'essai Docker (lancer.sh) : passé AVANT 076 (colonne moods absente : la première
// humeur dans mood, rien d'autre), puis APRÈS (2 ou 3 humeurs posées), deux fois (rejouable). Écrit le SQL sur la sortie
// standard, dans une transaction (le PRELUDE coupe les déclencheurs : set local).
//
//   npx jiti tools/essai-sql-076/jeu-fictif.ts > jeu.sql
import { sqlJournal, type Activite } from '../seed-activite-poles'

const journal = [
  { id: 'graine-0001', player_id: 'j-2', at: '2026-11-03T20:10:00+01:00', text: 'Bonne séance de tirs ce soir.', mood: 'content', moods: ['content', 'serein'], shared: true },
  { id: 'graine-0002', player_id: 'j-2', at: '2026-11-04T20:10:00+01:00', text: 'Défaite de peu, mais on a bien joué ensemble.', mood: 'fier', moods: ['fier', 'pensif', 'fatigue'], shared: false },
  { id: 'graine-0003', player_id: 'j-2', at: '2026-11-05T20:10:00+01:00', text: 'Objectif du mois : mieux communiquer.', mood: 'motive', moods: ['motive'], shared: false },
]
process.stdout.write(`begin;
${sqlJournal({ journal } as unknown as Activite)}
commit;
select 'graines : ' || string_agg(id || ' ' || coalesce(mood, '-') || ' ' || coalesce(to_jsonb(t) ->> 'moods', '(pas de colonne moods)'), ' ; ' order by id) as graines
  from public.hb_player_journal t where id like 'graine-%';
`)
