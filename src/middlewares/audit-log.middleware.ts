import { Request, Response, NextFunction } from "express";
import auditLogService from "../services/audit-log.service";
import { AuditAction, AuditEntity } from "../schemas/audit-log.schema";
import IJwtUser from "../types/user";
import logger from "../utils/logger";

export const auditLogMiddleware = (
  action: AuditAction,
  entity: AuditEntity,
  options?: {
    getEntityId?: (req: Request, res: Response) => string | undefined;
    getEntityName?: (req: Request, res: Response) => string | undefined;
    skipIf?: (req: Request, res: Response) => boolean;
    includeBody?: boolean;
  }
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send;

    let responseData: any;
    
    res.send = function (data: any) {
      responseData = data;
      return originalSend.call(this, data);
    };

    res.on('finish', async () => {
      try {
        const user = req.user as IJwtUser;
        
        if (!user) return;

        if (options?.skipIf && options.skipIf(req, res)) {
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return;
        }

        let entityId: string | undefined;
        if (options?.getEntityId) {
          entityId = options.getEntityId(req, res);
        } else if (req.params.id) {
          entityId = req.params.id;
        } else if (req.params.customerId) {
          entityId = req.params.customerId;
        } else if (req.params.contractId) {
          entityId = req.params.contractId;
        } else if (req.params.paymentId) {
          entityId = req.params.paymentId;
        }

        let entityName: string | undefined;
        if (options?.getEntityName) {
          entityName = options.getEntityName(req, res);
        }

        let changes: { field: string; oldValue: any; newValue: any; }[] | undefined;
        if (action === AuditAction.UPDATE && options?.includeBody && req.body) {
          changes = Object.keys(req.body).map(field => ({
            field,
            oldValue: undefined,
            newValue: req.body[field],
          }));
        }

        const ipAddress = req.ip || 
          req.connection.remoteAddress || 
          (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          req.headers['x-real-ip'] as string ||
          'unknown';
          
        const userAgent = req.headers['user-agent'] || 'unknown';

        const requestStartTime = Date.now();

        const requestDuration = Date.now() - requestStartTime;

        const browserInfo = userAgent !== 'unknown' ? {
          userAgent,
          isMobile: /mobile/i.test(userAgent),
          browser: userAgent.includes('Chrome') ? 'Chrome' :
                   userAgent.includes('Firefox') ? 'Firefox' :
                   userAgent.includes('Safari') ? 'Safari' :
                   userAgent.includes('Edge') ? 'Edge' : 'Unknown',
        } : undefined;

        await auditLogService.createLog({
          action,
          entity,
          entityId,
          userId: user.sub,
          changes,
          metadata: {
            affectedEntities: entityId ? [{
              entityType: entity,
              entityId,
              entityName: entityName || `${entity}:${entityId}`,
            }] : undefined,
            requestDuration,
            browserInfo,
          },
          ipAddress,
          userAgent,
        });

      } catch (error) {
        logger.error("❌ Error in audit log middleware:", error);
      }
    });

    next();
  };
};

export const auditCustomerCreate = auditLogMiddleware(
  AuditAction.CREATE,
  AuditEntity.CUSTOMER,
  {
    getEntityId: (req, res) => {
      try {
        const responseBody = JSON.parse(res.get('audit-response') || '{}');
        return responseBody.data?.customer?._id || responseBody.data?._id;
      } catch {
        return undefined;
      }
    },
    getEntityName: (req, res) => {
      const { fullName } = req.body;
      return fullName;
    },
  }
);

export const auditCustomerUpdate = auditLogMiddleware(
  AuditAction.UPDATE,
  AuditEntity.CUSTOMER,
  {
    includeBody: true,
    getEntityName: (req, res) => {
      const { fullName } = req.body;
      return fullName || undefined;
    },
  }
);

export const auditContractCreate = auditLogMiddleware(
  AuditAction.CREATE,
  AuditEntity.CONTRACT,
  {
    getEntityId: (req, res) => {
      try {
        const responseBody = JSON.parse(res.get('audit-response') || '{}');
        return responseBody.data?.contract?._id || responseBody.data?._id;
      } catch {
        return undefined;
      }
    },
    getEntityName: (req, res) => {
      const { productName } = req.body;
      return productName;
    },
  }
);

export const auditContractUpdate = auditLogMiddleware(
  AuditAction.UPDATE,
  AuditEntity.CONTRACT,
  {
    includeBody: true,
  }
);

export const auditPaymentCreate = auditLogMiddleware(
  AuditAction.PAYMENT,
  AuditEntity.PAYMENT,
  {
    getEntityId: (req, res) => {
      try {
        const responseBody = JSON.parse(res.get('audit-response') || '{}');
        return responseBody.data?.payment?._id || responseBody.data?._id;
      } catch {
        return undefined;
      }
    },
  }
);

export const auditPaymentConfirm = auditLogMiddleware(
  AuditAction.CONFIRM,
  AuditEntity.PAYMENT
);

export const auditPaymentReject = auditLogMiddleware(
  AuditAction.REJECT,
  AuditEntity.PAYMENT
);

export const setAuditResponse = (res: Response, data: any) => {
  res.set('audit-response', JSON.stringify(data));
  return data;
};