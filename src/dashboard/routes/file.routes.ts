import { Router } from "express";
import fileController from "../controllers/file.controller";
import { authenticate } from "../../middlewares/auth.middleware";

const router = Router();

router.get(
  "/download/:type/:filename",
  authenticate,
  fileController.downloadFile
);

router.delete(
  "/delete/:customerId/:type",
  authenticate,
  fileController.deleteFile
);

export default router;
