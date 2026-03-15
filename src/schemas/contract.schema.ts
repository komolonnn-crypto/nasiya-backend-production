import { Schema, model, Types } from "mongoose";
import { BaseSchema, IBase } from "./base.schema";
import { ICustomer } from "./customer.schema";
import { IPayment } from "./payment.schema";
import { INotes } from "./notes.schema";
import { IEmployee } from "./employee.schema";

export interface IContractInfo {
  box: boolean;
  mbox: boolean;
  receipt: boolean;
  iCloud: boolean;
}

export const ContractInfoSchema = new Schema<IContractInfo>(
  {
    box: { type: Boolean, default: false },
    mbox: { type: Boolean, default: false },
    receipt: { type: Boolean, default: false },
    iCloud: { type: Boolean, default: false },
  },
  { _id: false },
);

export enum ContractStatus {
  ACTIVE = "active",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export interface IContractChange {
  field: string;
  oldValue: any;
  newValue: any;
  difference: number;
}

export interface IContractEdit {
  date: Date;
  editedBy: IEmployee | string;
  changes: IContractChange[];
  affectedPayments: (IPayment | string)[];
  impactSummary: {
    underpaidCount: number;
    overpaidCount: number;
    totalShortage: number;
    totalExcess: number;
    additionalPaymentsCreated: number;
  };
}

export interface IContract extends IBase {
  customId?: string;
  startDate: Date;
  initialPaymentDueDate?: Date;
  nextPaymentDate: Date;
  previousPaymentDate?: Date;
  postponedAt?: Date;
  originalPaymentDay?: number;
  isPostponedOnce?: boolean;
  customer: ICustomer;
  productName: string;
  originalPrice: number;
  price: number;
  initialPayment: number;
  period: number;
  monthlyPayment: number;
  totalPrice: number;
  percentage?: number;
  notes: INotes;
  info: IContractInfo;

  isDeclare: boolean;
  status: ContractStatus;
  payments: IPayment[] | string[];
  prepaidBalance?: number;
  currency?: "USD" | "UZS";
  editHistory?: IContractEdit[];
}

const ContractChangeSchema = new Schema<IContractChange>(
  {
    field: { type: String, required: true },
    oldValue: { type: Schema.Types.Mixed, required: true },
    newValue: { type: Schema.Types.Mixed, required: true },
    difference: { type: Number, required: true },
  },
  { _id: false },
);

const ContractEditSchema = new Schema<IContractEdit>(
  {
    date: { type: Date, required: true },
    editedBy: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    changes: { type: [ContractChangeSchema], required: true },
    affectedPayments: [
      {
        type: Schema.Types.ObjectId,
        ref: "Payment",
      },
    ],
    impactSummary: {
      underpaidCount: { type: Number, default: 0 },
      overpaidCount: { type: Number, default: 0 },
      totalShortage: { type: Number, default: 0 },
      totalExcess: { type: Number, default: 0 },
      additionalPaymentsCreated: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const ContractSchema = new Schema<IContract>(
  {
    customId: { type: String, required: false },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    productName: { type: String, required: true },
    originalPrice: { type: Number, required: true },
    price: { type: Number, required: true },
    initialPayment: { type: Number, required: true },
    percentage: { type: Number, default: 30 },
    period: { type: Number, required: false },
    initialPaymentDueDate: { type: Date, required: false },
    monthlyPayment: { type: Number },
    notes: {
      type: Schema.Types.ObjectId,
      ref: "Notes",
      required: true,
    },
    totalPrice: { type: Number, required: false },
    startDate: { type: Date, required: true },
    nextPaymentDate: { type: Date, required: false },
    previousPaymentDate: { type: Date, required: false },
    postponedAt: { type: Date, required: false },
    originalPaymentDay: { type: Number, required: false },
    isPostponedOnce: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(ContractStatus),
      default: ContractStatus.ACTIVE,
    },

    payments: [
      {
        type: Schema.Types.ObjectId,
        ref: "Payment",
        required: false,
      },
    ],

    info: { type: ContractInfoSchema, required: false },
    isDeclare: {
      type: Boolean,
      default: false,
    },
    prepaidBalance: { type: Number, default: 0 },
    currency: { type: String, enum: ["USD", "UZS"], default: "USD" },
    editHistory: { type: [ContractEditSchema], default: [] },
    ...BaseSchema,
  },
  {
    timestamps: true,
  },
);

const Contract = model<IContract>("Contract", ContractSchema);

export default Contract;
