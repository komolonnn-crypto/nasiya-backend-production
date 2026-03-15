

import express, { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import prepaidController from "../controllers/prepaid.controller";

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

router.get("/all", authenticate, (req, res) =>
  prepaidController.getAllPrepaidRecords(req, res),
);

router.patch("/:recordId", authenticate, (req, res) =>
  prepaidController.updatePrepaidRecord(req, res),
);

router.delete("/:recordId", authenticate, (req, res) =>
  prepaidController.deletePrepaidRecord(req, res),
);

export default router;
