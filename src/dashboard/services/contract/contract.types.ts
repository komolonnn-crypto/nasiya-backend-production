

import { Types } from "mongoose";
import { IEmployee } from "../../../schemas/employee.schema";

export interface ContractChange {
  field: string;
  oldValue: any;
  newValue: any;
  difference: number;
}

export interface ImpactSummary {
  underpaidCount: number;
  overpaidCount: number;
  totalShortage: number;
  totalExcess: number;
  additionalPaymentsCreated: number;
}

export interface ContractEditEntry {
  date: Date;
  editedBy: Types.ObjectId;
  changes: ContractChange[];
  affectedPayments: Types.ObjectId[];
  impactSummary: ImpactSummary;
}

export interface BalanceUpdate {
  dollar?: number;
  sum?: number;
}

export interface ContractCreationResult {
  message: string;
  contractId: Types.ObjectId;
}

export interface ContractUpdateResult {
  status: string;
  message: string;
  contractId: Types.ObjectId;
  changes: ContractChange[];
  impactSummary: ImpactSummary;
}
