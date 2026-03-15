import XLSX from "xlsx";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import Customer from "../../schemas/customer.schema";
import Contract from "../../schemas/contract.schema";
import logger from "../../utils/logger";
import Payment, {
  PaymentType,
  PaymentStatus,
} from "../../schemas/payment.schema";
import Notes from "../../schemas/notes.schema";
import Auth from "../../schemas/auth.schema";
import { Balance } from "../../schemas/balance.schema";
import BaseError from "../../utils/base.error";
import { Types } from "mongoose";
import auditLogService from "../../services/audit-log.service";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

interface ExcelRow {
  startDate: string;
  initialPaymentDueDate: string;
  nextPaymentDate: string;
  customer: string;
  productName: string;
  customId?: string;
  originalPrice: number;
  price: number;
  initialPayment: number;
  period: number;
  monthlyPayment: number;
  totalPrice: number;
  percentage: number;
  notes?: string;
  box?: string;
  mbox?: string;
  receipt?: string;
  iCloud?: string;
  [key: string]: any;
}

class ExcelImportService {
  
  private readExcelFile(filePath: string): any[] {
    try {
      const fs = require("fs");
      if (!fs.existsSync(filePath)) {
        throw BaseError.NotFoundError(
          `Excel fayl topilmadi: ${filePath}`
        );
      }

      let workbook;
      try {
        workbook = XLSX.readFile(filePath);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw BaseError.BadRequest(
          `Excel faylni o'qib bo'lmadi. Fayl buzilgan yoki noto'g'ri formatda: ${errorMessage}`
        );
      }

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw BaseError.BadRequest(
          "Excel faylda hech qanday sheet topilmadi"
        );
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      if (!worksheet) {
        throw BaseError.BadRequest(
          `Sheet "${sheetName}" topilmadi yoki bo'sh`
        );
      }

      const data = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: true,
        dateNF: "yyyy-mm-dd",
      });

      if (!data || data.length < 2) {
        throw BaseError.BadRequest(
          "Excel faylda ma'lumot yo'q yoki faqat sarlavha mavjud (kamida 2 qator bo'lishi kerak)"
        );
      }

      logger.debug(`✅ Excel fayl o'qildi: ${data.length} qator topildi`);

