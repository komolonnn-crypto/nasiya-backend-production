

import { Types } from "mongoose";
import BaseError from "../../utils/base.error";
import Employee from "../../schemas/employee.schema";
import Contract, { ContractStatus } from "../../schemas/contract.schema";
import IJwtUser from "../../types/user";
import logger from "../../utils/logger";

export async function verifyContractEditPermission(
  userId: string,
  contractId: string
): Promise<{ authorized: boolean; reason?: string }> {
  try {
    const user = await Employee.findById(userId).populate("role").lean();

    if (!user) {
      return {
        authorized: false,
        reason: "User not found",
      };
    }

    const userRole = (user.role as any)?.name;
    if (userRole === "admin" || userRole === "moderator") {
      return { authorized: true };
    }

    const rolePermissions: string[] = Array.isArray(
      (user.role as any)?.permissions
    )
      ? (user.role as any).permissions.map((p: any) =>
          typeof p === "string" ? p : p.name
        )
      : [];

    const userPermissions: string[] = Array.isArray(user.permissions)
      ? user.permissions.map((p) => p)
      : [];

    const allPermissions = new Set([...rolePermissions, ...userPermissions]);

    if (!allPermissions.has("UPDATE_CONTRACT")) {
      return {
        authorized: false,
        reason: "Missing UPDATE_CONTRACT permission",
      };
    }

    const contract = await Contract.findById(contractId).lean();
    if (!contract) {
      return {
        authorized: false,
        reason: "Contract not found",
      };
    }

    if (userRole === "manager") {
      const contractCreator = contract.createBy?.toString();
      if (contractCreator !== userId) {
        return {
          authorized: false,
          reason: "Can only edit own contracts",
        };
      }
    }

    return { authorized: true };
  } catch (error) {
    logger.error("❌ Error verifying permission:", error);
    return {
      authorized: false,
      reason: "Permission verification failed",
    };
  }
}

export function validateContractEditInput(data: {
  monthlyPayment?: number;
  initialPayment?: number;
  totalPrice?: number;
  productName?: string;
  notes?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (data.monthlyPayment !== undefined) {
    if (typeof data.monthlyPayment !== "number" || isNaN(data.monthlyPayment)) {
      errors.push("Monthly payment must be a valid number");
    }
    if (data.monthlyPayment < 0) {
      errors.push("Monthly payment cannot be negative");
    }
    if (data.monthlyPayment > 1000000) {
      errors.push("Monthly payment exceeds maximum allowed value");
    }
  }

  if (data.initialPayment !== undefined) {
    if (typeof data.initialPayment !== "number" || isNaN(data.initialPayment)) {
      errors.push("Initial payment must be a valid number");
    }
    if (data.initialPayment < 0) {
      errors.push("Initial payment cannot be negative");
    }
    if (data.initialPayment > 10000000) {
      errors.push("Initial payment exceeds maximum allowed value");
    }
  }

  if (data.totalPrice !== undefined) {
    if (typeof data.totalPrice !== "number" || isNaN(data.totalPrice)) {
      errors.push("Total price must be a valid number");
    }
    if (data.totalPrice < 0) {
      errors.push("Total price cannot be negative");
    }
    if (data.totalPrice > 10000000) {
      errors.push("Total price exceeds maximum allowed value");
    }
  }

  if (data.productName !== undefined) {
    if (typeof data.productName !== "string") {
      errors.push("Product name must be a string");
    }
    if (data.productName.length > 200) {
      errors.push("Product name too long (max 200 characters)");
    }
    if (/<script|javascript:|onerror=/i.test(data.productName)) {
      errors.push("Product name contains invalid characters");
    }
  }

  if (data.notes !== undefined) {
    if (typeof data.notes !== "string") {
      errors.push("Notes must be a string");
    }
    if (data.notes.length > 5000) {
      errors.push("Notes too long (max 5000 characters)");
    }
    if (/<script|javascript:|onerror=/i.test(data.notes)) {
      errors.push("Notes contain invalid characters");
    }
  }

  if (
    data.totalPrice !== undefined &&
    data.initialPayment !== undefined &&
    data.totalPrice <= data.initialPayment
  ) {
    errors.push("Total price must be greater than initial payment");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface AuditLogEntry {
  timestamp: Date;
  userId: string;
  userName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changes: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    logger.debug("🔒 === AUDIT LOG ===");
    logger.debug(JSON.stringify(entry, null, 2));
    logger.debug("🔒 === END AUDIT LOG ===");

  } catch (error) {
    logger.error("❌ Failed to create audit log:", error);
  }
}

const editOperationTracker = new Map<string, number[]>();

export function checkRateLimit(
  userId: string,
  maxOperations: number = 10,
  windowMs: number = 60000
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const userOperations = editOperationTracker.get(userId) || [];

  const recentOperations = userOperations.filter(
    (timestamp) => now - timestamp < windowMs
  );

  if (recentOperations.length >= maxOperations) {
    const oldestOperation = Math.min(...recentOperations);
    const retryAfter = Math.ceil((oldestOperation + windowMs - now) / 1000);

    return {
      allowed: false,
      retryAfter,
    };
  }

  recentOperations.push(now);
  editOperationTracker.set(userId, recentOperations);

  if (editOperationTracker.size > 1000) {
    const cutoff = now - windowMs;
    for (const [key, operations] of editOperationTracker.entries()) {
      const recent = operations.filter((ts) => ts > cutoff);
      if (recent.length === 0) {
        editOperationTracker.delete(key);
      } else {
        editOperationTracker.set(key, recent);
      }
    }
  }

  return { allowed: true };
}

export function sanitizeContractForLogging(contract: any): any {
  if (!contract) return null;

  return {
    _id: contract._id,
    productName: contract.productName,
    totalPrice: contract.totalPrice,
    monthlyPayment: contract.monthlyPayment,
    status: contract.status,
    customer: contract.customer?._id || contract.customer,
    paymentsCount: contract.payments?.length || 0,
  };
}

export async function checkContractVersion(
  contractId: string,
  expectedVersion?: number
): Promise<{ valid: boolean; currentVersion: number }> {
  const contract = await Contract.findById(contractId).select("__v").lean();

  if (!contract) {
    throw BaseError.NotFoundError("Contract not found");
  }

  const currentVersion = (contract as any).__v || 0;

  if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
    return {
      valid: false,
      currentVersion,
    };
  }

  return {
    valid: true,
    currentVersion,
  };
}

export function buildSafeQuery(filters: {
  customerId?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
}): any {
  const query: any = { isDeleted: false };

  if (filters.customerId) {
    if (!Types.ObjectId.isValid(filters.customerId)) {
      throw BaseError.BadRequest("Invalid customer ID format");
    }
    query.customer = new Types.ObjectId(filters.customerId);
  }

  if (filters.status) {
    const validStatuses = Object.values(ContractStatus);
    if (!validStatuses.includes(filters.status as ContractStatus)) {
      throw BaseError.BadRequest("Invalid contract status");
    }
    query.status = filters.status;
  }

  if (filters.dateFrom || filters.dateTo) {
    query.startDate = {};
    if (filters.dateFrom) {
      const date = new Date(filters.dateFrom);
      if (isNaN(date.getTime())) {
        throw BaseError.BadRequest("Invalid dateFrom format");
      }
      query.startDate.$gte = date;
    }
    if (filters.dateTo) {
      const date = new Date(filters.dateTo);
      if (isNaN(date.getTime())) {
        throw BaseError.BadRequest("Invalid dateTo format");
      }
      query.startDate.$lte = date;
    }
  }

  return query;
}

