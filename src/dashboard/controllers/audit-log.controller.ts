import { Request, Response, NextFunction } from "express";

import auditLogService from "../../services/audit-log.service";
import { AuditAction, AuditEntity } from "../../schemas/audit-log.schema";
import IJwtUser from "../../types/user";
import BaseError from "../../utils/base.error";
import logger from "../../utils/logger";
import dayjs from "dayjs";

class AuditLogController {
  async getDailyActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as IJwtUser;

      if (!["admin", "moderator"].includes(user.role)) {
        return next(
          BaseError.ForbiddenError("Sizda audit log ko'rish huquqi yo'q"),
        );
      }

      const dateParam = req.query.date as string;

      const { parseUzbekistanDate, getUzbekistanDayEnd } =
        await import("../../utils/helpers/date.helper");

      let selectedDate: Date | undefined;
      if (dateParam) {
        selectedDate = parseUzbekistanDate(dateParam);

        logger.debug("Audit Log Query", {
          dateParam,
          startDate: selectedDate.toISOString(),
          endDate: getUzbekistanDayEnd(dateParam).toISOString(),
        });
      }

      const limitParam =
        req.query.limit ? parseInt(req.query.limit as string) : 100;
      const limit = Math.min(limitParam, 500);

      const pageParam = req.query.page ? parseInt(req.query.page as string) : 1;
      const page = Math.max(1, pageParam);
      const skip = (page - 1) * limit;

      const action = req.query.action as string | undefined;
      const entity = req.query.entity as string | undefined;
      const employeeId = req.query.employeeId as string | undefined;
      const search = req.query.search as string | undefined;
      const minAmount =
        req.query.minAmount ?
          parseFloat(req.query.minAmount as string)
        : undefined;
      const maxAmount =
        req.query.maxAmount ?
          parseFloat(req.query.maxAmount as string)
        : undefined;

      logger.debug("Audit Log Filters", {
        dateParam: dateParam || "ALL",
        action,
        entity,
        employeeId,
        search,
        minAmount,
        maxAmount,
        page,
        limit,
      });

      const result = await auditLogService.getDailyActivity(
        selectedDate,
        limit,
        { action, entity, employeeId, search, minAmount, maxAmount },
        skip,
      );

      logger.debug("Audit Log Result", {
        dateParam: dateParam || "ALL",
        foundLogs: result.activities.length,
        totalInDB: result.total,
        page,
        filters: { action, entity, employeeId, search, minAmount, maxAmount },
      });

