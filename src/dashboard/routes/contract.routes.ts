import { Router } from "express";
import { Permission } from "../../enums/permission.enum";
import { checkPermission } from "../../middlewares/CheckPermission.middleware";
import contractController from "../controllers/contract.controller";
import BaseError from "../../utils/base.error";
import contractDateController from "../controllers/contract.controller.date";

const router = Router();

router.get(
  "/get-all",
  checkPermission(Permission.VIEW_CONTRACT),
  contractController.getAll,
);

router.get(
  "/get-new-all",
  checkPermission(Permission.VIEW_CONTRACT),
  contractController.getNewAll,
);

router.get(
  "/get-all-completed",
  contractController.getAllCompleted,
);

router.get(
  "/get-contract-by-id/:id",
  checkPermission(Permission.VIEW_CONTRACT),
  contractController.getContractById,
);

router.get(
  "/get-contract-by-id",
  checkPermission(Permission.VIEW_CONTRACT),
  (req, res, next) => {
    const id = (req.query.id as string) || "";
    if (!id) {
      return next(BaseError.BadRequest("Missing contract id"));
    }

    req.params.id = id;
    return contractController.getContractById(req, res, next);
  },
);

router.post(
  "",
  checkPermission(Permission.CREATE_CONTRACT),
  contractController.create,
);

router.put(
  "",
  checkPermission(Permission.UPDATE_CONTRACT),
  contractController.update,
);

router.post(
  "/seller",
  checkPermission(Permission.CONTRACT_CREATE_MANAGER),
  contractController.sellerCreate,
);

router.post(
  "/approve/:id",
  checkPermission(Permission.UPDATE_CONTRACT),
  contractController.approveContract,
);

router.post(
  "/analyze-impact/:id",
  checkPermission(Permission.UPDATE_CONTRACT),
  contractController.analyzeImpact,
);

router.delete(
  "/delete/:id",
  checkPermission(Permission.DELETE_CONTRACT),
  contractController.deleteContract,
);

router.delete(
  "/hard-delete/:id",
  checkPermission(Permission.DELETE_CONTRACT),
  contractController.hardDeleteContract,
);

router.delete(
  "/bulk-hard-delete",
  checkPermission(Permission.DELETE_CONTRACT),
  contractController.bulkHardDeleteContracts,
);

router.post(
  "/update-start-date",
  checkPermission(Permission.UPDATE_CONTRACT),
  contractDateController.updateStartDate,
);

router.post(
  "/preview-date-change",
  checkPermission(Permission.VIEW_CONTRACT),
  contractDateController.previewDateChange,
);

export default router;
