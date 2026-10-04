-- HandBase : noms des départements modifiables (comme les régions, 019_listes_regions.sql).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 019_listes_regions.sql.
--
-- Les noms des départements ne sont plus écrits dans l'appli : ils sont dans hb_lists (kind = 'department'),
-- et un administrateur les modifie dans Réglages → Départements. Le numéro (83, 13…) reste l'identifiant :
-- c'est lui qui est lu dans les licences, et utilisé par les secteurs des encadrants et les groupes.

insert into public.hb_lists (id, data, updated_at_client)
select 'dept-' || d.code,
       jsonb_build_object('id', 'dept-' || d.code, 'kind', 'department', 'code', d.code, 'name', d.name, 'order', d.ord, 'updatedAt', 1), 1
  from (values
    ('04', 'Alpes-de-Haute-Provence', 1), ('05', 'Hautes-Alpes', 2), ('06', 'Alpes-Maritimes', 3),
    ('13', 'Bouches-du-Rhône', 4), ('83', 'Var', 5), ('84', 'Vaucluse', 6)
  ) as d(code, name, ord)
on conflict (id) do nothing;

-- Vérification : les départements.
select data ->> 'code' as numero, data ->> 'name' as departement
  from public.hb_lists where data ->> 'kind' = 'department' and not deleted
 order by data ->> 'code';
