-- Claimed time waiting for Project Lead review (manual increases above the counted value and
-- outside-hours entries) is kept apart from finalMinutes and only counts once accepted.
ALTER TABLE "TimesheetCell" ADD COLUMN "pendingAdjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pendingOutsideMinutes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Timesheet" ADD COLUMN "pendingMinutes" INTEGER NOT NULL DEFAULT 0;

-- Manual increases still waiting for review move out of the counted adjustment.
WITH p AS (
  SELECT "cellId", SUM("deltaMinutes") AS minutes
  FROM "TimesheetAdjustment"
  WHERE "reviewStatus" = 'PENDING_PL' AND "deltaMinutes" > 0
  GROUP BY "cellId"
)
UPDATE "TimesheetCell" c
SET "pendingAdjustmentMinutes" = LEAST(GREATEST(c."adjustmentMinutes", 0), p.minutes),
    "adjustmentMinutes" = c."adjustmentMinutes" - LEAST(GREATEST(c."adjustmentMinutes", 0), p.minutes)
FROM p
WHERE p."cellId" = c."id";

-- Outside-hours entries still waiting for review: outsideHoursMinutes keeps the accepted part only.
WITH o AS (
  SELECT "lineId", "date", SUM("minutes") AS minutes
  FROM "OutsideHoursEntry"
  WHERE "reviewStatus" = 'PENDING_PL' AND "lineId" IS NOT NULL
  GROUP BY "lineId", "date"
)
UPDATE "TimesheetCell" c
SET "pendingOutsideMinutes" = LEAST(c."outsideHoursMinutes", o.minutes),
    "outsideHoursMinutes" = c."outsideHoursMinutes" - LEAST(c."outsideHoursMinutes", o.minutes)
FROM o
WHERE o."lineId" = c."lineId" AND o."date" = c."date";

UPDATE "TimesheetCell"
SET "finalMinutes" = GREATEST(0, "trackedMinutes" + "idleAsWorkMinutes" + "outsideHoursMinutes" + "adjustmentMinutes")
WHERE "pendingAdjustmentMinutes" > 0 OR "pendingOutsideMinutes" > 0;

-- Re-sum the sheets that had pending time.
UPDATE "Timesheet" t
SET "totalMinutes" = s.final,
    "adjustmentMinutes" = s.adj,
    "outsideHoursMinutes" = s.oh,
    "pendingMinutes" = s.pending
FROM (
  SELECT l."timesheetId",
         SUM(c."finalMinutes") AS final,
         SUM(c."adjustmentMinutes") AS adj,
         SUM(c."outsideHoursMinutes") AS oh,
         SUM(c."pendingAdjustmentMinutes" + c."pendingOutsideMinutes") AS pending
  FROM "TimesheetCell" c
  JOIN "TimesheetLine" l ON l."id" = c."lineId"
  GROUP BY l."timesheetId"
) s
WHERE s."timesheetId" = t."id" AND s.pending > 0;
