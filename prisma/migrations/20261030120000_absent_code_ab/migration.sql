-- Absent is now coded "AB" (was "A").
UPDATE "attendance_records" SET "status" = 'AB' WHERE "status" = 'A';

UPDATE "settings"
SET "value" = jsonb_set("value", '{statuses}', (
  SELECT jsonb_agg(CASE WHEN e->>'code' = 'A' THEN e || '{"code":"AB"}'::jsonb ELSE e END ORDER BY ord)
  FROM jsonb_array_elements("value"->'statuses') WITH ORDINALITY AS t(e, ord)
))
WHERE "key" = 'app' AND jsonb_typeof("value"->'statuses') = 'array';
