-- migration_notify_channel_default_2026-08-14.sql
-- Change uniquement la valeur PAR DÉFAUT de la colonne (les comptes déjà
-- créés, dont le tien, ne sont volontairement pas modifiés ici — seuls les
-- nouveaux comptes créés après cette migration recevront 'both' par défaut).
-- Le code (webhook Stripe + rejoindre une société via code d'invitation)
-- envoie déjà explicitement 'both' à la création : cette migration aligne la
-- valeur par défaut de la colonne elle-même pour rester cohérente si un
-- futur chemin de création de compte oublie de le préciser.

alter table users alter column notify_channel set default 'both';
