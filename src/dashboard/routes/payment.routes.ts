import { Router } from "express";

import paymentController from "../controllers/payment.controller";
import { checkPermission } from "../../middlewares/CheckPermission.middleware";
import { authenticate } from "../../middlewares/auth.middleware";
import { Permission } from "../../enums/permission.enum";

const router = Router();

router.put(
  "",
  checkPermission(Permission.UPDATE_CASH),
  paymentController.update,
);

router.post(
  "/contract",
  authenticate,
  paymentController.payByContract,
);

router.get(
  "/history",
  checkPermission(Permission.VIEW_PAYMENT),
  paymentController.getPaymentHistory,
);

router.post(
  "/receive",
  checkPermission(Permission.UPDATE_CASH),
  paymentController.receivePayment,
);

router.post(
  "/confirm",
  checkPermission(Permission.UPDATE_CASH),
  paymentController.confirmPayment,
);

router.post(
  "/reject",
  checkPermission(Permission.UPDATE_CASH),
  paymentController.rejectPayment,
);

router.post(
  "/pay-all-remaining",
  authenticate,
  paymentController.payAllRemainingMonths,
);

router.post(
  "/pay-remaining",
  authenticate,
  paymentController.payRemaining,
);

router.post(
  "/check-expired",
  checkPermission(Permission.UPDATE_CASH),
  paymentController.checkAndRejectExpiredPayments,
);

router.patch("/edit-amount", authenticate, paymentController.editPaymentAmount);

export default router;
