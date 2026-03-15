import express, { Router } from "express";

import prepaidController from "../../dashboard/controllers/prepaid.controller";
import { authenticate } from "../../middlewares/auth.middleware";

const router: Router = express.Router();

router.get("/history/:customerId", authenticate, (req, res) =>
  prepaidController.getPrepaidHistory(req, res),
);

router.get("/contract/:contractId", authenticate, (req, res) =>
  prepaidController.getPrepaidByContract(req, res),
);

router.get("/stats/:customerId", authenticate, (req, res) =>
  prepaidController.getPrepaidStats(req, res),
);

router.get("/balance/:contractId", authenticate, (req, res) =>
  prepaidController.getContractBalance(req, res),
);

export default router;
