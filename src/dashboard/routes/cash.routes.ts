import { Router } from "express";
import { Permission } from "../../enums/permission.enum";
import { checkPermission } from "../../middlewares/CheckPermission.middleware";
import { rateLimit } from "../../middlewares/rateLimit.middleware";
import cashController from "../controllers/cash.controller";

const router = Router();

const cashRateLimit = rateLimit(100, 60 * 1000);

router.get(
  "/get-all",
  cashRateLimit,
  checkPermission(Permission.VIEW_CASH),
  cashController.getAll
);

router.put(
  "/confirmation",
  cashRateLimit,
  checkPermission(Permission.UPDATE_CASH),
  cashController.confirmations
);

router.get(
  "/pending",
  cashRateLimit,
  checkPermission(Permission.VIEW_CASH),
  cashController.getPendingPayments
);

router.post(
  "/confirm-payments",
  cashRateLimit,
  checkPermission(Permission.UPDATE_CASH),
  cashController.confirmPayments
);

router.post(
  "/reject-payment",
  cashRateLimit,
  checkPermission(Permission.UPDATE_CASH),
  cashController.rejectPayment
);

export default router;
