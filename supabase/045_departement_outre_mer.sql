-- HandBase : département des joueurs des clubs ultramarins.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 044_structure.sql. Sans risque, relançable.
--
-- Le n° de club FFHB commence par la ligue (2 chiffres) puis le département (2 chiffres) : 6383015 → 83.
-- Les ligues ultramarines n'ont qu'un territoire et leurs clubs sont numérotés 6401xxx, 6501xxx… : « 01 » n'est pas
-- l'Ain mais la Guadeloupe. Même règle que l'appli (src/components/PlayerFilter.tsx, department).
create or replace function public.hb_player_dept(p jsonb) returns text
language sql immutable as $$
  select case
    when coalesce(p ->> 'clubCode', '') ~ '^\d{7}$' or coalesce(p ->> 'license', '') ~ '^\d{13}$' then
      (select case left(c, 2)
                when '64' then '971' when '65' then '973' when '66' then '972'
                when '67' then '988' when '69' then '974' when '70' then '976'
                else substr(c, 3, 2)
              end
         from (select case when coalesce(p ->> 'clubCode', '') ~ '^\d{7}$' then p ->> 'clubCode' else p ->> 'license' end c) x)
    else nullif(trim(coalesce(p ->> 'department', '')), '')
  end
$$;
