-- Office holidays count as Present for everyone.
UPDATE "settings"
SET "value" = jsonb_set("value", '{statuses}', (
  SELECT jsonb_agg(CASE WHEN e->>'code' = 'H' THEN e || '{"bucket":"present","label":"Holiday (Present)"}'::jsonb ELSE e END ORDER BY ord)
  FROM jsonb_array_elements("value"->'statuses') WITH ORDINALITY AS t(e, ord)
))
WHERE "key" = 'app' AND jsonb_typeof("value"->'statuses') = 'array';
