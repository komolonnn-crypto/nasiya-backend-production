import { Router } from "express";
import contractController from "../controllers/contract.controller";
import { authenticate } from "../../middlewares/auth.middleware";

const router = Router();

router.get("/active", authenticate, contractController.getActiveContracts);
router.get("/new", authenticate, contractController.getNewContracts);
router.get(
  "/completed",
  authenticate,
  contractController.getCompletedContracts
);

router.get("/:id", authenticate, contractController.getContractById);

router.put("/:id", authenticate, contractController.updateContract);

router.post("", authenticate, contractController.create);
router.post("/post", contractController.post);

export default router;
