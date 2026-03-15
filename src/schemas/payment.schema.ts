import { model, Schema } from "mongoose";
import { INotes } from "./notes.schema";
import { ICustomer } from "./customer.schema";
import { IEmployee } from "./employee.schema";

export enum PaymentStatus {
  PAID = "PAID",
  UNDERPAID = "UNDERPAID",
  OVERPAID = "OVERPAID",
  PENDING = "PENDING",
  REJECTED = "REJECTED",
  SCHEDULED = "SCHEDULED",
}

export enum PaymentType {
  INITIAL = "initial",
  MONTHLY = "monthly",
  EXTRA = "extra",
}

export enum PaymentReason {
  MONTHLY_PAYMENT_INCREASE = "monthly_payment_increase",
  MONTHLY_PAYMENT_DECREASE = "monthly_payment_decrease",
  INITIAL_PAYMENT_CHANGE = "initial_payment_change",
  TOTAL_PRICE_CHANGE = "total_price_change",
}

export enum PaymentMethod {
  SOM_CASH = "som_cash",
  SOM_CARD = "som_card",
  DOLLAR_CASH = "dollar_cash",
  DOLLAR_CARD_VISA = "dollar_card_visa",
  FROM_ZAPAS = "from_zapas",
}

export enum ExcessHandling {
  NEXT_MONTH = "next_month",
  ZAPAS = "zapas",
}

export interface IPayment {
  amount: number;
  actualAmount?: number;
  date: Date;
  isPaid: boolean;
  paymentType: PaymentType;
  paymentMethod?: PaymentMethod;
  notes: INotes;
  customerId: ICustomer;
  managerId: IEmployee;
  contractId?: string;
  status?: PaymentStatus;
  remainingAmount?: number;
  excessAmount?: number;
  expectedAmount?: number;
  confirmedAt?: Date;
  confirmedBy?: IEmployee;
  linkedPaymentId?: IPayment | string;
  reason?: PaymentReason;
  prepaidAmount?: number;
  appliedToPaymentId?: IPayment | string;
  targetMonth?: number;
  nextPaymentDate?: Date;
  reminderDate?: Date;
  reminderComment?: string;
  postponedDays?: number;
  isReminderNotification?: boolean;
  excessHandling?: ExcessHandling;
  createdAt?: Date;
  updatedAt?: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    amount: { type: Number, required: true },
    actualAmount: { type: Number },
    date: { type: Date, required: true },
    isPaid: { type: Boolean, required: true, default: false },
    paymentType: {
      type: String,
      enum: Object.values(PaymentType),
      required: true,
      default: PaymentType.MONTHLY,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: false,
    },
    notes: {
      type: Schema.Types.ObjectId,
      ref: "Notes",
      required: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    managerId: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    contractId: { type: String, required: false },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
    },
    remainingAmount: { type: Number, default: 0 },
    excessAmount: { type: Number, default: 0 },
    expectedAmount: { type: Number },
    confirmedAt: { type: Date },
    confirmedBy: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
    },
    linkedPaymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: false,
    },
    reason: {
      type: String,
      enum: Object.values(PaymentReason),
      required: false,
    },
    prepaidAmount: { type: Number, default: 0 },
    appliedToPaymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: false,
    },
    targetMonth: { type: Number, required: true },
    nextPaymentDate: { type: Date, required: false },
    reminderDate: { type: Date, required: false },
    reminderComment: { type: String, required: false },
    postponedDays: { type: Number, required: false },
    isReminderNotification: { type: Boolean, default: false },
    excessHandling: {
      type: String,
      enum: Object.values(ExcessHandling),
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

PaymentSchema.index({ isPaid: 1, status: 1 }, { name: "idx_isPaid_status" });
PaymentSchema.index({ date: -1 }, { name: "idx_date" });

const Payment = model<IPayment>("Payment", PaymentSchema);

export default Payment;
