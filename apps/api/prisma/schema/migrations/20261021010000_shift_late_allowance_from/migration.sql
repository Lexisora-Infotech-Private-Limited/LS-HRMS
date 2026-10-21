-- The day a shift's monthly late limit took effect (lates beyond it become half days only from then on).
ALTER TABLE "Shift" ADD COLUMN "lateMarksAllowedFrom" DATE;

-- A limit set before this column existed applies from today.
UPDATE "Shift" SET "lateMarksAllowedFrom" = (now() AT TIME ZONE 'Asia/Kolkata')::date WHERE "lateMarksAllowed" > 0;
