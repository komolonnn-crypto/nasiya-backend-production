import BaseError from "../../utils/base.error";
import Auth from "../../schemas/auth.schema";
import Customer from "../../schemas/customer.schema";
import Employee from "../../schemas/employee.schema";
import { CreateCustomerDtoForSeller } from "../validators/customer";
import IJwtUser from "../../types/user";
import { Types } from "mongoose";

class CustomerService {
  async getAllNew(userId: string) {
    return await Customer.aggregate([
      {
        $match: {
          isDeleted: false,
          isActive: false,
        },
      },
      {
        $lookup: {
          from: "contracts",
          localField: "_id",
          foreignField: "customer",
          as: "contracts",
          pipeline: [
            {
              $match: {
                isDeleted: false,
              },
            },
            {
              $sort: { createdAt: -1 },
            },
          ],
        },
      },
      {
        $addFields: {
          latestContractDate: {
            $ifNull: [
              { $arrayElemAt: ["$contracts.createdAt", 0] },
              "$createdAt",
            ],
          },
        },
      },
      {
        $project: {
          fullName: 1,
          phoneNumber: 1,
          address: 1,
          passportSeries: 1,
          birthDate: 1,
          telegramName: 1,
          telegramId: 1,
          auth: 1,
          manager: 1,
          files: 1,
          editHistory: 1,
          isActive: 1,
          isDeleted: 1,
          deletedAt: 1,
          createBy: 1,
          createdAt: "$latestContractDate",
          updatedAt: 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);
  }

  async getOne(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw BaseError.BadRequest("Noto'g'ri mijoz ID.");
    }

    const customer = await Customer.findById(id)
      .populate("manager", "fullName phoneNumber")
      .populate({
        path: "contracts",
        match: { isDeleted: false },
        options: { sort: { createdAt: -1 } },
        select:
          "productName price totalPrice monthlyPayment period status nextPaymentDate startDate isActive",
      });

    if (!customer) {
      throw BaseError.NotFoundError("Mijoz topilmadi.");
    }

    return customer;
  }

  async update(id: string, data: CreateCustomerDtoForSeller, files?: any) {
    if (!Types.ObjectId.isValid(id)) {
      throw BaseError.BadRequest("Noto'g'ri mijoz ID.");
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      throw BaseError.NotFoundError("Mijoz topilmadi.");
    }

    if (data.phoneNumber && data.phoneNumber !== customer.phoneNumber) {
      const existingPhone = await Customer.findOne({
        phoneNumber: data.phoneNumber,
        _id: { $ne: id },
      });
      if (existingPhone) {
        throw BaseError.BadRequest(
          "Ushbu telefon raqami bilan mijoz allaqachon mavjud."
        );
      }
    }

    if (
      data.passportSeries &&
      data.passportSeries !== customer.passportSeries
    ) {
      const existingSeries = await Customer.findOne({
        passportSeries: data.passportSeries,
        _id: { $ne: id },
      });
      if (existingSeries) {
        throw BaseError.BadRequest(
          "Ushbu passport seriyasi bilan mijoz allaqachon mavjud."
        );
      }
    }

    const customerFiles: any = { ...customer.files };
    if (files) {
      if (files.passport && files.passport[0]) {
        customerFiles.passport = files.passport[0].path;
      }
      if (files.shartnoma && files.shartnoma[0]) {
        customerFiles.shartnoma = files.shartnoma[0].path;
      }
      if (files.photo && files.photo[0]) {
        customerFiles.photo = files.photo[0].path;
      }
    }

    customer.fullName = data.fullName;
    customer.phoneNumber = data.phoneNumber;
    customer.address = data.address;
    customer.passportSeries = data.passportSeries;
    customer.birthDate = data.birthDate;
    customer.files = customerFiles;

    await customer.save();

    return { message: "Mijoz ma'lumotlari yangilandi.", customer };
  }

  async create(data: CreateCustomerDtoForSeller, user: IJwtUser, files?: any) {
    const createBy = await Employee.findById(user.sub);
    if (!createBy) {
      throw BaseError.ForbiddenError();
    }

    if (data.phoneNumber) {
      const customerNumber = await Customer.findOne({
        phoneNumber: data.phoneNumber,
      });
      if (customerNumber) {
        throw BaseError.BadRequest(
          "Ushbu telefon raqami bilan mijoz allaqachon mavjud."
        );
      }
    }

    if (data.passportSeries) {
      const customerSeries = await Customer.findOne({
        passportSeries: data.passportSeries,
      });
      if (customerSeries) {
        throw BaseError.BadRequest(
          "Ushbu passport seriyasi bilan mijoz allaqachon mavjud."
        );
      }
    }

    const auth = new Auth({});
    await auth.save();

    const customerFiles: any = {};
    if (files) {
      if (files.passport && files.passport[0]) {
        customerFiles.passport = files.passport[0].path;
      }
      if (files.shartnoma && files.shartnoma[0]) {
        customerFiles.shartnoma = files.shartnoma[0].path;
      }
      if (files.photo && files.photo[0]) {
        customerFiles.photo = files.photo[0].path;
      }
    }

    const customer = new Customer({
      fullName: data.fullName,
      phoneNumber: data.phoneNumber,
      address: data.address,
      passportSeries: data.passportSeries,
      birthDate: data.birthDate,
      auth,
      isActive: false,
      createBy,
      files: customerFiles,
    });
    await customer.save();
    return { message: "Mijoz yaratildi.", customer };
  }
}

export default new CustomerService();