      res.status(200).json({
        status: "success",
        message: "Aktivlik muvaffaqiyatli olindi",
        data: {
          date: dateParam ? dayjs(selectedDate).format("YYYY-MM-DD") : null,
          activities: result.activities,
          total: result.total,
          limit,
          page,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  async getActivityStats(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as IJwtUser;

      if (!["admin", "moderator"].includes(user.role)) {
        return next(
          BaseError.ForbiddenError("Sizda audit log ko'rish huquqi yo'q"),
        );
      }

      const startParam = req.query.start as string;
      const endParam = req.query.end as string;

      const endDate = endParam ? new Date(endParam) : new Date();
      const startDate =
        startParam ?
          new Date(startParam)
        : dayjs().subtract(30, "day").toDate();

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return next(BaseError.BadRequest("Noto'g'ri sana formati"));
      }

      const stats = await auditLogService.getActivityStats(startDate, endDate);

      res.status(200).json({
        status: "success",
        message: "Statistika muvaffaqiyatli olindi",
        data: {
          period: {
            start: dayjs(startDate).format("YYYY-MM-DD"),
            end: dayjs(endDate).format("YYYY-MM-DD"),
          },
          stats,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  async getEntityHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as IJwtUser;

      if (!["admin", "moderator"].includes(user.role)) {
        return next(
          BaseError.ForbiddenError("Sizda audit log ko'rish huquqi yo'q"),
        );
      }

      const { entityType, entityId } = req.params;

      if (!Object.values(AuditEntity).includes(entityType as AuditEntity)) {
        return next(BaseError.BadRequest("Noto'g'ri entity turi"));
      }

      const history = await auditLogService.getEntityHistory(
        entityType as AuditEntity,
        entityId,
      );

      res.status(200).json({
        status: "success",
        message: "Entity history muvaffaqiyatli olindi",
        data: {
          entityType,
          entityId,
          history,
          total: history.length,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  async getUserActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as IJwtUser;

      if (!["admin", "moderator"].includes(user.role)) {
        return next(
          BaseError.ForbiddenError("Sizda audit log ko'rish huquqi yo'q"),
        );
      }

      const { userId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      const activity = await auditLogService.getUserActivity(userId, limit);

      res.status(200).json({
        status: "success",
        message: "User activity muvaffaqiyatli olindi",
        data: {
          userId,
          activity,
          total: activity.length,
          limit,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  async getFilteredActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as IJwtUser;

      if (!["admin", "moderator"].includes(user.role)) {
        return next(
          BaseError.ForbiddenError("Sizda audit log ko'rish huquqi yo'q"),
        );
      }

      const {
        date,
        entity,
        action,
        userId,
        limit = "100",
        page = "1",
      } = req.query as {
        date?: string;
        entity?: string;
        action?: string;
        userId?: string;
        limit?: string;
        page?: string;
      };

      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (date) {
        const { getUzbekistanDayStart, getUzbekistanDayEnd } =
          await import("../../utils/helpers/date.helper");
        startDate = getUzbekistanDayStart(date);
        endDate = getUzbekistanDayEnd(date);
      }

      const query: any = {};

      if (startDate && endDate) {
        query.timestamp = { $gte: startDate, $lte: endDate };
      }

      if (
        entity &&
        Object.values(AuditEntity).includes(entity as AuditEntity)
      ) {
        query.entity = entity;
      }

      if (
        action &&
        Object.values(AuditAction).includes(action as AuditAction)
      ) {
        query.action = action;
      }

      if (userId) {
        query.userId = userId;
      }

      const limitNum = parseInt(limit);
      const pageNum = parseInt(page);
      const skip = (pageNum - 1) * limitNum;

      const AuditLog = (await import("../../schemas/audit-log.schema")).default;

      const [activities, total] = await Promise.all([
        AuditLog.find(query)
          .populate("userId", "firstName lastName role")
          .sort({ timestamp: -1 })
          .limit(limitNum)
          .skip(skip)
          .lean(),
        AuditLog.countDocuments(query),
      ]);

      const activitiesWithContractId = activities.map((activity: any) => {
        let contractId = activity.metadata?.contractId || null;

        let customerId = null;
        if (activity.metadata?.customerId) {
          customerId = activity.metadata.customerId;
        } else if (activity.entity === "customer" && activity.entityId) {
          customerId = activity.entityId;
        } else if (activity.metadata?.affectedEntities?.length) {
          const customerEntity = activity.metadata.affectedEntities.find(
            (e: any) => e.entityType === "customer",
          );
          if (customerEntity) customerId = customerEntity.entityId;
        }

        return {
          ...activity,
          contractId,
          customerId,
        };
      });

      res.status(200).json({
        status: "success",
        message: "Filtrlangan aktivlik muvaffaqiyatli olindi",
        data: {
          activities: activitiesWithContractId,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
          filters: { date, entity, action, userId },
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  async getTodaySummary(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as IJwtUser;

      if (!["admin", "moderator"].includes(user.role)) {
        return next(
          BaseError.ForbiddenError("Sizda audit log ko'rish huquqi yo'q"),
        );
      }

      const today = new Date();
      const result = await auditLogService.getDailyActivity(today, 50);
      const activitiesWithContractId = result.activities;

      const summary = {
        totalActivities: activitiesWithContractId.length,
        customers: {
          created: activitiesWithContractId.filter(
            (a) => a.action === "CREATE" && a.entity === "customer",
          ).length,
          updated: activitiesWithContractId.filter(
            (a) => a.action === "UPDATE" && a.entity === "customer",
          ).length,
        },
        contracts: {
          created: activitiesWithContractId.filter(
            (a) => a.action === "CREATE" && a.entity === "contract",
          ).length,
          updated: activitiesWithContractId.filter(
            (a) => a.action === "UPDATE" && a.entity === "contract",
          ).length,
        },
        payments: {
          total: activitiesWithContractId.filter(
            (a) => a.action === "PAYMENT" && a.entity === "payment",
          ).length,
          confirmed: activitiesWithContractId.filter(
            (a) => a.action === "CONFIRM" && a.entity === "payment",
          ).length,
          rejected: activitiesWithContractId.filter(
            (a) => a.action === "REJECT" && a.entity === "payment",
          ).length,
        },
        excel_imports: activitiesWithContractId.filter(
          (a) => a.action === "BULK_IMPORT" && a.entity === "excel_import",
        ).length,
        users: {
          active: [...new Set(activitiesWithContractId.map((a) => a.userId))]
            .length,
          logins: activitiesWithContractId.filter((a) => a.action === "LOGIN")
            .length,
        },
      };

      res.status(200).json({
        status: "success",
        message: "Bugungi aktivlik summary muvaffaqiyatli olindi",
        data: {
          date: dayjs(today).format("YYYY-MM-DD"),
          summary,
          recentActivities: activitiesWithContractId.slice(0, 10),
        },
      });
    } catch (error) {
      return next(error);
    }
  }
}

export default new AuditLogController();
