import { model, Schema, Types } from "mongoose";
import { ICustomer } from "./customer.schema";
import { IEmployee } from "./employee.schema";
import { IContract } from "./contract.schema";
import { PaymentMethod } from "./payment.schema";

export interface IPrepaidRecord {
  amount: number;
  date: Date;
  paymentMethod?: PaymentMethod;
  createdBy: IEmployee;
  customer: ICustomer;
  contract: IContract;
  contractId?: string;
  notes?: string;
  relatedPaymentId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const PrepaidRecordSchema = new Schema<IPrepaidRecord>(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    date: {
      type: Date,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ["som_cash", "som_card", "dollar_cash", "dollar_card_visa"],
      required: false,
    },
    createdBy: {
      type: Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    customer: {
      type: Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    contract: {
      type: Types.ObjectId,
      ref: "Contract",
      required: true,
    },
    contractId: {
      type: String,
      required: false,
    },
    notes: {
      type: String,
      required: false,
    },
    relatedPaymentId: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

PrepaidRecordSchema.index(
  { customer: 1, contract: 1 },
  { name: "idx_customer_contract" },
);
PrepaidRecordSchema.index({ date: -1 }, { name: "idx_date" });
PrepaidRecordSchema.index({ createdBy: 1 }, { name: "idx_createdBy" });

const PrepaidRecord = model<IPrepaidRecord>(
  "PrepaidRecord",
  PrepaidRecordSchema,
);

export default PrepaidRecord;
