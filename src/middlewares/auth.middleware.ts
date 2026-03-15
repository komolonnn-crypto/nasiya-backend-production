import { Request, Response, NextFunction } from "express";
import BaseError from "../utils/base.error";
import jwt from "../utils/jwt";
import logger from "../utils/logger";

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const auth = req.headers.authorization;

    logger.debug("🔐 Authentication check:", {
      hasAuth: !!auth,
      authHeader: auth?.substring(0, 20) + "...",
    });

    if (!auth) {
      logger.error("❌ No authorization header");
      return next(BaseError.UnauthorizedError("Authorization header yo'q"));
    }

    const accessToken = auth.split(" ")[1];
    if (!accessToken) {
      logger.error("❌ No access token");
      return next(BaseError.UnauthorizedError("Access token yo'q"));
    }

    if (process.env.NODE_ENV === "development" && accessToken.startsWith("mock_token_")) {
      const Employee = (await import("../schemas/employee.schema")).default;
      const employeeId = accessToken.replace("mock_token_", "");
      const employee = await Employee.findById(employeeId);
      
      if (!employee) {
        logger.error("❌ Mock employee not found:", employeeId);
        return next(BaseError.UnauthorizedError("Mock employee not found"));
      }

      req.user = {
        sub: employee._id.toString(),
        _id: employee._id.toString(),
        role: employee.role.name as any,
        name: `${employee.firstName} ${employee.lastName}`,
      } as any;
      
      logger.info("🔧 Mock auth: Employee authenticated", {
        id: employee._id,
        role: employee.role,
        name: req.user.name,
      });
      
      return next();
    }

    const userData = jwt.validateAccessToken(accessToken);
    if (!userData) {
      logger.error("❌ Invalid access token");
      return next(BaseError.UnauthorizedError("Token yaroqsiz"));
    }

    req.user = userData;
    logger.debug("✅ User authenticated:", userData.name);
    next();
  } catch (error) {
    logger.error("❌ Authentication error:", error);
    return next(BaseError.UnauthorizedError("Autentifikatsiya xatosi"));
  }
};
