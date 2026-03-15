

import mongoose from "mongoose";
import Employee from "../schemas/employee.schema";
import Customer from "../schemas/customer.schema";
import Contract from "../schemas/contract.schema";
import Payment from "../schemas/payment.schema";
import { Balance } from "../schemas/balance.schema";
import { Expenses } from "../schemas/expenses.schema";
import Notes from "../schemas/notes.schema";
import { Debtor } from "../schemas/debtor.schema";
import BaseError from "../utils/base.error";
import logger from "../utils/logger";

export async function cascadeDeleteEmployee(
  employeeId: string,
  session?: mongoose.ClientSession
): Promise<void> {
  try {
    logger.debug(`🗑️ CASCADE DELETE: Employee ${employeeId}`);

    const customersCount = await Customer.countDocuments({
      manager: employeeId,
      isDeleted: false,
    }).session(session || null);

    if (customersCount > 0) {
      throw BaseError.BadRequest(
        `Employee o'chirishdan oldin ${customersCount} ta mijozni boshqa menegerga o'tkazish kerak!`
      );
    }

    const deletedBalance = await Balance.deleteOne({ managerId: employeeId }).session(
      session || null
    );
    logger.debug(`✅ Balance o'chirildi: ${deletedBalance.deletedCount} ta`);

    const updatedExpenses = await Expenses.updateMany(
      { managerId: employeeId, isActive: true },
      { $set: { isActive: false } }
    ).session(session || null);
    logger.debug(
      `✅ Expenses deactivated: ${updatedExpenses.modifiedCount} ta`
    );

    const updatedPayments = await Payment.updateMany(
      { managerId: employeeId },
      { $set: { managerId: null } }
    ).session(session || null);
    logger.debug(
      `✅ Payment.managerId → null: ${updatedPayments.modifiedCount} ta`
    );

    const updatedNotes = await Notes.updateMany(
      { createBy: employeeId },
      { $set: { createBy: null } }
    ).session(session || null);
    logger.debug(
      `✅ Notes.createBy → null: ${updatedNotes.modifiedCount} ta`
    );

    const updatedDebtors = await Debtor.updateMany(
      { createBy: employeeId },
      { $set: { createBy: null } }
    ).session(session || null);
    logger.debug(
      `✅ Debtor.createBy → null: ${updatedDebtors.modifiedCount} ta`
    );

    const updatedCustomerHistory = await Customer.updateMany(
      { "editHistory.editedBy": employeeId },
      { $set: { "editHistory.$[elem].editedBy": null } },
      { arrayFilters: [{ "elem.editedBy": employeeId }] }
    ).session(session || null);
    logger.debug(
      `✅ Customer.editHistory updated: ${updatedCustomerHistory.modifiedCount} ta`
    );

    const updatedContractHistory = await Contract.updateMany(
      { "editHistory.editedBy": employeeId },
      { $set: { "editHistory.$[elem].editedBy": null } },
      { arrayFilters: [{ "elem.editedBy": employeeId }] }
    ).session(session || null);
    logger.debug(
      `✅ Contract.editHistory updated: ${updatedContractHistory.modifiedCount} ta`
    );

    logger.debug(`✅ CASCADE DELETE Employee ${employeeId} completed`);
  } catch (error) {
    logger.error(`❌ CASCADE DELETE Employee ${employeeId} failed:`, error);
    throw error;
  }
}

export async function cascadeDeleteCustomer(
  customerId: string,
  session?: mongoose.ClientSession
): Promise<void> {
  try {
    logger.debug(`🗑️ CASCADE DELETE: Customer ${customerId}`);

    const activeContractsCount = await Contract.countDocuments({
      customer: customerId,
      status: "active",
      isDeleted: false,
    }).session(session || null);

    if (activeContractsCount > 0) {
      throw BaseError.BadRequest(
        `Customer o'chirishdan oldin ${activeContractsCount} ta active shartnomani yopish kerak!`
      );
    }

    const updatedContracts = await Contract.updateMany(
      { customer: customerId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    ).session(session || null);
    logger.debug(
      `✅ Contract logical delete: ${updatedContracts.modifiedCount} ta`
    );

    const updatedPayments = await Payment.updateMany(
      { customerId: customerId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    ).session(session || null);
    logger.debug(
      `✅ Payment logical delete: ${updatedPayments.modifiedCount} ta`
    );

    const updatedNotes = await Notes.updateMany(
      { customer: customerId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    ).session(session || null);
    logger.debug(
      `✅ Notes logical delete: ${updatedNotes.modifiedCount} ta`
    );

    logger.debug(`✅ CASCADE DELETE Customer ${customerId} completed`);
  } catch (error) {
    logger.error(`❌ CASCADE DELETE Customer ${customerId} failed:`, error);
    throw error;
  }
}

export async function cascadeDeleteContract(
  contractId: string,
  session?: mongoose.ClientSession
): Promise<void> {
  try {
    logger.debug(`🗑️ CASCADE DELETE: Contract ${contractId}`);

    const updatedPayments = await Payment.updateMany(
      { contractId: contractId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    ).session(session || null);
    logger.debug(
      `✅ Payment logical delete: ${updatedPayments.modifiedCount} ta`
    );

    const deletedDebtors = await Debtor.deleteMany({
      contractId: contractId,
    }).session(session || null);
    logger.debug(`✅ Debtor o'chirildi: ${deletedDebtors.deletedCount} ta`);

    logger.debug(`✅ CASCADE DELETE Contract ${contractId} completed`);
  } catch (error) {
    logger.error(`❌ CASCADE DELETE Contract ${contractId} failed:`, error);
    throw error;
  }
}
