import BaseError from "../../utils/base.error";
import Contract, { ContractStatus } from "../../schemas/contract.schema";
import IJwtUser from "../../types/user";
import { Debtor } from "../../schemas/debtor.schema";
import Payment, { PaymentType } from "../../schemas/payment.schema";
import logger from "../../utils/logger";
import auditLogService from "../../services/audit-log.service";
import Customer from "../../schemas/customer.schema";

interface CategorizedDebts {
  overdue: any[];
  pending: any[];
  normal: any[];
}

class DebtorService {
  
  async getDebtors() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const debtors = await Contract.aggregate([
        {
          $match: {
            isActive: true,
            isDeleted: false,
            status: ContractStatus.ACTIVE,
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer",
            foreignField: "_id",
            as: "customer",
          },
        },
        { $unwind: "$customer" },
        {
          $lookup: {
            from: "employees",
            localField: "customer.manager",
            foreignField: "_id",
            as: "manager",
          },
        },
        {
          $unwind: {
            path: "$manager",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "payments",
            localField: "payments",
            foreignField: "_id",
            as: "paymentDetails",
          },
        },
        {
          $addFields: {
            contractTotalPaid: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: "$paymentDetails",
                      as: "p",
                      cond: { $eq: ["$$p.isPaid", true] },
                    },
                  },
                  as: "pp",
                  in: "$$pp.amount",
                },
              },
            },
            delayDays: {
              $max: [
                0,
                {
                  $dateDiff: {
                    startDate: "$nextPaymentDate",
                    endDate: today,
                    unit: "day",
                  },
                },
              ],
            },
          },
        },
        {
          $addFields: {
            contractRemainingDebt: {
              $subtract: ["$totalPrice", "$contractTotalPaid"],
            },
          },
        },
        {
          $addFields: {
            paidMonthsCount: {
              $size: {
                $filter: {
                  input: "$paymentDetails",
                  as: "p",
                  cond: {
                    $and: [
                      { $eq: ["$$p.isPaid", true] },
                      { $eq: ["$$p.paymentType", "monthly"] },
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: "$customer._id",
            fullName: { $first: "$customer.fullName" },
            phoneNumber: { $first: "$customer.phoneNumber" },
            managerFirstName: { $first: "$manager.firstName" },
            managerLastName: { $first: "$manager.lastName" },
            activeContractsCount: { $sum: 1 },
            totalPrice: { $sum: "$totalPrice" },
            totalPaid: { $sum: "$contractTotalPaid" },
            remainingDebt: { $sum: "$contractRemainingDebt" },
            nextPaymentDate: { $min: "$nextPaymentDate" },
            createdAt: { $first: "$createdAt" },
            contracts: {
              $push: {
                _id: "$_id",
                productName: "$productName",
                totalPrice: "$totalPrice",
                totalPaid: "$contractTotalPaid",
                remainingDebt: "$contractRemainingDebt",
                period: "$period",
                monthlyPayment: "$monthlyPayment",
                initialPayment: "$initialPayment",
                startDate: "$startDate",
                nextPaymentDate: "$nextPaymentDate",
                delayDays: "$delayDays",
                paidMonthsCount: "$paidMonthsCount",
              },
            },
            allDelayDays: { $addToSet: "$delayDays" },
          },
        },
        {
          $project: {
            _id: 1,
            fullName: "$fullName",
            phoneNumber: 1,
            manager: {
              $concat: [
                { $ifNull: ["$managerFirstName", ""] },
                " ",
                { $ifNull: ["$managerLastName", ""] },
              ],
            },
            totalPrice: 1,
            totalPaid: 1,
            remainingDebt: 1,
            nextPaymentDate: 1,
            activeContractsCount: 1,
            contracts: 1,
            createdAt: 1,
          },
        },
        { $sort: { remainingDebt: -1 } },
      ]);
      return debtors;
    } catch (error) {
      logger.error("Error fetching debtors report:", error);
      throw BaseError.InternalServerError(String(error));
    }
  }

  
  async getContract(startDate: string, endDate: string) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const filterDate = endDate ? new Date(endDate) : today;
      filterDate.setHours(23, 59, 59, 999);

      const isFiltered = !!(startDate && endDate);

      return await Contract.aggregate([
        {
          $match: {
            isDeleted: false,
            isActive: true,
            isDeclare: false,
            status: ContractStatus.ACTIVE,
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer",
            foreignField: "_id",
            as: "customer",
          },
        },
        { $unwind: "$customer" },
        {
          $lookup: {
            from: "employees",
            localField: "customer.manager",
            foreignField: "_id",
            as: "manager",
          },
        },
        {
          $unwind: {
            path: "$manager",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "payments",
            localField: "payments",
            foreignField: "_id",
            as: "paymentDetails",
          },
        },
        {
          $addFields: {
            virtualDueDate: {
              $dateFromParts: {
                year: { $year: filterDate },
                month: { $month: filterDate },
                day: {
                  $ifNull: [
                    "$originalPaymentDay",
                    { $dayOfMonth: "$startDate" },
                  ],
                },
                timezone: "Asia/Tashkent",
              },
            },
          },
        },
        {
          $addFields: {
            isPaidForTargetMonth: {
              $anyElementTrue: {
                $map: {
                  input: "$paymentDetails",
                  as: "p",
                  in: {
                    $and: [
                      { $eq: ["$$p.isPaid", true] },
                      { $eq: [{ $year: "$$p.date" }, { $year: filterDate }] },
                      { $eq: [{ $month: "$$p.date" }, { $month: filterDate }] },
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $match: {
            $expr: {
              $cond: [
                { $literal: isFiltered },
                {
                  $and: [
                    { $lte: ["$virtualDueDate", filterDate] },
                    { $eq: ["$isPaidForTargetMonth", false] },
                  ],
                },
                { $lte: ["$nextPaymentDate", filterDate] },
              ],
            },
          },
        },
        {
          $addFields: {
            delayDays: {
              $cond: [
                { $literal: isFiltered },
                {
                  $max: [
                    0,
                    {
                      $dateDiff: {
                        startDate: "$virtualDueDate",
                        endDate: filterDate,
                        unit: "day",
                      },
                    },
                  ],
                },
                {
                  $max: [
                    0,
                    {
                      $dateDiff: {
                        startDate: "$nextPaymentDate",
                        endDate: today,
                        unit: "day",
                      },
                    },
                  ],
                },
              ],
            },
            totalPaid: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: "$paymentDetails",
                      as: "p",
                      cond: { $eq: ["$$p.isPaid", true] },
                    },
                  },
                  as: "pp",
                  in: "$$pp.amount",
                },
              },
            },
            paidMonthsCount: {
              $size: {
                $filter: {
                  input: "$paymentDetails",
                  as: "p",
                  cond: {
                    $and: [
                      { $eq: ["$$p.isPaid", true] },
                      { $eq: ["$$p.paymentType", "monthly"] },
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $addFields: {
            remainingDebt: { $subtract: ["$totalPrice", "$totalPaid"] },
          },
        },
        {
          $match: {
            remainingDebt: { $gt: 0 },
          },
        },
        {
          $project: {
            _id: 1,
            contractId: "$_id",
            customerId: "$customer._id",
            fullName: "$customer.fullName",
            phoneNumber: "$customer.phoneNumber",
            manager: {
              $concat: [
                { $ifNull: ["$manager.firstName", ""] },
                " ",
                { $ifNull: ["$manager.lastName", ""] },
              ],
            },
            totalPrice: 1,
            totalPaid: 1,
            remainingDebt: 1,
            nextPaymentDate: 1,
            productName: 1,
            startDate: 1,
            delayDays: 1,
            initialPayment: 1,
            monthlyPayment: 1,
            period: 1,
            paidMonthsCount: 1,
            createdAt: 1,
          },
        },
        { $sort: { delayDays: -1 } },
      ]);
    } catch (error) {
      logger.error("Error fetching contracts by payment date:", error);
      throw BaseError.InternalServerError(
        "Shartnomalarni olishda xatolik yuz berdi",
      );
    }
  }

  
  async declareDebtors(user: IJwtUser, contractIds: string[]) {
    try {
      const contracts = await Contract.find({ _id: { $in: contractIds } }).populate("customer");
      let createdCount = 0;
      for (const contract of contracts) {
        contract.isDeclare = true;
        await contract.save();
        const existingDebtor = await Debtor.findOne({
          contractId: contract._id,
        });
        if (!existingDebtor) {
          const today = new Date();
          const overdueDays = Math.floor(
            (today.getTime() - contract.nextPaymentDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          await Debtor.create({
            contractId: contract._id,
            debtAmount: contract.monthlyPayment,
            dueDate: contract.nextPaymentDate,
            overdueDays: Math.max(0, overdueDays),
            createBy: user.sub,
          });
          createdCount++;

          const customerName = (contract.customer as any)?.fullName || "Noma'lum mijoz";
          await auditLogService.logDebtorDeclare(
            contract._id.toString(),
            customerName,
            contract.monthlyPayment,
            user.sub
          );
        }
      }
      return { message: "Qarzdorlar e'lon qilindi.", created: createdCount };
    } catch (error) {
      logger.error("❌ Error declaring debtors:", error);
      throw error;
    }
  }

  
  async createOverdueDebtors() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      logger.info("🔍 === CREATING OVERDUE DEBTORS ===");
      logger.info(`Today: ${today.toISOString()}`);

      const contracts = await Contract.find({
        isActive: true,
        isDeleted: false,
        isDeclare: false,
        status: ContractStatus.ACTIVE,
      }).populate("payments");

      logger.info(`📊 Checking ${contracts.length} active contract(s)`);

      let createdCount = 0;
      let skippedCount = 0;
      let overduePaymentsCount = 0;

      for (const contract of contracts) {
        const payments = contract.payments as any[];

        const overduePayments = payments.filter(
          (p) =>
            !p.isPaid &&
            p.paymentType === PaymentType.MONTHLY &&
            new Date(p.date) < today,
        );

        if (overduePayments.length === 0) {
          continue;
        }

        overduePaymentsCount += overduePayments.length;

        for (const payment of overduePayments) {
          const paymentDate = new Date(payment.date);

          const existingDebtor = await Debtor.findOne({
            contractId: contract._id,
            dueDate: paymentDate,
          });

          if (!existingDebtor) {
            const overdueDays = Math.floor(
              (today.getTime() - paymentDate.getTime()) / (1000 * 60 * 60 * 24),
            );

            await Debtor.create({
              contractId: contract._id,
              debtAmount: payment.amount,
              dueDate: paymentDate,
              overdueDays: Math.max(0, overdueDays),
              createBy: contract.createBy,
            });

            createdCount++;
            logger.debug(
              `✅ Debtor created: Contract ${contract._id}, Due: ${paymentDate.toISOString().split("T")[0]}, Overdue: ${overdueDays} days`,
            );
          } else {
            const overdueDays = Math.floor(
              (today.getTime() - paymentDate.getTime()) / (1000 * 60 * 60 * 24),
            );
            existingDebtor.overdueDays = Math.max(0, overdueDays);
            await existingDebtor.save();
            skippedCount++;
          }
        }
      }

      logger.info(
        `✅ Debtor creation completed: Found ${overduePaymentsCount} overdue payment(s), Created ${createdCount}, Updated ${skippedCount}`,
      );

      return {
        created: createdCount,
        updated: skippedCount,
        totalOverduePayments: overduePaymentsCount,
      };
    } catch (error) {
      logger.error("❌ Error creating overdue debtors:", error);
      throw BaseError.InternalServerError("Qarzdorlar yaratishda xatolik");
    }
  }

  private categorizeDebtors(debts: any[]): CategorizedDebts {
    const result: CategorizedDebts = {
      overdue: [],
      pending: [],
      normal: [],
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const contract of debts) {
      const payments = (contract.payments || []) as any[];

      for (const p of payments) {
        const paymentDate = p.date ? new Date(p.date) : null;
        const isPaid = !!p.isPaid;
        const status = p.status || null;

        const debtObj = {
          contractId: contract._id,
          contractCustomId: contract.customId || contract._id,
          productName: contract.productName,
          customerId: contract.customer || contract.customerId,
          paymentId: p._id,
          amount: p.amount || p.expectedAmount || 0,
          dueDate: paymentDate,
          overdueDays:
            paymentDate && paymentDate < today ?
              Math.floor(
                (today.getTime() - paymentDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : 0,
          isPaid,
          status,
          rawPayment: p,
        };

        if (!isPaid && debtObj.overdueDays > 0) {
          result.overdue.push(debtObj);
        } else if (!isPaid && status === "PENDING") {
          result.pending.push(debtObj);
        } else if (!isPaid) {
          result.normal.push(debtObj);
        }
      }
    }

    this.sortDebts(result);

    return result;
  }

  async getFilteredDebts(customerId: string, filter: string = "all") {
    try {
      const contracts = await Contract.find({
        customer: customerId,
        isActive: true,
        isDeleted: false,
        status: ContractStatus.ACTIVE,
      })
        .populate({ path: "payments", options: { sort: { date: -1 } } })
        .lean();

      const categorized = this.categorizeDebtors(contracts as any[]);

      return { success: true, data: categorized };
    } catch (error) {
      logger.error("Error fetching debts:", error);
      throw error;
    }
  }

  private sortDebts(categorized: CategorizedDebts): void {
    categorized.overdue.sort((a: any, b: any) => {
      if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
      return b.amount - a.amount;
    });

    categorized.pending.sort((a: any, b: any) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return db - da;
    });

    categorized.normal.sort((a: any, b: any) => {
      const da =
        a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const db =
        b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return b.amount - a.amount;
    });
  }
}

export default new DebtorService();
