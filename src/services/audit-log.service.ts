import { Types } from "mongoose";

import AuditLog, {
  AuditAction,
  AuditEntity,
  IAuditMetadata,
} from "../schemas/audit-log.schema";
import logger from "../utils/logger";

class AuditLogService {
  async createLog(data: {
    action: AuditAction;
    entity: AuditEntity;
    entityId?: string;
    userId: string;
    userType?: "employee" | "customer";
    changes?: {
      field: string;
      oldValue: any;
      newValue: any;
    }[];
    metadata?: IAuditMetadata;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      logger.debug("🔍 AuditLogService.createLog called with data:", {
        action: data.action,
        entity: data.entity,
        entityId: data.entityId,
        userId: data.userId,
        userType: data.userType || "employee",
        changesCount: data.changes?.length || 0,
        hasMetadata: !!data.metadata,
      });

      const auditLogData = {
        ...data,
        userType: data.userType || "employee",
        timestamp: new Date(),
      };

      logger.debug("🔍 Creating audit log with final data:", auditLogData);

      const result = await AuditLog.create(auditLogData);

      logger.debug(
        `📝 Audit log created successfully: ${data.action} ${data.entity} by ${data.userId}`,
        {
          auditLogId: result._id,
          timestamp: result.timestamp,
        },
      );
    } catch (error) {
      logger.error("❌ Error creating audit log:", error);
      logger.error("❌ Audit log error details:", {
        message: (error as Error).message,
        stack: (error as Error).stack,
        inputData: data,
      });
    }
  }

