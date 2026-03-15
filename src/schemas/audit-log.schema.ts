import { Schema, model } from "mongoose";
import { IEmployee } from "./employee.schema";

export enum AuditAction {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
  PAYMENT = "PAYMENT",
  BULK_IMPORT = "BULK_IMPORT",
  LOGIN = "LOGIN",
  LOGOUT = "LOGOUT",
  STATUS_CHANGE = "STATUS_CHANGE",
  POSTPONE = "POSTPONE",
  CONFIRM = "CONFIRM",
  REJECT = "REJECT",
  PAYMENT_CONFIRMED = "PAYMENT_CONFIRMED",
  PAYMENT_REJECTED = "PAYMENT_REJECTED",
}

export enum AuditEntity {
  CUSTOMER = "customer",
  CONTRACT = "contract",
  PAYMENT = "payment",
  EMPLOYEE = "employee",
  BALANCE = "balance",
  AUTH = "auth",
  EXCEL_IMPORT = "excel_import",
  EXPENSES = "expenses",
  DEBTOR = "debtor",
}

export interface IAuditMetadata {
  fileName?: string;
  totalRows?: number;
  successfulRows?: number;
  failedRows?: number;
  paymentType?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  amount?: number;
  originalAmount?: number;
  actualAmount?: number;
  remainingAmount?: number;
  excessAmount?: number;
  prepaidRecordId?: string;
  targetMonth?: number;
  contractId?: string;
  paymentCreatorId?: string;
  paymentCreatorName?: string;
  contractStatus?: string;
  monthlyPayment?: number;
  totalPrice?: number;
  dollar?: number;
  sum?: number;
  expensesNotes?: string;
  managerName?: string;
  employeeName?: string;
  employeeRole?: string;
  affectedEntities?: {
    entityType: string;
    entityId: string;
    entityName?: string;
  }[];
  customerName?: string;
  requestDuration?: number;
  browserInfo?: {
    userAgent: string;
    isMobile: boolean;
    browser: string;
  };
  errorMessage?: string;
  stackTrace?: string;
}

export interface IAuditLog {
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string;
  userId: string | IEmployee;
  userType: "employee" | "customer";
  changes?: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
  metadata?: IAuditMetadata;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: {
      type: String,
      enum: Object.values(AuditAction),
      required: true,
    },
    entity: {
      type: String,
      enum: Object.values(AuditEntity),
      required: true,
    },
    entityId: {
      type: String,
      required: false,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    userType: {
      type: String,
      enum: ["employee", "customer"],
      default: "employee",
    },
    changes: [
      {
        field: { type: String, required: true },
        oldValue: { type: Schema.Types.Mixed },
        newValue: { type: Schema.Types.Mixed },
        _id: false,
      },
    ],
    metadata: {
      fileName: String,
      totalRows: Number,
      successfulRows: Number,
      failedRows: Number,
      paymentType: String,
      paymentStatus: String,
      paymentMethod: String,
      amount: Number,
      originalAmount: Number,
      actualAmount: Number,
      remainingAmount: Number,
      excessAmount: Number,
      prepaidRecordId: String,
      targetMonth: Number,
      contractId: String,
      paymentCreatorId: String,
      paymentCreatorName: String,
      contractStatus: String,
      monthlyPayment: Number,
      totalPrice: Number,
      dollar: Number,
      sum: Number,
      expensesNotes: String,
      managerName: String,
      employeeName: String,
      employeeRole: String,
      customerName: String,
      affectedEntities: [
        {
          entityType: String,
          entityId: String,
          entityName: String,
          _id: false,
        },
      ],
      requestDuration: Number,
      browserInfo: {
        userAgent: String,
        isMobile: Boolean,
        browser: String,
      },
      errorMessage: String,
      stackTrace: String,
    },
    ipAddress: String,
    userAgent: String,
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1 });
AuditLogSchema.index({ entity: 1, entityId: 1, timestamp: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index(
  {
    timestamp: -1,
    entity: 1,
    action: 1,
  },
  {
    name: "idx_daily_activity",
  },
);

AuditLogSchema.index(
  {
    userId: 1,
    action: 1,
    timestamp: -1,
  },
  {
    name: "idx_user_action_activity",
  },
);

AuditLogSchema.index(
  {
    "metadata.customerName": "text",
    "metadata.affectedEntities.entityName": "text",
  },
  {
    name: "idx_search_text",
    weights: {
      "metadata.customerName": 10,
      "metadata.affectedEntities.entityName": 5,
    },
  },
);

const AuditLog = model<IAuditLog>("AuditLog", AuditLogSchema);

export default AuditLog;
