-- SPEC §5.2 (v0.3). Its own migration: a new enum value can't be used in the transaction that adds it.
alter type scan_method add value if not exists 'nfc';
