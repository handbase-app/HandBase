-- Ligues ultramarines : remplace la région unique « Outre-mer » par une ligue par territoire
-- (Antilles = Guadeloupe + Martinique, Guyane, La Réunion, Mayotte, Nouvelle-Calédonie) et ajoute leurs
-- « départements » (971, 972, 973, 974, 976, 988). « 97 » et « Outre-mer » restent pour un territoire non précisé.
-- Relançable. Les appareils reçoivent les listes à la synchronisation suivante.
with now_ms as (select (extract(epoch from clock_timestamp()) * 1000)::bigint as ms),
rows(id, data) as (
  select v.id, v.data || jsonb_build_object('id', v.id, 'updatedAt', n.ms, 'createdByName', 'Administration Supabase (SQL)', 'updatedByName', 'Administration Supabase (SQL)')
  from now_ms n, (values
    ('region-ant', '{"kind":"region","name":"Antilles","order":14}'::jsonb),
    ('region-guy', '{"kind":"region","name":"Guyane","order":15}'),
    ('region-reu', '{"kind":"region","name":"La Réunion","order":16}'),
    ('region-may', '{"kind":"region","name":"Mayotte","order":17}'),
    ('region-nc',  '{"kind":"region","name":"Nouvelle-Calédonie","order":18}'),
    ('region-om',  '{"kind":"region","name":"Ultramarins (non précisé)","order":19}'),
    ('dept-971', '{"kind":"department","code":"971","name":"Guadeloupe","order":971,"regionId":"region-ant"}'),
    ('dept-972', '{"kind":"department","code":"972","name":"Martinique","order":972,"regionId":"region-ant"}'),
    ('dept-973', '{"kind":"department","code":"973","name":"Guyane","order":973,"regionId":"region-guy"}'),
    ('dept-974', '{"kind":"department","code":"974","name":"La Réunion","order":974,"regionId":"region-reu"}'),
    ('dept-976', '{"kind":"department","code":"976","name":"Mayotte","order":976,"regionId":"region-may"}'),
    ('dept-988', '{"kind":"department","code":"988","name":"Nouvelle-Calédonie","order":988,"regionId":"region-nc"}'),
    ('dept-97',  '{"kind":"department","code":"97","name":"Ultramarins (non précisé)","order":970,"regionId":"region-om"}')
  ) as v(id, data)
)
insert into public.hb_lists (id, data, updated_at_client, deleted)
select r.id, r.data, (r.data ->> 'updatedAt')::bigint, false from rows r
on conflict (id) do update
  set data = public.hb_lists.data || excluded.data, updated_at_client = excluded.updated_at_client, deleted = false
returning id, data ->> 'name' as nom;
