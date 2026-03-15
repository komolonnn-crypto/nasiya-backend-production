import { Request, Response } from "express";
import resetService from "../services/reset.service";
import logger from "../../utils/logger";
import auditLogService from "../../services/audit-log.service";

class ResetController {
  
  async resetAll(req: Request, res: Response) {
    try {
      const user = req.user;

      if (!user || !user.sub) {
        return res.status(401).json({
          success: false,
          message: "Autentifikatsiya talab qilinadi",
        });
      }

      const permissionCheck = await resetService.canReset(user.sub);
      if (!permissionCheck.canReset) {
        return res.status(403).json({
          success: false,
          message: permissionCheck.reason,
        });
      }

      const result = await resetService.resetAllData();

      await auditLogService.logResetAll(user.sub, req.ip);

      return res.status(200).json(result);
    } catch (error: any) {
      logger.error("Reset controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Server xatolik",
      });
    }
  }

  
  async getStats(req: Request, res: Response) {
    try {
      const user = req.user;

      if (!user || !user.sub) {
        return res.status(401).json({
          success: false,
          message: "Autentifikatsiya talab qilinadi",
        });
      }

      const permissionCheck = await resetService.canReset(user.sub);
      if (!permissionCheck.canReset) {
        return res.status(403).json({
          success: false,
          message: permissionCheck.reason,
        });
      }

      const stats = await resetService.getResetStats();

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      logger.error("Get stats error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Server xatolik",
      });
    }
  }

  
  async checkContracts(req: Request, res: Response) {
    try {
      const user = req.user;

      if (!user || !user.sub) {
        return res.status(401).json({
          success: false,
          message: "Autentifikatsiya talab qilinadi",
        });
      }

      const permissionCheck = await resetService.canReset(user.sub);
      if (!permissionCheck.canReset) {
        return res.status(403).json({
          success: false,
          message: permissionCheck.reason,
        });
      }

      const result = await resetService.checkAllContractsStatus();

      return res.status(200).json(result);
    } catch (error: any) {
      logger.error("Check contracts error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Server xatolik",
      });
    }
  }
}

export default new ResetController();
