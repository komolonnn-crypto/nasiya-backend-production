import { Router } from "express";
import paymentFixController from "../controllers/payment-fix.controller";

const router = Router();

router.get(
  "/fix-unpaid/:contractId",
  paymentFixController.fixUnpaidPayments
);

export default router;
