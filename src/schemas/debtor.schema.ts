import { Schema, model, Document } from "mongoose";
import { IContract } from "./contract.schema";
import { IEmployee } from "./employee.schema";

export interface IDebtor extends Document {
  contractId: IContract;
  debtAmount: number;
  dueDate: Date;
  overdueDays: number;
  createBy: IEmployee;
}

const DebtorSchema = new Schema<IDebtor>(
  {
    contractId: {
      type: Schema.Types.ObjectId,
      ref: "Contract",
      required: true,
    },
    debtAmount: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    overdueDays: { type: Number, required: true, default: 0 },
    createBy: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: false,
    },
  },
  { timestamps: true }
);

export const Debtor = model<IDebtor>("Debtor", DebtorSchema);
