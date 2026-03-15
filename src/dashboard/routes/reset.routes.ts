import { Router } from "express";
import resetController from "../controllers/reset.controller";
import { authenticate } from "../../middlewares/auth.middleware";

const router = Router();

router.get("/stats", authenticate, resetController.getStats);

router.post("/all", authenticate, resetController.resetAll);

router.post("/check-contracts", authenticate, resetController.checkContracts);

export default router;
