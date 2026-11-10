-- Conseiller Supabase 0011 : search_path figé sur la fonction utilitaire.
alter function private.apply_conventions(regclass) set search_path = '';
