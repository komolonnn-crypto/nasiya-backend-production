import { Request, Response, NextFunction } from "express";
import Employee from "../schemas/employee.schema";
import BaseError from "../utils/base.error";
import jwt from "../utils/jwt";
import logger from "../utils/logger";

export const checkPermission = (requiredPermission: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      if (!auth) {
        return next(BaseError.UnauthorizedError());
      }
      const accressToken = auth.split(" ")[1];
      if (!accressToken) {
        return next(BaseError.UnauthorizedError());
      }
      const userData = jwt.validateAccessToken(accressToken);
      if (!userData) {
        return next(BaseError.UnauthorizedError());
      }
      req.user = userData;

      const user = await Employee.findById(userData.sub)
        .populate("role")
        .exec();

      if (!user) return next(BaseError.UnauthorizedError());

      const userRole = user.role?.name;

      logger.debug("🔍 === PERMISSION CHECK ===");
      logger.debug("👤 User:", user.firstName, user.lastName);
      logger.debug("🎭 Role:", userRole);
      logger.debug("🔑 Required permission:", requiredPermission);

      if (userRole === "admin" || userRole === "moderator") {
        logger.debug("✅ Admin/Moderator - access granted");
        return next();
      }

      const rolePermissions: string[] =
        Array.isArray(user.role?.permissions) ?
          user.role!.permissions.map((p: any) =>
            typeof p === "string" ? p : p.name,
          )
        : [];

      const userPermissions: string[] =
        Array.isArray(user.permissions) ? user.permissions.map((p) => p) : [];

      const allPermissions = new Set([...rolePermissions, ...userPermissions]);

      logger.debug("📋 Role permissions:", rolePermissions);
      logger.debug("📋 User permissions:", userPermissions);
      logger.debug("📋 All permissions:", Array.from(allPermissions));
      logger.debug(
        "❓ Has required permission:",
        allPermissions.has(requiredPermission),
      );

      if (!allPermissions.has(requiredPermission)) {
        logger.debug("❌ Permission denied");
        return next(BaseError.ForbiddenError());
      }

      logger.debug("✅ Permission granted");
      logger.debug("=========================");

      next();
    } catch (error) {
      return next(BaseError.UnauthorizedError());
    }
  };
};
