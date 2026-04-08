import { Types } from "mongoose";

import Contract from "../../schemas/contract.schema";
import Customer from "../../schemas/customer.schema";
import { Debtor } from "../../schemas/debtor.schema";

import IJwtUser from "../../types/user";
import logger from "../../utils/logger";
import BaseError from "../../utils/base.error";

class CustomerService {
  async getAll(user: IJwtUser) {
    const totalCustomers = await Customer.countDocuments({
      isActive: true,
      isDeleted: false,
    });

    const managerCustomers = await Customer.countDocuments({
      isActive: true,
      isDeleted: false,
      manager: user.sub,
    });

    const customers = await Customer.find({
      isActive: true,
      isDeleted: false,
      manager: user.sub,
    }).select("fullName _id phoneNumber");

    if (customers.length > 0) {
      logger.debug("Sample customer:", {
        fullName: customers[0].fullName,
        phoneNumber: customers[0].phoneNumber,
      });
    }

    return {
      status: "success",
      data: customers,
    };
  }

  async getAllDebtors(user: IJwtUser, filterDate?: string) {
    try {
      let filterEndDate: Date;

      if (filterDate && filterDate.trim() !== "") {
        const [year, month, day] = filterDate.split("-").map(Number);
        filterEndDate = new Date(year, month - 1, day, 23, 59, 59, 999);
      } else {
        filterEndDate = new Date();
        filterEndDate.setHours(23, 59, 59, 999);
      }

      const managerId = new Types.ObjectId(user.sub);

      const result = await Contract.aggregate([
        {
          $match: {
            isActive: true,
            isDeleted: false,
            status: "active",
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer",
            foreignField: "_id",
            as: "customerData",
          },
        },
        {
          $unwind: { path: "$customerData", preserveNullAndEmptyArrays: false },
        },
        {
          $match: {
            "customerData.manager": managerId,
            "customerData.isActive": true,
            "customerData.isDeleted": false,
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
            unpaidPayments: {
              $filter: {
                input: "$paymentDetails",
                as: "p",
                cond: { $eq: ["$$p.isPaid", false] },
              },
            },
            paidPayments: {
              $filter: {
                input: "$paymentDetails",
                as: "p",
                cond: { $eq: ["$$p.isPaid", true] },
              },
            },
            pendingPayments: {
              $filter: {
                input: "$paymentDetails",
                as: "p",
                cond: {
                  $and: [
                    { $eq: ["$$p.status", "PENDING"] },
                    { $eq: ["$$p.isPaid", false] },
                  ],
                },
              },
            },
            recentPaidPayments: {
              $filter: {
                input: "$paymentDetails",
                as: "p",
                cond: {
                  $and: [
                    { $eq: ["$$p.status", "PAID"] },
                    { $eq: ["$$p.isPaid", true] },
                    {
                      $gte: [
                        "$$p.confirmedAt",
                        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          $addFields: {
            totalPaid: {
              $sum: {
                $map: {
                  input: "$paidPayments",
                  as: "pp",
                  in: { $ifNull: ["$$pp.actualAmount", "$$pp.amount"] },
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
            remainingDebt: {
              $subtract: [{ $ifNull: ["$totalPrice", "$price"] }, "$totalPaid"],
            },
            delayDays: {
              $cond: {
                if: { $ne: ["$nextPaymentDate", null] },
                then: {
                  $floor: {
                    $divide: [
                      { $subtract: [filterEndDate, "$nextPaymentDate"] },
                      1000 * 60 * 60 * 24,
                    ],
                  },
                },
                else: 0,
              },
            },
          },
        },
        {
          $addFields: {
            isPending: {
              $gt: [{ $size: "$pendingPayments" }, 0],
            },
            hasPaidPayments: {
              $gt: [{ $size: "$recentPaidPayments" }, 0],
            },
            nextPaymentStatus: {
              $cond: {
                if: { $gt: [{ $size: "$pendingPayments" }, 0] },
                then: "PENDING",
                else: {
                  $cond: {
                    if: { $gt: [{ $size: "$recentPaidPayments" }, 0] },
                    then: "PAID",
                    else: {
                      $cond: {
                        if: { $eq: ["$nextPaymentDate", null] },
                        then: "COMPLETED",
                        else: {
                          $cond: {
                            if: { $gt: ["$delayDays", 0] },
                            then: "OVERDUE",
                            else: {
                              $cond: {
                                if: { $eq: ["$delayDays", 0] },
                                then: "TODAY",
                                else: "UPCOMING",
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        {
          $match: {
            $or: [
              { remainingDebt: { $gt: 0 } },
              { isPending: true },
              { hasPaidPayments: true },
            ],
          },
        },
        {
          $project: {
            _id: "$_id",
            customerId: "$customerData._id",
            fullName: "$customerData.fullName",
            phoneNumber: "$customerData.phoneNumber",
            productName: "$productName",
            contractId: "$_id",
            remainingDebt: "$remainingDebt",
            delayDays: "$delayDays",
            nextPaymentDate: "$nextPaymentDate",
            totalPrice: { $ifNull: ["$totalPrice", "$price"] },
            totalPaid: "$totalPaid",
            startDate: "$startDate",
            initialPaymentDueDate: "$initialPaymentDueDate",
            period: "$period",
            paidMonthsCount: "$paidMonthsCount",
            monthlyPayment: "$monthlyPayment",
            initialPayment: "$initialPayment",
            isPending: "$isPending",
            hasPaidPayments: "$hasPaidPayments",
            nextPaymentStatus: "$nextPaymentStatus",
            currency: { $ifNull: ["$currency", "USD"] },
            lastPaymentDate: {
              $max: "$recentPaidPayments.confirmedAt",
            },
          },
        },
        {
          $sort: {
            nextPaymentStatus: 1,
            delayDays: -1,
            remainingDebt: -1,
          },
        },
      ]);

      logger.debug(`✅ Barcha qarzdorlar ro'yxati:`, {
        count: result.length,
        statuses: result.reduce((acc: any, item: any) => {
          acc[item.nextPaymentStatus] = (acc[item.nextPaymentStatus] || 0) + 1;
          return acc;
        }, {}),
        sample:
          result.length > 0 ?
            {
              name: result[0].fullName,
              status: result[0].nextPaymentStatus,
              isPending: result[0].isPending,
              hasPaidPayments: result[0].hasPaidPayments,
              delayDays: result[0].delayDays,
            }
          : null,
      });

      return { status: "success", data: result };
    } catch (error) {
      throw BaseError.InternalServerError(String(error));
    }
  }

  async getUnpaidDebtors(user: IJwtUser, filterDate?: string) {
    try {
      let filterEndDate: Date;

      if (filterDate && filterDate.trim() !== "") {
        const [year, month, day] = filterDate.split("-").map(Number);
        filterEndDate = new Date(year, month - 1, day, 23, 59, 59, 999);
      } else {
        filterEndDate = new Date();
        filterEndDate.setHours(23, 59, 59, 999);
      }

      const managerId = new Types.ObjectId(user.sub);
      const currentDate = new Date();

      const result = await Contract.aggregate([
        {
          $match: {
            isActive: true,
            isDeleted: false,
            status: "active",
          },
        },

        {
          $lookup: {
            from: "customers",
            localField: "customer",
            foreignField: "_id",
            as: "customerData",
          },
        },
        {
          $unwind: { path: "$customerData", preserveNullAndEmptyArrays: false },
        },

        {
          $match: {
            "customerData.manager": managerId,
            "customerData.isActive": true,
            "customerData.isDeleted": false,
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
          $match: {
            nextPaymentDate: {
              $exists: true,
              $ne: null,
              $lte: filterEndDate,
            },
          },
        },

        {
          $addFields: {
            unpaidPayments: {
              $filter: {
                input: "$paymentDetails",
                as: "p",
                cond: { $eq: ["$$p.isPaid", false] },
              },
            },
          },
        },
        {
          $addFields: {
            nextPaymentData: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$unpaidPayments",
                    as: "p",
                    cond: {
                      $and: [
                        {
                          $eq: [
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: "$$p.date",
                              },
                            },
                            {
                              $dateToString: {
                                format: "%Y-%m-%d",
                                date: "$nextPaymentDate",
                              },
                            },
                          ],
                        },
                        { $eq: ["$$p.paymentType", "monthly"] },
                      ],
                    },
                  },
                },
                0,
              ],
            },
          },
        },

        {
          $match: {
            $or: [
              { "nextPaymentData.reminderDate": { $exists: false } },
              { "nextPaymentData.reminderDate": null },
              { "nextPaymentData.reminderDate": { $lte: currentDate } },
            ],
          },
        },

        {
          $addFields: {
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
                  in: { $ifNull: ["$$pp.actualAmount", "$$pp.amount"] },
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
            remainingDebt: {
              $subtract: [{ $ifNull: ["$totalPrice", "$price"] }, "$totalPaid"],
            },
            delayDays: {
              $floor: {
                $divide: [
                  { $subtract: [filterEndDate, "$nextPaymentDate"] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
          },
        },

        {
          $match: { remainingDebt: { $gt: 0 } },
        },

        {
          $project: {
            _id: "$_id",
            customerId: "$customerData._id",
            fullName: "$customerData.fullName",
            phoneNumber: "$customerData.phoneNumber",
            productName: "$productName",
            contractId: "$_id",
            remainingDebt: "$remainingDebt",
            delayDays: "$delayDays",
            nextPaymentDate: "$nextPaymentDate",
            totalPrice: { $ifNull: ["$totalPrice", "$price"] },
            totalPaid: "$totalPaid",
            startDate: "$startDate",
            initialPaymentDueDate: "$initialPaymentDueDate",
            period: "$period",
            paidMonthsCount: "$paidMonthsCount",
            monthlyPayment: "$monthlyPayment",
            initialPayment: "$initialPayment",
            isPending: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: "$paymentDetails",
                      as: "p",
                      cond: {
                        $and: [
                          { $eq: ["$$p.status", "PENDING"] },
                          { $eq: ["$$p.isPaid", false] },
                        ],
                      },
                    },
                  },
                },
                0,
              ],
            },
          },
        },

        { $sort: { delayDays: -1, remainingDebt: -1 } },
      ]);

      if (result.length > 0) {
        logger.debug(`✅ Qarzdorlar ro'yxati (reminderDate filtr bilan):`, {
          count: result.length,
          sample: {
            name: result[0].fullName,
            remainingDebt: result[0].remainingDebt,
            delayDays: result[0].delayDays,
            nextPaymentDate: result[0].nextPaymentDate,
          },
        });
      } else {
        logger.debug(
          `✅ Qarzdorlar topilmadi (hamma eslatma qo'ygan bo'lishi mumkin)`,
        );
      }

      return { status: "success", data: result };
    } catch (error) {
      throw BaseError.InternalServerError(String(error));
    }
  }

  async getPaidDebtors(user: IJwtUser) {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      const managerId = new Types.ObjectId(user.sub);

      const result = await Contract.aggregate([
        {
          $match: {
            isActive: true,
            isDeleted: false,
            status: "active",
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer",
            foreignField: "_id",
            as: "customerData",
          },
        },
        { $unwind: "$customerData" },
        {
          $match: {
            "customerData.manager": managerId,
            "customerData.isActive": true,
            "customerData.isDeleted": false,
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
            recentPayments: {
              $filter: {
                input: "$paymentDetails",
                as: "p",
                cond: {
                  $and: [
                    { $eq: ["$$p.isPaid", true] },
                    { $gte: ["$$p.date", thirtyDaysAgo] },
                  ],
                },
              },
            },
          },
        },
        {
          $match: {
            "recentPayments.0": { $exists: true },
          },
        },
        {
          $addFields: {
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
                  in: { $ifNull: ["$$pp.actualAmount", "$$pp.amount"] },
                },
              },
            },
            lastPaymentDate: {
              $max: "$recentPayments.date",
            },
          },
        },
        {
          $group: {
            _id: "$customerData._id",
            fullName: { $first: "$customerData.fullName" },
            phoneNumber: { $first: "$customerData.phoneNumber" },
            lastPaymentDate: { $max: "$lastPaymentDate" },
            totalPaid: { $sum: "$totalPaid" },
            totalPrice: { $sum: { $ifNull: ["$totalPrice", "$price"] } },
            contractsCount: { $sum: 1 },
          },
        },
        {
          $addFields: {
            remainingDebt: { $subtract: ["$totalPrice", "$totalPaid"] },
          },
        },
        { $sort: { lastPaymentDate: -1 } },
      ]);

      return { status: "success", data: result };
    } catch (error) {
      throw BaseError.InternalServerError(String(error));
    }
  }

  async getById(user: IJwtUser, customerId: string) {
    try {
      const customerData = await Customer.aggregate([
        {
          $match: {
            _id: new Types.ObjectId(customerId),
            isActive: true,
            isDeleted: false,
            manager: new Types.ObjectId(user.sub),
          },
        },
        {
          $lookup: {
            from: "contracts",
            let: { customerId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$customer", "$$customerId"] },
                      { $eq: ["$isDeleted", false] },
                      { $eq: ["$isActive", true] },
                    ],
                  },
                },
              },
            ],
            as: "contracts",
          },
        },
        {
          $lookup: {
            from: "payments",
            let: { customerId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$customerId", "$$customerId"] },
                      { $eq: ["$isPaid", true] },
                    ],
                  },
                },
              },
            ],
            as: "payments",
          },
        },
        {
          $addFields: {
            totalDebt: {
              $sum: "$contracts.totalPrice",
            },
            totalPaid: {
              $sum: {
                $map: {
                  input: "$payments",
                  as: "payment",
                  in: {
                    $ifNull: ["$$payment.actualAmount", "$$payment.amount"],
                  },
                },
              },
            },
          },
        },
        {
          $addFields: {
            remainingDebt: {
              $subtract: ["$totalDebt", "$totalPaid"],
            },
          },
        },
        {
          $lookup: {
            from: "debtors",
            let: { contractIds: "$contracts._id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $in: ["$contractId", "$$contractIds"],
                  },
                },
              },
              {
                $match: {
                  $or: [
                    { payment: { $exists: false } },
                    { "payment.isPaid": { $ne: true } },
                  ],
                },
              },
            ],
            as: "debtors",
          },
        },
        {
          $addFields: {
            delayDays: {
              $max: {
                $map: {
                  input: "$debtors",
                  as: "debtor",
                  in: {
                    $cond: [
                      { $lt: ["$$debtor.dueDate", new Date()] },
                      {
                        $dateDiff: {
                          startDate: "$$debtor.dueDate",
                          endDate: new Date(),
                          unit: "day",
                        },
                      },
                      0,
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $project: {
            fullName: 1,
            phoneNumber: 1,
            address: 1,
            totalDebt: 1,
            totalPaid: 1,
            remainingDebt: 1,
            delayDays: 1,
            contracts: {
              $map: {
                input: "$contracts",
                as: "contract",
                in: {
                  _id: "$$contract._id",
                  customId: "$$contract.customId",
                  productName: "$$contract.productName",
                  prepaidBalance: "$$contract.prepaidBalance",
                  totalPrice: "$$contract.totalPrice",
                  monthlyPayment: "$$contract.monthlyPayment",
                  period: "$$contract.period",
                },
              },
            },
          },
        },
      ]);

      if (!customerData.length) {
        throw BaseError.NotFoundError(
          "Mijoz topilmadi yoki sizga tegishli emas",
        );
      }

      return {
        status: "success",
        data: customerData[0],
      };
    } catch (error) {
      throw BaseError.InternalServerError(String(error));
    }
  }

  async getCustomerContracts(customerId: string) {
    const allContracts = await Contract.aggregate([
      {
        $match: {
          customer: new Types.ObjectId(customerId),
          status: { $in: ["active", "completed"] },
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
          totalDebt: "$totalPrice",
          totalPaid: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$paymentDetails",
                    as: "p",
                    cond: {
                      $eq: ["$$p.isPaid", true],
                    },
                  },
                },
                as: "pp",
                in: { $ifNull: ["$$pp.actualAmount", "$$pp.amount"] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          remainingDebt: { $subtract: ["$totalDebt", "$totalPaid"] },
        },
      },
      {
        $project: {
          _id: 1,
          customId: 1,
          productName: 1,
          totalDebt: 1,
          totalPaid: 1,
          remainingDebt: 1,
          monthlyPayment: 1,
          startDate: 1,
          initialPayment: 1,
          initialPaymentDueDate: 1,
          period: 1,
          nextPaymentDate: 1,
          previousPaymentDate: 1,
          postponedAt: 1,
          isPostponedOnce: 1,
          originalPaymentDay: 1,
          prepaidBalance: 1,
          durationMonths: "$period",
          payments: {
            $map: {
              input: "$paymentDetails",
              as: "payment",
              in: {
                _id: "$$payment._id",
                amount: "$$payment.amount",
                actualAmount: "$$payment.actualAmount",
                date: "$$payment.date",
                isPaid: "$$payment.isPaid",
                paymentType: "$$payment.paymentType",
                status: "$$payment.status",
                remainingAmount: "$$payment.remainingAmount",
                excessAmount: "$$payment.excessAmount",
                expectedAmount: "$$payment.expectedAmount",
                targetMonth: "$$payment.targetMonth",
                reminderDate: "$$payment.reminderDate",
                excessHandling: "$$payment.excessHandling",
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
          isCompleted: {
            $gte: [
              {
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
              "$period",
            ],
          },
        },
      },
    ]);

    const debtorContractsRaw = await Debtor.aggregate([
      {
        $lookup: {
          from: "contracts",
          let: { contractId: "$contractId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", "$$contractId"] },
                    { $eq: ["$isDeleted", false] },
                    { $eq: ["$isActive", true] },
                  ],
                },
              },
            },
          ],
          as: "contract",
        },
      },
      { $unwind: "$contract" },
      {
        $match: {
          "contract.customer": new Types.ObjectId(customerId),
          "contract.status": "active",
        },
      },
      {
        $lookup: {
          from: "payments",
          localField: "contract.payments",
          foreignField: "_id",
          as: "paymentDetails",
        },
      },
      {
        $addFields: {
          debtorId: "$_id",
          isPaid: {
            $eq: [{ $ifNull: ["$payment.isPaid", false] }, true],
          },
          totalDebt: "$contract.totalPrice",
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
                in: { $ifNull: ["$$pp.actualAmount", "$$pp.amount"] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          remainingDebt: {
            $subtract: ["$totalDebt", "$totalPaid"],
          },
        },
      },
      {
        $project: {
          _id: "$contract._id",
          productName: "$contract.productName",
          totalDebt: 1,
          totalPaid: 1,
          remainingDebt: 1,
          monthlyPayment: "$contract.monthlyPayment",
          startDate: "$contract.startDate",
          initialPayment: "$contract.initialPayment",
          initialPaymentDueDate: "$contract.initialPaymentDueDate",
          period: "$contract.period",
          nextPaymentDate: "$contract.nextPaymentDate",
          previousPaymentDate: "$contract.previousPaymentDate",
          postponedAt: "$contract.postponedAt",
          debtorId: "$debtorId",
          isPaid: 1,
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
          durationMonths: "$contract.period",
          payments: {
            $map: {
              input: "$paymentDetails",
              as: "payment",
              in: {
                _id: "$$payment._id",
                amount: "$$payment.amount",
                actualAmount: "$$payment.actualAmount",
                date: "$$payment.date",
                isPaid: "$$payment.isPaid",
                paymentType: "$$payment.paymentType",
                status: "$$payment.status",
                remainingAmount: "$$payment.remainingAmount",
                excessAmount: "$$payment.excessAmount",
                expectedAmount: "$$payment.expectedAmount",
                targetMonth: "$$payment.targetMonth",
                reminderDate: "$$payment.reminderDate",
              },
            },
          },
        },
      },
    ]);

    const completedContracts = allContracts.filter(
      (c) => c.isCompleted === true,
    );
    const activeContracts = allContracts.filter((c) => c.isCompleted === false);

    const paidContracts = debtorContractsRaw.filter((c) => c.isPaid === true);
    const debtorContracts = debtorContractsRaw.filter(
      (c) => c.isPaid === false,
    );

    const response = {
      status: "success",
      data: {
        allContracts: allContracts || [],
        paidContracts: paidContracts || [],
        debtorContracts: debtorContracts || [],
      },
    };

    return response;
  }
}

export default new CustomerService();
