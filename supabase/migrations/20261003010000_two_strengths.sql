-- Two strength levels instead of the book's four (her call 2026-10-03, to keep less of the book's ranking):
-- 2 = recommended (any bold in the book), 1 = pairs well.
update pairings set strength = 2 where strength > 2;
alter table pairings drop constraint pairings_strength_check;
alter table pairings add constraint pairings_strength_check check (strength between 1 and 2);
