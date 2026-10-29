-- 0007 · Trabajo programado cada hora (vencimientos, obligaciones vencidas, solicitudes atrasadas)
create extension if not exists pg_cron;
select cron.schedule('contabilidad-automatizaciones', '7 * * * *', $$select public.run_automations()$$);
