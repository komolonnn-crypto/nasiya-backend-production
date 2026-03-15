import express, { Router } from "express";

import { authenticate } from "../../middlewares/auth.middleware";
import debtorController from "../../dashboard/controllers/debtor.controller";

const router: Router = express.Router();

router.get("/customer/:customerId", authenticate, (req, res, next) =>
  debtorController.getDebtsForCustomer(req, res, next),
);

export default router;
