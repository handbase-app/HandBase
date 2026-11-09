// SQL de la lampe écrit par tools/seed-activite-poles.ts (10_lampe.sql, 11_reglage_lampe.sql et son retour), sur un petit jeu
// FICTIF (deux fiches de tools/essai-sql-074/essais.sql, j-5 et j-6), pour l'essai Docker (lancer.sh) : le fichier passe sur
// une base où 074 est passé, deux fois (rejouable), ne réécrit jamais une ligne existante, et le retour arrière de la lampe
// retire seulement ses lignes. Écrit le SQL sur la sortie standard.
//
//   npx jiti tools/essai-sql-074/jeu-fictif.ts > jeu.sql
import { lampeDe, LAMPE_AT, REGLAGE_LAMPE_RETOUR_SQL, REGLAGE_LAMPE_SQL, sqlLampe, type Activite } from '../seed-activite-poles'

const fin = '2026-11-08'
const reponses = (id: string) =>
  Array.from({ length: 60 }, (_, i) => new Date(Date.parse('2026-09-01T12:00:00Z') + i * 864e5).toISOString().slice(0, 10)).map((jour) => ({ jour, id }))
const a = { cahiers: [], lampes: [] } as unknown as Pick<Activite, 'cahiers' | 'lampes'>
for (const id of ['j-5', 'j-6']) {
  const l = lampeDe(id, { reponses: reponses(id) as never }, fin)
  a.cahiers.push(...l.cahiers)
  a.lampes.push(l.lampe ?? { player_id: id, coach: { attitude: 1 }, voeux: ['ballon'] })
}
const sql = sqlLampe(a as Activite)
const premier = a.cahiers.find((c) => c.player_id === 'j-5' && c.kind === 'cahier')!
process.stdout.write(`-- Jeu fictif de la lampe : ${a.cahiers.length} cahiers, ${a.lampes.length} lignes hb_lampe.
-- Lignes de « vrais comptes » posées avant : la ligne hb_lampe de j-6 (un encadrant) et le cahier de j-5 du ${premier.jour}.
insert into public.hb_lampe (player_id, saison, coach, coach_by, coach_at) values ('j-6', 2026, '{"attitude": 2}', '00000000-0000-0000-0000-0000000000c1', now());
insert into public.hb_player_journal (id, player_id, user_id, at, text, kind, jour, parts)
values ('vrai-cahier', 'j-5', '00000000-0000-0000-0000-0000000000e5', now(), 'Écrit par le jeune', 'cahier', '${premier.jour}', '{"travail": "Écrit par le jeune"}');
begin;
${sql}
commit;
begin;
${sql}
commit;
${REGLAGE_LAMPE_SQL}
select 'vraies lignes gardées : ' || (select coach::text || ' ' || (coach_by is not null)::text from public.hb_lampe where player_id = 'j-6')
       || ' ; ' || (select string_agg(id, ',') from public.hb_player_journal where player_id = 'j-5' and kind = 'cahier' and jour = '${premier.jour}' and not deleted) as gardes;
select 'lampe ouverte par le réglage : ' || public.hb_lp_actif()::text as reglage;
${REGLAGE_LAMPE_RETOUR_SQL}
-- Retour arrière de la lampe (partie de 07_retour_arriere.sql) : seulement les lignes de ce jeu.
begin;
delete from public.hb_player_journal w where w.player_id in ('j-5', 'j-6') and w.user_id is null;
delete from public.hb_lampe l where l.player_id in ('j-5', 'j-6') and l.coach_by is null and l.updated_at = '${LAMPE_AT}';
commit;
select 'après retour : cahiers ' || (select string_agg(id, ',') from public.hb_player_journal where player_id in ('j-5', 'j-6') and kind is not null)
       || ', lampes ' || (select string_agg(player_id || ' ' || coach::text, ',') from public.hb_lampe where player_id in ('j-5', 'j-6')) as retour;
`)
