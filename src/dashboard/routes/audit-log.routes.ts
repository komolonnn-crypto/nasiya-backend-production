import { Router } from "express";
import auditLogController from "../controllers/audit-log.controller";
import { authenticate } from "../../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/today-summary", auditLogController.getTodaySummary);

router.get("/daily", auditLogController.getDailyActivity);

router.get("/stats", auditLogController.getActivityStats);

router.get("/filter", auditLogController.getFilteredActivity);

router.get(
  "/entity/:entityType/:entityId",
  auditLogController.getEntityHistory,
);

router.get("/user/:userId", auditLogController.getUserActivity);

export default router;
