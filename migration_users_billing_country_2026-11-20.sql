-- 20/11/2026 : users.billing_country n'existait pas. Toutes les lectures
-- « timezone, billing_country » échouaient (42703) et leur repli retirait
-- aussi le fuseau : chaque compte était traité à l'heure de Paris (créneau
-- d'envoi, rapports, rendez-vous). La colonne existe désormais, remplie
-- depuis la société ; le fuseau exact reste celui du navigateur.
alter table public.users add column if not exists billing_country text;

update public.users u
set billing_country = c.billing_country
from public.companies c
where c.id = u.company_id
  and u.billing_country is null
  and c.billing_country is not null;