      return data;
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw BaseError.InternalServerError(
        `Excel faylni qayta ishlashda xatolik: ${errorMessage}`
      );
    }
  }

  
  private parseDate(dateStr: any, isDay: boolean = false): Date {
    if (!dateStr) {
      return new Date();
    }

    if (typeof dateStr === 'number') {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const milliseconds = excelEpoch.getTime() + (dateStr * 86400 * 1000);
      
      const parsedDate = dayjs.utc(milliseconds).startOf('day');
      
      logger.debug(`  📅 Excel serial ${dateStr} → ${parsedDate.format('YYYY-MM-DD')}`);
      return parsedDate.toDate();
    }

    const dateString = String(dateStr);

    if (isDay && /^\d{1,2}$/.test(dateString)) {
      const day = parseInt(dateString);
      if (day >= 1 && day <= 31) {
        return dayjs().date(day).startOf('day').toDate();
      }
    }

    const shortDateMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (shortDateMatch) {
      let first = parseInt(shortDateMatch[1]);
      let second = parseInt(shortDateMatch[2]);
      let year = parseInt(shortDateMatch[3]);

      year += 2000;

      if (year > 2050) {
        year = 2025;
        logger.warn(`⚠️ Suspicious year in "${dateString}", using 2025`);
      }

      let month: number, day: number;
      if (first > 12) {
        day = first;
        month = second;
      } else if (second > 12) {
        month = first;
        day = second;
      } else {
        day = first;
        month = second;
      }

      if (month < 1 || month > 12 || day < 1 || day > 31) {
        logger.warn(`⚠️ Invalid date "${dateString}", using current date`);
        return new Date();
      }

      const parsedDate = dayjs.utc(`${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`);
      return parsedDate.toDate();
    }

    let parsed = dayjs(dateString, ["DD/MM/YYYY", "D/M/YYYY", "YYYY-MM-DD", "M/D/YYYY", "M/D/YY"], true);

    if (!parsed.isValid()) {
      logger.warn(`Invalid date: ${dateString}, using current date`);
      return new Date();
    }

    return dayjs.utc(parsed.format('YYYY-MM-DD')).toDate();
  }

  
  private async updateBalance(
    managerId: Types.ObjectId,
    amount: number
  ): Promise<void> {
    try {
      let balance = await Balance.findOne({ managerId });

      if (!balance) {
        balance = await Balance.create({
          managerId,
          dollar: amount,
          sum: 0,
        });
        logger.debug(`    💵 Balance created: ${amount}$`);
      } else {
        balance.dollar += amount;
        await balance.save();
        logger.debug(
          `    💵 Balance updated: +${amount}$ (total: ${balance.dollar}$)`
        );
      }
    } catch (error) {
      logger.error("❌ Error updating balance:", error);
      throw error;
    }
  }

  
  private async findOrCreateCustomer(
    customerName: string,
    managerId: Types.ObjectId,
    contractStartDate?: Date
  ): Promise<Types.ObjectId> {
    const fullName = customerName.trim();

    let customer = await Customer.findOne({
      fullName: { $regex: new RegExp(`^${fullName}$`, "i") },
      isDeleted: false,
    });

    if (!customer) {
      const auth = await Auth.create({});

      const customerData: any = {
        fullName,
        phoneNumber: "",
        address: "",
        passportSeries: "",
        birthDate: new Date(),
        manager: managerId,
        auth: auth._id,
        isActive: true,
        isDeleted: false,
      };

      if (contractStartDate) {
        customerData.createdAt = contractStartDate;
        customerData.updatedAt = contractStartDate;
        logger.debug(`  📅 Setting customer createdAt to: ${dayjs(contractStartDate).format('YYYY-MM-DD')}`);
      }

      customer = await Customer.create(customerData);

      logger.debug(`✅ Created new customer: ${fullName}`);

      try {
        await auditLogService.logCustomerCreate(
          customer._id.toString(),
          fullName,
          managerId.toString(),
          { source: "excel_import", fileName: "excel_import" }
        );
        logger.debug(`✅ Customer audit log created: ${customer._id}`);
      } catch (auditError) {
        logger.error("❌ Error creating customer audit log:", auditError);
      }
    } else {
      logger.debug(`✓ Found existing customer: ${fullName}`);
    }

    return customer._id as Types.ObjectId;
  }

  
  private parseMonthlyPayments(
    row: any[],
    headers: string[],
    startIndex: number
  ): Array<{ month: string; year: number; amount: number }> {
    const payments: Array<{ month: string; year: number; amount: number }> = [];

    for (let i = startIndex; i < headers.length; i++) {
      const header = headers[i];
      const value = row[i];

      const match = header.match(/^(\d{2})\/(\d{4})$/);
      if (!match) continue;

      const month = match[1];
      const year = parseInt(match[2]);

      if (value && !isNaN(parseFloat(value))) {
        payments.push({
          month,
          year,
          amount: Math.round(parseFloat(value)),
        });
      }
    }

    return payments;
  }

  
  private calculateTargetMonthFixed(
    paymentMonth: string,
    paymentYear: number,
    contractStartDate: Date
  ): number {
    const paymentDate = dayjs.utc(`${paymentYear}-${paymentMonth}-01`);
    const contractStartMonth = dayjs.utc(contractStartDate).startOf("month");

    const monthsDiff = paymentDate.diff(contractStartMonth, "month");

    return Math.max(1, monthsDiff);
  }

  
  private async recheckContractStatusAndNextPayment(
    contract: any,
    initialNextPaymentDate: Date
  ): Promise<void> {
    try {
      logger.debug("  🔍 Rechecking contract status and nextPaymentDate...");

      await contract.populate("payments");

      const totalPaid = (contract.payments as any[])
        .filter((p: any) => p.isPaid)
        .reduce((sum: number, p: any) => sum + (p.actualAmount || p.amount), 0);

      const totalPaidWithPrepaid = totalPaid + (contract.prepaidBalance || 0);

      logger.debug(`    💰 Total paid: ${totalPaid.toFixed(2)}$`);
      logger.debug(`    💰 Total price: ${contract.totalPrice}$`);
      logger.debug(`    ✅ Paid with prepaid: ${totalPaidWithPrepaid.toFixed(2)}$`);

      if (totalPaidWithPrepaid >= contract.totalPrice) {
        contract.status = "completed";
        logger.debug("    ✅ Contract status: COMPLETED");
      } else {
        contract.status = "active";
        logger.debug("    ✅ Contract status: ACTIVE");
      }

      const paidMonthlyPayments = (contract.payments as any[])
        .filter(
          (p: any) =>
            p.isPaid &&
            p.paymentType === "monthly" &&
            p.targetMonth &&
            p.targetMonth > 0
        );

      const lastPaidMonth = paidMonthlyPayments.length > 0
        ? Math.max(...paidMonthlyPayments.map((p: any) => p.targetMonth || 0))
        : 0;

      logger.debug(`    📅 Paid monthly payments: ${paidMonthlyPayments.length}`);
      logger.debug(`    📅 Last paid month: ${lastPaidMonth}`);

      const nextPaymentMonth = lastPaidMonth + 1;

      const originalDay = contract.originalPaymentDay || dayjs.utc(contract.nextPaymentDate).date();
      if (!contract.originalPaymentDay) {
        contract.originalPaymentDay = originalDay;
        logger.debug(`    📅 originalPaymentDay set from nextPaymentDate: ${originalDay}`);
      }

      if (nextPaymentMonth <= contract.period) {
        const nextPaymentDate = dayjs.utc(initialNextPaymentDate)
          .add(lastPaidMonth, "month")
          .date(originalDay)
          .toDate();

        contract.nextPaymentDate = nextPaymentDate;

        logger.debug(`    📅 Next payment month: ${nextPaymentMonth}`);
        logger.debug(`    📅 nextPaymentDate: ${dayjs.utc(nextPaymentDate).format("YYYY-MM-DD")}`);
      } else {
        logger.debug("    ✅ All payments completed, no next payment date");
      }

      await contract.save();

      logger.debug("  ✅ Contract status and nextPaymentDate updated");
    } catch (error) {
      logger.error("  ❌ Error rechecking contract:", error);
    }
  }

  
  private createExcelPaymentNote(
    excelAmount: number,
    excelMonth: string,
    excelYear: number,
    expectedMonthlyPayment: number,
    monthsCount: number,
    remainder: number,
    baseTargetMonth: number,
    paymentDate: Date,
    isSplitPayment: boolean = false,
    splitIndex: number = 0
  ): string {
    let note = `📊 EXCEL TO'LOV MA'LUMOTI:\n`;
    note += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    note += `Asl to'lov: ${excelAmount.toFixed(2)}$\n`;
    note += `Excel oy/yil: ${excelMonth}/${excelYear}\n`;
    note += `To'lov sanasi: ${dayjs.utc(paymentDate).format("DD/MM/YYYY")}\n\n`;

    if (isSplitPayment && monthsCount > 1) {
      note += `✅ Bu to'lov ${monthsCount} oyga bo'lindi:\n`;
      for (let i = 0; i < monthsCount; i++) {
        const targetMonth = baseTargetMonth + i;
        const marker = i === splitIndex ? "👉" : "  ";
        note += `${marker} ${i + 1}. ${targetMonth}-oy: ${expectedMonthlyPayment.toFixed(
          2
        )}$\n`;
      }
      if (remainder > 0.01) {
        note += `\n💰 Qoldiq: ${remainder.toFixed(2)}$\n`;
        note += `   Keyingi oy (${baseTargetMonth + monthsCount
          }-oy)ga qo'llanadi\n`;
      }
      note += `\n👉 Bu to'lov - ${splitIndex + 1}/${monthsCount} qism\n`;
    } else {
      note += `💵 Oylik to'lov: ${expectedMonthlyPayment.toFixed(2)}$\n`;

      const diff = excelAmount - expectedMonthlyPayment;
      if (Math.abs(diff) > 0.01) {
        if (diff < 0) {
          note += `⚠️ KAM TO'LANGAN: ${Math.abs(diff).toFixed(2)}$ qoldi\n`;
        } else {
          note += `✨ ORTIQCHA: ${diff.toFixed(2)}$ qo'shimcha\n`;
        }
      } else {
        note += `✅ TO'LIQ TO'LANGAN\n`;
      }
    }

    return note;
  }

  
  private async createPayments(
    contractId: Types.ObjectId,
    customerId: Types.ObjectId,
    customerName: string,
    managerId: Types.ObjectId,
    monthlyPayments: Array<{ month: string; year: number; amount: number }>,
    expectedMonthlyPayment: number,
    contractStartDate: Date,
    nextPaymentDate: Date,
    totalContractPrice?: number,
    period?: number,
    initialPayment?: number
  ): Promise<Types.ObjectId[]> {
    const paymentIds: Types.ObjectId[] = [];

    const contractDay = dayjs(contractStartDate).date();

    const totalExcelPayments = monthlyPayments.reduce((sum, p) => sum + p.amount, 0);
    const isContractFullyPaid = totalContractPrice
      ? (totalExcelPayments >= totalContractPrice * 0.99)
      : false;

    logger.debug(`\n  📊 YANGI ALGORITM - TENG TAQSIMLASH`);
    logger.debug(`  📊 Total Excel payments: ${totalExcelPayments}$`);
    logger.debug(`  📊 Total contract price: ${totalContractPrice || 'N/A'}$`);
    logger.debug(`  📊 Period: ${period} months`);
    logger.debug(`  📊 Monthly payment (expected): ${expectedMonthlyPayment}$`);
    logger.debug(`  ${isContractFullyPaid ? '✅' : '⚠️'} Contract fully paid: ${isContractFullyPaid}\n`);

    const paymentMonthMapping: Array<{
      monthIndex: number;
      expectedAmount: number;
      paidAmount: number;
      paidDate: Date;
      status: string;
    }> = [];

    let currentMonthIndex = 1;
    let remainingExcelAmount = 0;

    for (let i = 0; i < monthlyPayments.length; i++) {
      const payment = monthlyPayments[i];
      const paymentDate = dayjs.utc(
        `${payment.year}-${payment.month}-${contractDay}`
      ).toDate();

      logger.debug(
        `\n  📅 Processing Excel payment: ${payment.month}/${payment.year} = ${payment.amount}$`
      );

      let excelAmountToProcess = payment.amount + remainingExcelAmount;
      logger.debug(`    💰 Amount to process: ${excelAmountToProcess}$ (${payment.amount}$ + ${remainingExcelAmount}$ qoldiq)`);

      while (excelAmountToProcess >= expectedMonthlyPayment * 0.95 && currentMonthIndex <= (period || 12)) {
        const amountForThisMonth = Math.min(excelAmountToProcess, expectedMonthlyPayment);

        paymentMonthMapping.push({
          monthIndex: currentMonthIndex,
          expectedAmount: expectedMonthlyPayment,
          paidAmount: amountForThisMonth,
          paidDate: paymentDate,
          status: amountForThisMonth >= expectedMonthlyPayment * 0.99 ? 'PAID' : 'UNDERPAID'
        });

        logger.debug(
          `    ✓ ${currentMonthIndex}-oy: ${amountForThisMonth.toFixed(2)}$ (${paymentMonthMapping[paymentMonthMapping.length - 1].status})`
        );

        excelAmountToProcess -= amountForThisMonth;
        currentMonthIndex++;
      }

      remainingExcelAmount = excelAmountToProcess;

      if (remainingExcelAmount > 0.01) {
        logger.debug(`    💰 Qoldiq keyingi Excel to'lovga: ${remainingExcelAmount.toFixed(2)}$`);
      }
    }

    if (remainingExcelAmount > 0.01) {
      if (currentMonthIndex <= (period || 12)) {
        paymentMonthMapping.push({
          monthIndex: currentMonthIndex,
          expectedAmount: expectedMonthlyPayment,
          paidAmount: remainingExcelAmount,
          paidDate: monthlyPayments[monthlyPayments.length - 1]
            ? dayjs.utc(`${monthlyPayments[monthlyPayments.length - 1].year}-${monthlyPayments[monthlyPayments.length - 1].month}-${contractDay}`).toDate()
            : new Date(),
          status: remainingExcelAmount >= expectedMonthlyPayment * 0.99 ? 'PAID' : 'UNDERPAID'
        });
        logger.debug(
          `    ✓ ${currentMonthIndex}-oy (qoldiq): ${remainingExcelAmount.toFixed(2)}$ (${remainingExcelAmount >= expectedMonthlyPayment * 0.99 ? 'PAID' : 'UNDERPAID'})`
        );
      }
    }

    logger.debug(`\n  📊 Jami: ${paymentMonthMapping.length} oylik to'lov yaratiladi\n`);

    for (const monthPayment of paymentMonthMapping) {
      const paymentDay = dayjs.utc(nextPaymentDate).date();
      const paymentDate = dayjs.utc(nextPaymentDate)
        .add(monthPayment.monthIndex - 1, 'month')
        .date(paymentDay)
        .toDate();

      const noteText = `${monthPayment.monthIndex}-oy to'lovi - ${dayjs.utc(monthPayment.paidDate).format('DD.MM.YYYY')}\n${monthPayment.paidAmount.toFixed(2)}$`;

      const notes = await Notes.create({
        text: noteText,
        customer: customerId,
        createBy: managerId,
      });

      const paymentDoc = await Payment.create({
        amount: monthPayment.expectedAmount,
        actualAmount: monthPayment.paidAmount,
        date: paymentDate,
        isPaid: true,
        paymentType: PaymentType.MONTHLY,
        customerId,
        managerId,
        notes: notes._id,
        status: monthPayment.status === 'PAID' ? PaymentStatus.PAID : PaymentStatus.UNDERPAID,
        expectedAmount: monthPayment.expectedAmount,
        remainingAmount: monthPayment.status === 'UNDERPAID'
          ? monthPayment.expectedAmount - monthPayment.paidAmount
          : 0,
        confirmedAt: monthPayment.paidDate,
        confirmedBy: managerId,
        targetMonth: monthPayment.monthIndex,
        createdAt: monthPayment.paidDate,
        updatedAt: monthPayment.paidDate,
      });

      paymentIds.push(paymentDoc._id);

      try {
        await auditLogService.logPaymentCreate(
          paymentDoc._id.toString(),
          contractId.toString(),
          customerId.toString(),
          customerName,
          monthPayment.paidAmount,
          "monthly",
          monthPayment.monthIndex,
          managerId.toString(),
          {
            source: "excel_import",
            fileName: "excel_import",
            actualAmount: monthPayment.paidAmount,
            expectedAmount: monthPayment.paidAmount,
            paymentStatus: "PAID"
          }
        );
        logger.debug(`✅ Payment audit log created: ${paymentDoc._id}`);
      } catch (auditError) {
        logger.error("❌ Error creating payment audit log:", auditError);
      }

      logger.debug(
        `  ✓ Payment created: ${monthPayment.monthIndex}-oy - ${monthPayment.paidAmount.toFixed(2)}$ (${monthPayment.status})`
      );
    }

    await this.updateBalance(managerId, totalExcelPayments);
    logger.debug(`  💵 Balance updated: +${totalExcelPayments}$`);

    return paymentIds;

  }

  
  async importFromExcel(
    filePath: string,
    managerId: string
  ): Promise<{
    success: number;
    failed: number;
    errors: string[];
  }> {
    logger.debug("=== EXCEL IMPORT STARTED ===");
    logger.debug("File:", filePath);
    logger.debug("Manager ID:", managerId);

    const managerObjectId = new Types.ObjectId(managerId);
    const data = this.readExcelFile(filePath);

    if (data.length < 2) {
      throw BaseError.BadRequest("Excel fayl bo'sh yoki noto'g'ri formatda");
    }

    const headers = data[0] as string[];
    const rows = data.slice(2);

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    const monthlyPaymentsStartIndex = headers.findIndex((h) =>
      /^\d{2}\/\d{4}$/.test(h)
    );

    logger.debug(`Found ${rows.length} rows to import`);
    logger.debug(
      `Monthly payments start at column ${monthlyPaymentsStartIndex}`
    );

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as any[];
      const rowNumber = i + 3;

      try {
        if (!row[3] || !row[4]) {
          logger.debug(`Row ${rowNumber}: Skipped (empty)`);
          continue;
        }

        logger.debug(`\nProcessing row ${rowNumber}: ${row[3]}`);

        const contractStartDate = this.parseDate(row[0]);

        const customerName = row[3] ? row[3].toString().trim() : "Unknown Customer";
        const customerId = await this.findOrCreateCustomer(
          customerName,
          managerObjectId,
          contractStartDate
        );

        const customId = row[5] ? String(row[5]).trim() : undefined;
        const initialPayment = Math.round(parseFloat(row[8]) || 0);
        const period = parseInt(row[9]) || 12;
        const monthlyPayment = Math.round(parseFloat(row[10]) || 0);
        const excelTotalPrice = Math.round(parseFloat(row[11]) || 0);

        const calculatedTotalPrice = initialPayment + (monthlyPayment * period);

        const priceDifference = Math.abs(excelTotalPrice - calculatedTotalPrice);
        let finalTotalPrice = excelTotalPrice;

        if (priceDifference > 1) {
          logger.debug(`  ⚠️ WARNING: TotalPrice mismatch!`);
          logger.debug(`    Excel totalPrice: ${excelTotalPrice}$`);
          logger.debug(`    Calculated: ${initialPayment}$ + (${monthlyPayment}$ × ${period}) = ${calculatedTotalPrice}$`);
          logger.debug(`    Difference: ${priceDifference.toFixed(2)}$`);
          logger.debug(`    ✅ Using calculated value: ${calculatedTotalPrice}$`);
          finalTotalPrice = calculatedTotalPrice;
        } else {
          logger.debug(`  ✅ TotalPrice validation passed:`);
          logger.debug(`    Excel: ${excelTotalPrice}$ | Calculated: ${calculatedTotalPrice}$ | Diff: ${priceDifference.toFixed(2)}$`);
          logger.debug(`    Using Excel value: ${excelTotalPrice}$`);
        }

        const paymentDayFromExcel = row[1] ? parseInt(String(row[1])) : null;
        const nextPaymentDateParsed = this.parseDate(row[2]);

        let originalPaymentDay: number;
        let initialPaymentDueDateValue: Date;

        if (paymentDayFromExcel && paymentDayFromExcel >= 1 && paymentDayFromExcel <= 31) {
          originalPaymentDay = paymentDayFromExcel;
          
          initialPaymentDueDateValue = dayjs.utc(nextPaymentDateParsed)
            .date(paymentDayFromExcel)
            .toDate();
          
          logger.debug(`  📅 originalPaymentDay from Excel: ${originalPaymentDay}`);
          logger.debug(`  📅 initialPaymentDueDate: ${dayjs.utc(initialPaymentDueDateValue).format('YYYY-MM-DD')}`);
        } else {
          originalPaymentDay = dayjs.utc(nextPaymentDateParsed).date();
          initialPaymentDueDateValue = nextPaymentDateParsed;
          
          logger.debug(`  📅 originalPaymentDay fallback: ${originalPaymentDay}`);
          logger.debug(`  📅 initialPaymentDueDate fallback: ${dayjs.utc(initialPaymentDueDateValue).format('YYYY-MM-DD')}`);
        }

        const contractData = {
          customId: customId,
          startDate: contractStartDate,
          initialPaymentDueDate: initialPaymentDueDateValue,
          nextPaymentDate: nextPaymentDateParsed,
          originalPaymentDay: originalPaymentDay,
          customer: customerId,
          productName: row[4] || "Unknown",
          originalPrice: Math.round(parseFloat(row[6]) || 0),
          price: Math.round(parseFloat(row[7]) || 0),
          initialPayment: initialPayment,
          period: period,
          monthlyPayment: monthlyPayment,
          totalPrice: finalTotalPrice,
          percentage: Math.round(parseFloat(row[12]) || 30),
          notes: row[13] || "",
          box: row[14] === "1" || row[14] === "true",
          mbox: row[15] === "1" || row[15] === "true",
          receipt: row[16] === "1" || row[16] === "true",
          iCloud: row[17] === "1" || row[17] === "true",
        };

        const notes = await Notes.create({
          text: "Excel'dan import qilinmoqda...",
          customer: customerId,
          createBy: managerObjectId,
        });

        const contract = await Contract.create({
          customId: contractData.customId,
          customer: customerId,
          productName: contractData.productName,
          originalPrice: contractData.originalPrice,
          price: contractData.price,
          initialPayment: contractData.initialPayment,
          percentage: contractData.percentage,
          period: contractData.period,
          monthlyPayment: contractData.monthlyPayment,
          totalPrice: contractData.totalPrice,
          startDate: contractData.startDate,
          nextPaymentDate: contractData.nextPaymentDate,
          initialPaymentDueDate: contractData.initialPaymentDueDate,
          originalPaymentDay: contractData.originalPaymentDay,
          notes: notes._id,
          status: "active",
          isActive: true,
          isDeleted: false,
          info: {
            box: contractData.box,
            mbox: contractData.mbox,
            receipt: contractData.receipt,
            iCloud: contractData.iCloud,
          },
          payments: [],
          createBy: managerObjectId,
          createdAt: contractData.startDate,
          updatedAt: contractData.startDate,
        });

        logger.debug(`  ✓ Contract created: ${contract._id}`);

        try {
          const customerFullName = `${contractData.productName}`;
          await auditLogService.logContractCreate(
            contract._id.toString(),
            customerId.toString(),
            customerFullName,
            contractData.productName,
            contractData.totalPrice,
            managerId.toString(),
            { source: "excel_import", fileName: "excel_import" }
          );
          logger.debug(`✅ Contract audit log created: ${contract._id}`);
        } catch (auditError) {
          logger.error("❌ Error creating contract audit log:", auditError);
        }

        const monthlyPayments = this.parseMonthlyPayments(
          row,
          headers,
          monthlyPaymentsStartIndex
        );

        logger.debug(`  Found ${monthlyPayments.length} monthly payments`);

        const contractDay = dayjs.utc(contractData.startDate).date();
        let detailedNotes = `📊 EXCEL'DAN IMPORT QILINGAN\n`;
        detailedNotes += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        detailedNotes += `💰 Boshlang'ich to'lov:\n`;
        detailedNotes += `   ${contractData.initialPayment.toFixed(2)}$ (${dayjs.utc(contractData.startDate).format('DD.MM.YYYY')})\n\n`;

        if (monthlyPayments.length > 0) {
          detailedNotes += `📅 Oylik to'lovlar:\n`;
          monthlyPayments.forEach((payment) => {
            const paymentDate = dayjs.utc(`${payment.year}-${payment.month}-${contractDay}`).format('DD.MM.YYYY');
            detailedNotes += `   • ${payment.month}/${payment.year}: ${payment.amount.toFixed(2)}$ (${paymentDate})\n`;
          });
          const totalMonthlyPayments = monthlyPayments.reduce((sum, p) => sum + p.amount, 0);
          detailedNotes += `\n✅ Jami: ${contractData.totalPrice.toFixed(2)}$ (${contractData.initialPayment.toFixed(2)}$ + ${totalMonthlyPayments.toFixed(2)}$)\n`;
        }

        if (contractData.notes && contractData.notes.trim()) {
          detailedNotes += `\n📝 Qo'shimcha izoh:\n${contractData.notes}`;
        }

        notes.text = detailedNotes;
        await notes.save();
        logger.debug(`  ✓ Notes updated with detailed info`);

        if (monthlyPayments.length > 0) {
          const paymentIds = await this.createPayments(
            contract._id as Types.ObjectId,
            customerId,
            customerName,
            managerObjectId,
            monthlyPayments,
            contractData.monthlyPayment,
            contractData.startDate,
            contractData.nextPaymentDate,
            contractData.totalPrice,
            contractData.period,
            contractData.initialPayment
          );

          if (!contract.payments) {
            contract.payments = [];
          }
          contract.payments.push(...(paymentIds as any));
          await contract.save();

          logger.debug(`  ✓ Added ${paymentIds.length} payments to contract`);
        }

        if (contractData.initialPayment > 0) {
          let initialNoteText = `📊 BOSHLANG'ICH TO'LOV\n`;
          initialNoteText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
          initialNoteText += `💰 Summa: ${contractData.initialPayment.toFixed(2)}$\n`;
          initialNoteText += `📦 Shartnoma: ${contractData.productName}\n`;
          initialNoteText += `📅 Sana: ${dayjs.utc(contractData.startDate).format("DD.MM.YYYY")}\n`;
          initialNoteText += `💵 Jami narx: ${contractData.totalPrice.toFixed(2)}$\n`;
          initialNoteText += `📊 Oylik to'lov: ${contractData.monthlyPayment.toFixed(2)}$\n`;
          initialNoteText += `⏰ Muddat: ${contractData.period} oy\n`;
          initialNoteText += `\n✅ TO'LANGAN (Excel import)\n`;

          const initialNotes = await Notes.create({
            text: initialNoteText,
            customer: customerId,
            createBy: managerObjectId,
          });

          const initialPayment = await Payment.create({
            amount: contractData.initialPayment,
            actualAmount: contractData.initialPayment,
            date: contractData.startDate,
            isPaid: true,
            paymentType: PaymentType.INITIAL,
            customerId,
            managerId: managerObjectId,
            notes: initialNotes._id,
            status: PaymentStatus.PAID,
            confirmedAt: contractData.startDate,
            confirmedBy: managerObjectId,
            targetMonth: 0,
            createdAt: contractData.startDate,
            updatedAt: contractData.startDate,
          });

          contract.payments.push(initialPayment._id as any);
          await contract.save();

          logger.debug(
            `  ✓ Initial payment created: ${contractData.initialPayment}$ (NOT added to balance)`
          );
        }

        await this.recheckContractStatusAndNextPayment(
          contract,
          contractData.nextPaymentDate
        );

        logger.debug(`  ℹ️ Excel import: Faqat to'langan to'lovlar import qilindi`);

        successCount++;
        logger.debug(`✅ Row ${rowNumber} imported successfully`);
      } catch (error: any) {
        failedCount++;
        const errorMsg = `Row ${rowNumber}: ${error.message}`;
        errors.push(errorMsg);
        logger.error(`❌ ${errorMsg}`);
      }
    }

    logger.debug("\n=== EXCEL IMPORT COMPLETED ===");
    logger.debug(`Success: ${successCount}`);
    logger.debug(`Failed: ${failedCount}`);

    const fileName = filePath.split('/').pop() || 'unknown.xlsx';
    const totalRows = rows.length;

    const affectedEntities: {
      entityType: string;
      entityId: string;
      entityName: string;
    }[] = [];

    for (let i = 0; i < successCount; i++) {
      affectedEntities.push({
        entityType: "contract",
        entityId: `import-${i}`,
        entityName: `Import ${i + 1}`,
      });
    }

    try {
      logger.debug("📝 Creating Excel Import audit log...", {
        fileName,
        totalRows,
        successCount,
        failedCount,
        managerId,
        affectedEntitiesCount: affectedEntities.length
      });

      await auditLogService.logExcelImport(
        fileName,
        totalRows,
        successCount,
        failedCount,
        managerId,
        affectedEntities
      );

      logger.info("✅ Excel Import audit log created successfully");
    } catch (auditError) {
      logger.error("❌ Error creating Excel Import audit log:", auditError);
      logger.error("❌ Audit error details:", {
        message: (auditError as Error).message,
        stack: (auditError as Error).stack,
        fileName,
        managerId
      });
    }

    return {
      success: successCount,
      failed: failedCount,
      errors,
    };
  }
}

export default new ExcelImportService();
