-- PLAN §6.1. Badge taps are a new scan method. ALTER TYPE ... ADD VALUE must commit before any
-- statement uses the value, so it lives alone in its own migration.
alter type scan_method add value if not exists 'nfc';
