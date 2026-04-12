

import BaseError from "../../utils/base.error";
import Contract, { ContractStatus } from "../../schemas/contract.schema";
import logger from "../../utils/logger";
import auditLogService from "../../services/audit-log.service";
import {
  CreateContractDto,
  UpdateContractDto,
} from "../../validators/contract";
import IJwtUser from "../../types/user";
import Employee from "../../schemas/employee.schema";
import Notes from "../../schemas/notes.schema";
import Customer from "../../schemas/customer.schema";

import contractQueryService from "./contract/contract.query.service";
import contractEditHandler from "./contract/contract.edit.handler";
import contractBalanceHelper from "./contract/contract.balance.helper";
import contractPaymentHelper from "./contract/contract.payment.helper";

class ContractService {
  async getAll() {
    return contractQueryService.getAll();
  }

  async getAllNewContract() {
    return contractQueryService.getAllNewContract();
  }

  async getAllCompleted() {
    return contractQueryService.getAllCompleted();
  }

  async getContractById(contractId: string) {
    return contractQueryService.getContractById(contractId);
  }

  async update(data: UpdateContractDto, user: IJwtUser) {
    return contractEditHandler.update(data, user);
  }

  
  async analyzeContractEditImpact(
    contractId: string,
    changes: {
      monthlyPayment?: number;
      initialPayment?: number;
      totalPrice?: number;
    }
  ) {
    try {
      const contract = await Contract.findById(contractId).populate("payments");
      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      const changesArray: Array<{
        field: string;
        oldValue: any;
        newValue: any;
        difference: number;
      }> = [];

      if (changes.monthlyPayment !== undefined) {
        changesArray.push({
          field: "monthlyPayment",
          oldValue: contract.monthlyPayment,
          newValue: changes.monthlyPayment,
          difference: changes.monthlyPayment - contract.monthlyPayment,
        });
      }

      if (changes.initialPayment !== undefined) {
        changesArray.push({
          field: "initialPayment",
          oldValue: contract.initialPayment,
          newValue: changes.initialPayment,
          difference: changes.initialPayment - contract.initialPayment,
        });
      }

      if (changes.totalPrice !== undefined) {
        changesArray.push({
          field: "totalPrice",
          oldValue: contract.totalPrice,
          newValue: changes.totalPrice,
          difference: changes.totalPrice - contract.totalPrice,
        });
      }

      const Payment = (await import("../../schemas/payment.schema")).default;
      const { PaymentType } = await import("../../schemas/payment.schema");

      const impact = {
        underpaidCount: 0,
        overpaidCount: 0,
        totalShortage: 0,
        totalExcess: 0,
        additionalPaymentsCreated: 0,
      };

      const monthlyPaymentChange = changesArray.find(
        (c) => c.field === "monthlyPayment"
      );

      if (monthlyPaymentChange) {
        const paidMonthlyPayments = await Payment.find({
          _id: { $in: contract.payments },
          paymentType: PaymentType.MONTHLY,
          isPaid: true,
        });

        for (const payment of paidMonthlyPayments) {
          const diff = payment.amount - monthlyPaymentChange.newValue;

          if (diff < -0.01) {
            const shortage = Math.abs(diff);
            impact.underpaidCount++;
            impact.totalShortage += shortage;
            impact.additionalPaymentsCreated++;
          } else if (diff > 0.01) {
            const excess = diff;
            impact.overpaidCount++;
            impact.totalExcess += excess;
          }
        }
      }

      return {
        success: true,
        changes: changesArray,
        impact,
      };
    } catch (error) {
      logger.error("❌ Error analyzing impact:", error);
      throw error;
    }
  }

  
  async create(data: CreateContractDto, user: IJwtUser) {
    try {
      logger.debug("🚀 === CONTRACT CREATION STARTED ===");
      logger.debug("📋 Input data:", {
        customer: data.customer,
        productName: data.productName,
        initialPayment: data.initialPayment,
        totalPrice: data.totalPrice,
      });

      const {
        customer,
        customId,
        productName,
        originalPrice,
        price,
        initialPayment,
        percentage,
        period,
        monthlyPayment,
        initialPaymentDueDate,
        notes,
        totalPrice,
        box,
        mbox,
        receipt,
        iCloud,
        startDate,
        currency,
      } = data;

      const createBy = await Employee.findById(user.sub);
      if (!createBy) {
        throw BaseError.ForbiddenError("Mavjud bo'lmagan xodim");
      }
      logger.debug("👤 Employee found:", createBy._id);

      const customerDoc = await Customer.findById(customer).populate({
        path: "manager",
        select: "firstName lastName",
      });
      if (!customerDoc) {
        throw BaseError.NotFoundError("Mijoz topilmadi");
      }
      logger.debug("🤝 Customer found:", customerDoc._id);

      const mgrDoc = (customerDoc as any).manager as
        | { firstName?: string; lastName?: string }
        | null
        | undefined;
      const managerNameForAudit =
        mgrDoc?.firstName || mgrDoc?.lastName ?
          `${mgrDoc.firstName || ""} ${mgrDoc.lastName || ""}`.trim()
        : undefined;

      const newNotes = new Notes({
        text: notes || "Shartnoma yaratildi",
        customer,
        createBy: createBy._id,
      });
      await newNotes.save();
      logger.info("📝 Notes created:", newNotes._id);

      const contractStartDate = startDate ? new Date(startDate) : new Date();

      const nextPaymentDate = new Date(contractStartDate);
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

      const paymentDueDate = initialPaymentDueDate ? new Date(initialPaymentDueDate) : nextPaymentDate;
      const originalPaymentDay = paymentDueDate.getDate();

      logger.debug(`📅 Setting originalPaymentDay from ${initialPaymentDueDate ? 'initialPaymentDueDate' : 'nextPaymentDate'}: ${originalPaymentDay}`);

      let finalCustomId = customId;
      if (!finalCustomId) {
        const year = new Date().getFullYear().toString().slice(-2);
        const lastContract = await Contract.findOne().sort({ createdAt: -1 });
        const sequence = lastContract ? parseInt(lastContract.customId?.split('T')[1] || '0') + 1 : 1;
        finalCustomId = `${year}T${String(sequence).padStart(5, '0')}`;
        logger.debug(`✅ Generated customId: ${finalCustomId}`);
      }

      const contract = new Contract({
        customer,
        customId: finalCustomId,
        productName,
        originalPrice,
        price,
        initialPayment,
        percentage,
        period,
        monthlyPayment,
        initialPaymentDueDate: paymentDueDate,
        notes: newNotes._id,
        totalPrice,
        startDate: contractStartDate,
        nextPaymentDate: nextPaymentDate,
        originalPaymentDay: originalPaymentDay,
        isActive: true,
        createBy: createBy._id,
        info: {
          box: box || false,
          mbox: mbox || false,
          receipt: receipt || false,
          iCloud: iCloud || false,
        },
        payments: [],
        isDeclare: false,
        status: ContractStatus.ACTIVE,
        currency: currency || "USD",
      });

      await contract.save();
      logger.debug("📋 Contract created:", contract._id);

      const customerData = customerDoc as any;
      await auditLogService.logContractCreate(
        contract._id.toString(),
        customerData._id.toString(),
        customerData.fullName,
        data.productName,
        data.totalPrice,
        user.sub,
        managerNameForAudit ? { managerName: managerNameForAudit } : undefined,
      );

      const { PaymentCreatorHelper } = await import("../../utils/helpers/payment-creator.helper");
      const allMonthlyPayments = await PaymentCreatorHelper.createAllMonthlyPaymentsForContract({
        contractId: contract._id,
        period: period,
        monthlyPayment: monthlyPayment,
        startDate: contractStartDate,
        customerId: customer,
        managerId: createBy._id,
      });

      contract.payments = allMonthlyPayments.map((p) => p._id) as any;
      await contract.save();
      logger.debug(`📅 Added ${allMonthlyPayments.length} monthly payments to contract`);

      if (initialPayment && initialPayment > 0) {
        await contractPaymentHelper.createInitialPayment(
          contract,
          initialPayment,
          user
        );

        await contractBalanceHelper.updateBalance(createBy._id, {
          dollar: initialPayment,
          sum: 0,
        });
        logger.debug("💵 Balance updated with initial payment:", initialPayment);
      }

      logger.debug("🎉 === CONTRACT CREATION COMPLETED ===");
      return {
        message: "Shartnoma yaratildi.",
        contractId: contract._id,
      };
    } catch (error) {
      logger.error("❌ === CONTRACT CREATION FAILED ===");
      logger.error("Error:", error);
      throw error;
    }
  }

  
  async sellerCreate(data: CreateContractDto, user: IJwtUser) {
    try {
      logger.debug("🚀 === SELLER CONTRACT CREATION STARTED ===");

      const {
        customer,
        customId,
        productName,
        originalPrice,
        price,
        initialPayment,
        percentage,
        period,
        monthlyPayment,
        initialPaymentDueDate,
        notes,
        totalPrice,
        box,
        mbox,
        receipt,
        iCloud,
        startDate,
        currency,
      } = data;

      const createBy = await Employee.findById(user.sub);
      if (!createBy) {
        throw BaseError.ForbiddenError("Mavjud bo'lmagan xodim");
      }

      const customerDoc = await Customer.findById(customer);
      if (!customerDoc) {
        throw BaseError.NotFoundError("Mijoz topilmadi");
      }

      const newNotes = new Notes({
        text: notes || "Shartnoma yaratildi (Sotuvchi)",
        customer,
        createBy: createBy._id,
      });
      await newNotes.save();

      const contractStartDate = startDate ? new Date(startDate) : new Date();
      const nextPaymentDate = new Date(contractStartDate);
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

      const paymentDueDate = initialPaymentDueDate
        ? new Date(initialPaymentDueDate)
        : nextPaymentDate;
      const originalPaymentDay = paymentDueDate.getDate();

      let finalCustomId = customId;
      if (!finalCustomId) {
        const year = new Date().getFullYear().toString().slice(-2);
        const lastContract = await Contract.findOne().sort({ createdAt: -1 });
        const sequence = lastContract ? parseInt(lastContract.customId?.split('T')[1] || '0') + 1 : 1;
        finalCustomId = `${year}T${String(sequence).padStart(5, '0')}`;
        logger.debug(`✅ Generated customId: ${finalCustomId}`);
      }

      const contract = new Contract({
        customer,
        customId: finalCustomId,
        productName,
        originalPrice,
        price,
        initialPayment,
        percentage,
        period,
        monthlyPayment,
        initialPaymentDueDate: paymentDueDate,
        notes: newNotes._id,
        totalPrice,
        startDate: contractStartDate,
        nextPaymentDate: nextPaymentDate,
        originalPaymentDay: originalPaymentDay,
        isActive: false,
        createBy: createBy._id,
        info: {
          box: box || false,
          mbox: mbox || false,
          receipt: receipt || false,
          iCloud: iCloud || false,
        },
        payments: [],
        isDeclare: false,
        status: ContractStatus.ACTIVE,
        currency: currency || "USD",
      });

      await contract.save();

      logger.debug("🎉 === SELLER CONTRACT CREATION COMPLETED ===");
      return {
        message: "Shartnoma yaratildi. Tasdiqlashni kutmoqda.",
        contractId: contract._id,
      };
    } catch (error) {
      logger.error("❌ === SELLER CONTRACT CREATION FAILED ===");
      throw error;
    }
  }

  
  async approveContract(contractId: string, user: IJwtUser) {
    try {
      logger.debug("✅ === CONTRACT APPROVAL STARTED ===");

      const contract = await Contract.findById(contractId).populate("customer");
      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      if (contract.isActive) {
        throw BaseError.BadRequest("Shartnoma allaqachon tasdiqlangan");
      }

      contract.isActive = true;
      await contract.save();

      if (contract.initialPayment && contract.initialPayment > 0) {
        await contractPaymentHelper.createInitialPayment(
          contract,
          contract.initialPayment,
          user
        );

        const employee = await Employee.findById(user.sub);
        if (employee) {
          await contractBalanceHelper.updateBalance(employee._id, {
            dollar: contract.initialPayment,
            sum: 0,
          });
        }
      }

      logger.debug("🎉 === CONTRACT APPROVAL COMPLETED ===");
      return {
        message: "Shartnoma tasdiqlandi",
        contractId: contract._id,
      };
    } catch (error) {
      logger.error("❌ === CONTRACT APPROVAL FAILED ===");
      throw error;
    }
  }

  
  async deleteContract(contractId: string, user: IJwtUser) {
    try {
      logger.debug("🗑️ === CONTRACT SOFT DELETE STARTED ===");
      logger.debug(`Contract ID: ${contractId}`);

      const contract = await Contract.findById(contractId).populate("customer");
      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      if (contract.status === ContractStatus.ACTIVE) {
        const employee = await Employee.findById(user.sub).populate("role");
        const roleName = (employee?.role as any)?.name;
        const isAdmin = roleName === "admin";

        logger.debug(`👤 User role: ${roleName}, isAdmin: ${isAdmin}`);

        if (!isAdmin) {
          throw BaseError.BadRequest(
            "Aktiv shartnomani o'chirish uchun Admin huquqi kerak!"
          );
        }

        logger.debug("⚠️ Admin active shartnomani o'chirmoqda");
      }

      const Payment = (await import("../../schemas/payment.schema")).default;
      const paidPayments = await Payment.find({
        _id: { $in: contract.payments },
        isPaid: true,
      });

      let totalPaidAmount = 0;
      for (const payment of paidPayments) {
        totalPaidAmount += payment.actualAmount || payment.amount || 0;
      }

      logger.debug(`💰 Total paid amount to revert: $${totalPaidAmount}`);

      const { cascadeDeleteContract } = await import("../../middlewares/cascade.middleware");

      await cascadeDeleteContract(contractId);

      if (totalPaidAmount > 0) {
        const managerId = (contract.createBy as any)?._id || contract.createBy || user.sub;
        await contractBalanceHelper.revertBalance(managerId, {
          dollar: totalPaidAmount,
          sum: 0,
        });
        logger.debug(`✅ Balance reverted: -$${totalPaidAmount} from manager ${managerId}`);
      }

      contract.isDeleted = true;
      contract.deletedAt = new Date();
      await contract.save();

      const customerData = contract.customer as any;
      const employee = await Employee.findById(user.sub).populate("role");
      const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : "Unknown";
      const employeeRole = (employee?.role as any)?.name || "unknown";

      await auditLogService.logContractDelete(
        contractId,
        customerData._id.toString(),
        customerData.fullName,
        contract.productName,
        user.sub,
        employeeName,
        employeeRole
      );

      logger.debug("🎉 === CONTRACT SOFT DELETE COMPLETED ===");
      return {
        message: "Shartnoma muvaffaqiyatli o'chirildi (tiklash mumkin)",
        contractId: contract._id,
        revertedAmount: totalPaidAmount,
        deleteType: "soft",
      };
    } catch (error) {
      logger.error("❌ === CONTRACT SOFT DELETE FAILED ===");
      throw error;
    }
  }

  
  async hardDeleteContract(contractId: string, user: IJwtUser) {
    try {
      logger.debug("🔥 === CONTRACT HARD DELETE STARTED ===");
      logger.debug(`Contract ID: ${contractId}`);

      const contract = await Contract.findById(contractId).populate("customer");
      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      const employee = await Employee.findById(user.sub).populate("role");
      const roleName = (employee?.role as any)?.name;
      const canHardDelete = roleName === "admin" || roleName === "moderator";

      logger.debug(`👤 User role: ${roleName}, canHardDelete: ${canHardDelete}`);

      if (!canHardDelete) {
        throw BaseError.ForbiddenError(
          "Butunlay o'chirish uchun Admin yoki Moderator huquqi kerak!"
        );
      }

      const Payment = (await import("../../schemas/payment.schema")).default;
      const paidPayments = await Payment.find({
        _id: { $in: contract.payments },
        isPaid: true,
        isDeleted: false,
      });

      let totalPaidAmount = 0;
      for (const payment of paidPayments) {
        totalPaidAmount += payment.actualAmount || payment.amount || 0;
      }

      logger.debug(`💰 Total paid amount to revert: $${totalPaidAmount}`);

      if (totalPaidAmount > 0 && !contract.isDeleted) {
        const managerId = (contract.createBy as any)?._id || contract.createBy || user.sub;
        await contractBalanceHelper.revertBalance(managerId, {
          dollar: totalPaidAmount,
          sum: 0,
        });
        logger.debug(`✅ Balance reverted: -$${totalPaidAmount} from manager ${managerId}`);
      }

      const Notes = (await import("../../schemas/notes.schema")).default;
      const { Debtor } = await import("../../schemas/debtor.schema");

      await Payment.deleteMany({ _id: { $in: contract.payments } });
      logger.debug(`✅ Deleted ${contract.payments.length} payments permanently`);

      const deletedDebtors = await Debtor.deleteMany({ contractId: contractId });
      logger.debug(`✅ Deleted ${deletedDebtors.deletedCount} debtors permanently`);

      if (contract.notes) {
        await Notes.findByIdAndDelete(contract.notes);
        logger.debug(`✅ Deleted notes permanently`);
      }

      const customerData = contract.customer as any;
      const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : "Unknown";

      await auditLogService.logContractDelete(
        contractId,
        customerData._id.toString(),
        customerData.fullName,
        contract.productName,
        user.sub,
        employeeName,
        `${roleName} (HARD DELETE)`
      );

      await Contract.findByIdAndDelete(contractId);
      logger.debug("🔥 Contract PERMANENTLY deleted from database");

      logger.debug("🎉 === CONTRACT HARD DELETE COMPLETED ===");
      return {
        message: "Shartnoma butunlay o'chirildi (tiklab bo'lmaydi!)",
        contractId: contractId,
        revertedAmount: totalPaidAmount,
        deleteType: "hard",
        deletedBy: employeeName,
        deletedRole: roleName,
      };
    } catch (error) {
      logger.error("❌ === CONTRACT HARD DELETE FAILED ===");
      throw error;
    }
  }
}

export default new ContractService();
