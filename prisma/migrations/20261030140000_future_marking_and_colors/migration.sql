-- P and AB can be entered for future dates; calmer status colours.
UPDATE "settings"
SET "value" = jsonb_set("value", '{statuses}', (
  SELECT jsonb_agg(
    CASE e->>'code'
      WHEN 'P'  THEN e || '{"plannable":true,"bg":"#ECFDF5","fg":"#047857"}'::jsonb
      WHEN 'AB' THEN e || '{"plannable":true,"bg":"#FFF1F2","fg":"#BE123C"}'::jsonb
      WHEN 'H'  THEN e || '{"bg":"#FFF7ED","fg":"#C2410C"}'::jsonb
      WHEN 'WO' THEN e || '{"bg":"#F4F4F5","fg":"#A1A1AA"}'::jsonb
      ELSE e END
    ORDER BY ord)
  FROM jsonb_array_elements("value"->'statuses') WITH ORDINALITY AS t(e, ord)
))
WHERE "key" = 'app' AND jsonb_typeof("value"->'statuses') = 'array';