  async logCustomerCreate(
    customerId: string,
    customerName: string,
    userId: string,
    metadata?: { source?: string; fileName?: string },
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.CREATE,
      entity: AuditEntity.CUSTOMER,
      entityId: customerId,
      userId,
      metadata: {
        ...metadata,
        affectedEntities: [
          {
            entityType: "customer",
            entityId: customerId,
            entityName: customerName,
          },
        ],
      },
    });
  }

  async logContractCreate(
    contractId: string,
    customerId: string,
    customerName: string,
    productName: string,
    totalPrice: number,
    userId: string,
    metadata?: { source?: string; fileName?: string },
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.CREATE,
      entity: AuditEntity.CONTRACT,
      entityId: contractId,
      userId,
      metadata: {
        ...metadata,
        contractId,
        totalPrice,
        affectedEntities: [
          {
            entityType: "contract",
            entityId: contractId,
            entityName: `${customerName} - ${productName}`,
          },
          {
            entityType: "customer",
            entityId: customerId,
            entityName: customerName,
          },
        ],
      },
    });
  }

  async logPaymentCreate(
    paymentId: string,
    contractId: string,
    customerId: string,
    customerName: string,
    amount: number,
    paymentType: string,
    targetMonth: number,
    userId: string,
    metadata?: {
      source?: string;
      fileName?: string;
      expectedAmount?: number;
      actualAmount?: number;
      paymentStatus?: string;
      remainingAmount?: number;
      excessAmount?: number;
    },
  ): Promise<void> {
    const paymentMetadata = {
      ...metadata,
      amount: metadata?.actualAmount || amount,
      expectedAmount: metadata?.expectedAmount || amount,
      paymentType,
      targetMonth,
      contractId,
      paymentStatus: metadata?.paymentStatus,
      remainingAmount: metadata?.remainingAmount,
      excessAmount: metadata?.excessAmount,
    };

    let entityName = `${customerName} - $${metadata?.actualAmount || amount}`;

    if (metadata?.paymentStatus === "UNDERPAID" && metadata?.remainingAmount) {
      entityName += ` (${targetMonth}-oy, ${metadata.remainingAmount}$ qarz)`;
    } else if (
      metadata?.paymentStatus === "OVERPAID" &&
      metadata?.excessAmount
    ) {
      entityName += ` (${targetMonth}-oy, +${metadata.excessAmount}$ ortiqcha)`;
    } else {
      entityName += ` (${targetMonth}-oy)`;
    }

    await this.createLog({
      action: AuditAction.PAYMENT,
      entity: AuditEntity.PAYMENT,
      entityId: paymentId,
      userId,
      metadata: {
        ...paymentMetadata,
        customerName,
        affectedEntities: [
          {
            entityType: "payment",
            entityId: paymentId,
            entityName,
          },
          {
            entityType: "contract",
            entityId: contractId,
            entityName: `Contract: ${customerName}`,
          },
          {
            entityType: "customer",
            entityId: customerId,
            entityName: customerName,
          },
        ],
      },
    });
  }

  async logExpensesCreate(
    expensesId: string,
    managerId: string,
    managerName: string,
    dollar: number,
    sum: number,
    notes: string,
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.CREATE,
      entity: AuditEntity.EXPENSES,
      entityId: expensesId,
      userId,
      metadata: {
        dollar,
        sum,
        expensesNotes: notes,
        managerName,
        affectedEntities: [
          {
            entityType: "expenses",
            entityId: expensesId,
            entityName: `${managerName} - $${dollar}`,
          },
          {
            entityType: "employee",
            entityId: managerId,
            entityName: managerName,
          },
        ],
      },
    });
  }

  async logExpensesReturn(
    expensesId: string,
    managerId: string,
    managerName: string,
    dollar: number,
    sum: number,
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.DELETE,
      entity: AuditEntity.EXPENSES,
      entityId: expensesId,
      userId,
      metadata: {
        dollar,
        sum,
        managerName,
        affectedEntities: [
          {
            entityType: "expenses",
            entityId: expensesId,
            entityName: `${managerName} - Qaytarildi ($${dollar})`,
          },
        ],
      },
    });
  }

  async logExcelImport(
    fileName: string,
    totalRows: number,
    successfulRows: number,
    failedRows: number,
    userId: string,
    affectedEntities: {
      entityType: string;
      entityId: string;
      entityName: string;
    }[],
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.BULK_IMPORT,
      entity: AuditEntity.EXCEL_IMPORT,
      userId,
      metadata: {
        fileName,
        totalRows,
        successfulRows,
        failedRows,
        affectedEntities,
      },
    });
  }

  async logCustomerUpdate(
    customerId: string,
    customerName: string,
    changes: { field: string; oldValue: any; newValue: any }[],
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.UPDATE,
      entity: AuditEntity.CUSTOMER,
      entityId: customerId,
      userId,
      changes,
      metadata: {
        affectedEntities: [
          {
            entityType: "customer",
            entityId: customerId,
            entityName: customerName,
          },
        ],
      },
    });
  }

  async logContractUpdate(
    contractId: string,
    customerId: string,
    customerName: string,
    changes: { field: string; oldValue: any; newValue: any }[],
    userId: string,
    affectedPaymentIds?: string[],
  ): Promise<void> {
    const affectedEntities = [
      {
        entityType: "contract",
        entityId: contractId,
        entityName: customerName,
      },
      {
        entityType: "customer",
        entityId: customerId,
        entityName: customerName,
      },
    ];

    if (affectedPaymentIds) {
      affectedPaymentIds.forEach((paymentId, index) => {
        affectedEntities.push({
          entityType: "payment",
          entityId: paymentId,
          entityName: `Payment ${index + 1}`,
        });
      });
    }

    await this.createLog({
      action: AuditAction.UPDATE,
      entity: AuditEntity.CONTRACT,
      entityId: contractId,
      userId,
      changes,
      metadata: {
        contractId,
        affectedEntities,
      },
    });
  }

  async logPaymentConfirm(
    paymentId: string,
    contractId: string,
    customerId: string,
    customerName: string,
    action: "confirm" | "reject",
    amount: number,
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: action === "confirm" ? AuditAction.CONFIRM : AuditAction.REJECT,
      entity: AuditEntity.PAYMENT,
      entityId: paymentId,
      userId,
      metadata: {
        amount,
        contractId,
        paymentStatus: action === "confirm" ? "confirmed" : "rejected",
        affectedEntities: [
          {
            entityType: "payment",
            entityId: paymentId,
            entityName: `${customerName} - ${amount}$`,
          },
          {
            entityType: "contract",
            entityId: contractId,
            entityName: `Contract: ${customerName}`,
          },
          {
            entityType: "customer",
            entityId: customerId,
            entityName: customerName,
          },
        ],
      },
    });
  }

  async logContractDelete(
    contractId: string,
    customerId: string,
    customerName: string,
    productName: string,
    userId: string,
    employeeName?: string,
    employeeRole?: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.DELETE,
      entity: AuditEntity.CONTRACT,
      entityId: contractId,
      userId,
      metadata: {
        contractId,
        employeeName,
        employeeRole,
        affectedEntities: [
          {
            entityType: "contract",
            entityId: contractId,
            entityName: `${customerName} - ${productName}`,
          },
          {
            entityType: "customer",
            entityId: customerId,
            entityName: customerName,
          },
          {
            entityType: "employee",
            entityId: userId,
            entityName: employeeName || "Unknown Employee",
          },
        ],
      },
    });
  }

  async logEmployeeCreate(
    employeeId: string,
    employeeName: string,
    role: string,
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.CREATE,
      entity: AuditEntity.EMPLOYEE,
      entityId: employeeId,
      userId,
      metadata: {
        employeeName,
        employeeRole: role,
        affectedEntities: [
          {
            entityType: "employee",
            entityId: employeeId,
            entityName: employeeName,
          },
        ],
      },
    });
  }

  async logEmployeeUpdate(
    employeeId: string,
    employeeName: string,
    role: string,
    changes: { field: string; oldValue: any; newValue: any }[],
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.UPDATE,
      entity: AuditEntity.EMPLOYEE,
      entityId: employeeId,
      userId,
      changes,
      metadata: {
        employeeName,
        employeeRole: role,
        affectedEntities: [
          {
            entityType: "employee",
            entityId: employeeId,
            entityName: employeeName,
          },
        ],
      },
    });
  }

  async logEmployeeDelete(
    employeeId: string,
    employeeName: string,
    role: string,
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.DELETE,
      entity: AuditEntity.EMPLOYEE,
      entityId: employeeId,
      userId,
      metadata: {
        employeeName,
        employeeRole: role,
        affectedEntities: [
          {
            entityType: "employee",
            entityId: employeeId,
            entityName: employeeName,
          },
        ],
      },
    });
  }

  async logCustomerDelete(
    customerId: string,
    customerName: string,
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.DELETE,
      entity: AuditEntity.CUSTOMER,
      entityId: customerId,
      userId,
      metadata: {
        affectedEntities: [
          {
            entityType: "customer",
            entityId: customerId,
            entityName: customerName,
          },
        ],
      },
    });
  }

  async logResetAll(userId: string, ipAddress?: string): Promise<void> {
    await this.createLog({
      action: AuditAction.DELETE,
      entity: AuditEntity.BALANCE,
      userId,
      ipAddress,
      metadata: {
        affectedEntities: [
          {
            entityType: "system",
            entityId: "reset",
            entityName: "Barcha ma'lumotlar tozalandi (RESET)",
          },
        ],
      },
    });
  }

  async logLogin(
    userId: string,
    userName: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.LOGIN,
      entity: AuditEntity.AUTH,
      userId,
      ipAddress,
      userAgent,
      metadata: {
        affectedEntities: [
          {
            entityType: "employee",
            entityId: userId,
            entityName: userName,
          },
        ],
      },
    });
  }

  async logCustomerRestoration(
    customerId: string,
    customerName: string,
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.STATUS_CHANGE,
      entity: AuditEntity.CUSTOMER,
      entityId: customerId,
      userId,
      metadata: {
        affectedEntities: [
          {
            entityType: "customer",
            entityId: customerId,
            entityName: customerName,
          },
        ],
      },
    });
  }

  async logBalanceUpdate(
    managerId: string,
    managerName: string,
    dollar: number,
    sum: number,
    userId: string,
    metadata?: {
      customerName?: string;
      contractId?: string;
      paymentType?: string;
    },
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.UPDATE,
      entity: AuditEntity.BALANCE,
      entityId: managerId,
      userId,
      metadata: {
        dollar,
        sum,
        managerName,
        ...metadata,
        affectedEntities: [
          {
            entityType: "employee",
            entityId: managerId,
            entityName: managerName,
          },
        ],
      },
    });
  }

  async logDebtorDeclare(
    contractId: string,
    customerName: string,
    debtAmount: number,
    userId: string,
  ): Promise<void> {
    await this.createLog({
      action: AuditAction.CREATE,
      entity: AuditEntity.DEBTOR,
      entityId: contractId,
      userId,
      metadata: {
        contractId,
        amount: debtAmount,
        customerName,
        affectedEntities: [
          {
            entityType: "debtor",
            entityId: contractId,
            entityName: `${customerName} - $${debtAmount}`,
          },
        ],
      },
    });
  }

  async getDailyActivity(
    date?: Date,
    limit: number = 100,
    filters?: {
      action?: string;
      entity?: string;
      employeeId?: string;
      search?: string;
      minAmount?: number;
      maxAmount?: number;
    },
    skip: number = 0,
  ): Promise<{ activities: any[]; total: number }> {
    const query: any = {};

    if (date) {
      const { getUzbekistanDayEnd } = require("../utils/helpers/date.helper");

      const startOfDay = date;
      const dateObj = new Date(date.getTime() + 5 * 60 * 60 * 1000);
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getUTCDate()).padStart(2, "0");
      const dateString = `${year}-${month}-${day}`;
      const endOfDay = getUzbekistanDayEnd(dateString);

      query.timestamp = {
        $gte: startOfDay,
        $lte: endOfDay,
      };
    }

    if (filters) {
      const andFilters: any[] = [];

      if (filters.action) {
        andFilters.push({ action: filters.action });
      }
      if (filters.entity) {
        andFilters.push({ entity: filters.entity });
      }
      if (filters.employeeId) {
        try {
          const empId = new Types.ObjectId(filters.employeeId);
          andFilters.push({
            $or: [
              { userId: empId },
              { "metadata.paymentCreatorId": filters.employeeId },
            ],
          });
        } catch (error) {
          console.error("❌ Invalid employeeId format:", filters.employeeId);
        }
      }
      if (filters.search) {
        andFilters.push({
          $or: [
            {
              "metadata.customerName": {
                $regex: filters.search,
                $options: "i",
              },
            },
            {
              "metadata.affectedEntities.entityName": {
                $regex: filters.search,
                $options: "i",
              },
            },
          ],
        });
      }
      if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
        const amountQuery: any = {};
        if (filters.minAmount !== undefined)
          amountQuery.$gte = filters.minAmount;
        if (filters.maxAmount !== undefined)
          amountQuery.$lte = filters.maxAmount;
        andFilters.push({ "metadata.amount": amountQuery });
      }

      if (andFilters.length > 0) {
        query.$and = andFilters;
      }
    }

    const [activities, total] = await Promise.all([
      AuditLog.find(query)
        .select("-userAgent -ipAddress")
        .populate("userId", "firstName lastName role")
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    const activitiesWithContractId = activities.map((activity: any) => {
      let contractId = activity.metadata?.contractId || null;

      if (!contractId && activity.entity === "contract") {
        contractId = activity.entityId || null;
      }

      if (!contractId && activity.metadata?.affectedEntities?.length) {
        const contractEntity = activity.metadata.affectedEntities.find(
          (e: any) => e.entityType === "contract",
        );
        if (contractEntity) contractId = contractEntity.entityId || null;
      }

      return { ...activity, contractId };
    });

    return { activities: activitiesWithContractId, total };
  }

  async getEntityHistory(entityType: AuditEntity, entityId: string) {
    const history = await AuditLog.find({
      entity: entityType,
      entityId,
    })
      .populate("userId", "firstName lastName role")
      .sort({ timestamp: -1 })
      .lean();

    const historyWithContractId = history.map((item: any) => {
      let contractId = item.metadata?.contractId || null;
      if (!contractId && item.entity === "contract")
        contractId = item.entityId || null;
      if (!contractId && item.metadata?.affectedEntities?.length) {
        const ce = item.metadata.affectedEntities.find(
          (e: any) => e.entityType === "contract",
        );
        if (ce) contractId = ce.entityId || null;
      }
      return { ...item, contractId };
    });

    return historyWithContractId;
  }

  async getUserActivity(userId: string, limit: number = 50) {
    const activity = await AuditLog.find({
      userId: new Types.ObjectId(userId),
    })
      .populate("userId", "firstName lastName role")
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const activityWithContractId = activity.map((item: any) => {
      let contractId = item.metadata?.contractId || null;
      if (!contractId && item.entity === "contract")
        contractId = item.entityId || null;
      if (!contractId && item.metadata?.affectedEntities?.length) {
        const ce = item.metadata.affectedEntities.find(
          (e: any) => e.entityType === "contract",
        );
        if (ce) contractId = ce.entityId || null;
      }
      return { ...item, contractId };
    });

    return activityWithContractId;
  }

  async getActivityStats(startDate: Date, endDate: Date) {
    const stats = await AuditLog.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            action: "$action",
            entity: "$entity",
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.entity",
          actions: {
            $push: {
              action: "$_id.action",
              count: "$count",
            },
          },
          totalCount: { $sum: "$count" },
        },
      },
    ]);

    return stats;
  }
}

export default new AuditLogService();
