-- HandBase (base réelle) : restauration des critères modifiés par un administrateur, écrasés par l'import
-- du fichier de démo le 12/10/2026 vers 16 h 07. Valeurs reprises du journal (hb_audit, colonne « avant »).
-- On garde l'ordre issu de l'import et le champ importedAt ; on remet libellés, descriptions, postes et mode rapide,
-- et on réaffiche les 5 critères créés par l'administrateur que l'import en mode « Remplacer » avait masqués.
-- Relançable. Déclencheurs coupés (ce n'est pas une saisie) ; date serveur avancée pour que les appareils se mettent à jour.
begin;
set local session_replication_role = replica;

with now_ms as (select (extract(epoch from clock_timestamp()) * 1000)::bigint as ms),
fix(id, patch) as (values
  ('comm_def',       '{"label":"Communication"}'::jsonb),
  ('duel',           '{"label":"Duel 1C1"}'::jsonb),
  ('efficacite_tir', '{"label":"Duel Tireur/GB"}'::jsonb),
  ('gb_presence',    '{"label":"Anticipation","description":"Capacité à anticiper les tirs des adversaires"}'::jsonb),
  ('gb_relance',     '{"label":"Relances","description":"Remise en jeu rapide et précise, relances longues"}'::jsonb),
  ('gb_sorties',     '{"label":"Jeu avec le tireur","description":"Capacité à influencer le tir "}'::jsonb),
  ('interceptions',  '{"label":"Lecture du jeu ","description":"est capable d''adpter son comportement au jeu adverse"}'::jsonb),
  ('lecture',        '{"quick":false,"description":"D''adapte aux intentions de l’adversaire"}'::jsonb),
  ('placement_def',  '{"label":"Placement / Organisation"}'::jsonb),
  ('vision',         '{"positions":["AG","ARG","DC","ARD","AD","PIV"]}'::jsonb),
  ('1c026539-dec6-47a0-987b-7b8145c74920', '{"active":true}'::jsonb),
  ('2d5db9f2-d4dc-4bcf-908a-0a9d273cb596', '{"active":true}'::jsonb),
  ('62dea27f-6dc6-4c80-b395-4aa697e0ad48', '{"active":true}'::jsonb),
  ('a6cbd916-3503-4f7e-8da7-785333e273e4', '{"active":true}'::jsonb),
  ('c42b2024-dd98-408e-8229-a6eacca05220', '{"active":true}'::jsonb)
)
update public.hb_criteria c
   set data = c.data || f.patch || jsonb_build_object('updatedAt', n.ms),
       updated_at_client = n.ms,
       server_updated_at = clock_timestamp()
  from fix f, now_ms n
 where c.id = f.id;

-- Contrôle : 15 lignes, libellés restaurés, 5 critères personnalisés de nouveau visibles.
select id, data->>'label' as libelle, data->>'active' as actif
  from public.hb_criteria
 where id in ('comm_def','duel','efficacite_tir','gb_presence','gb_relance','gb_sorties','interceptions','lecture','placement_def','vision',
              '1c026539-dec6-47a0-987b-7b8145c74920','2d5db9f2-d4dc-4bcf-908a-0a9d273cb596','62dea27f-6dc6-4c80-b395-4aa697e0ad48',
              'a6cbd916-3503-4f7e-8da7-785333e273e4','c42b2024-dd98-408e-8229-a6eacca05220')
 order by id;
commit;
