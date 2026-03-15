import Payment, {
  PaymentStatus,
  PaymentType,
} from "../../schemas/payment.schema";
import Notes from "../../schemas/notes.schema";
import IJwtUser from "../../types/user";
import logger from "../../utils/logger";

export class PaymentCreatorHelper {
  
  static async createMonthlyPayment(data: {
    monthNumber: number;
    amount: number;
    actualAmount: number;
    monthlyPayment: number;
    customerId: any;
    managerId: any;
    user: IJwtUser;
    noteText?: string;
    isPaid?: boolean;
  }) {
    const {
      monthNumber,
      amount,
      actualAmount,
      monthlyPayment,
      customerId,
      managerId,
      user,
      noteText,
      isPaid = true,
    } = data;

    let paymentStatus: PaymentStatus;
    let shortageAmount = 0;

    if (actualAmount >= monthlyPayment - 0.01) {
      paymentStatus = PaymentStatus.PAID;
    } else {
      paymentStatus = PaymentStatus.UNDERPAID;
      shortageAmount = monthlyPayment - actualAmount;
    }

    let finalNoteText =
      noteText ||
      `${monthNumber}-oy to'lovi: ${Math.round(actualAmount)} $`;

    if (paymentStatus === PaymentStatus.UNDERPAID) {
      finalNoteText += `\n⚠️ Kam to'landi: ${Math.round(shortageAmount)} $ qoldi`;
    }

    const notes = await Notes.create({
      text: finalNoteText,
      customer: customerId,
      createBy: String(managerId),
    });

    const payment = await Payment.create({
      amount: Math.round(monthlyPayment),
      actualAmount: Math.round(actualAmount),
      date: new Date(),
      isPaid: isPaid,
      paymentType: PaymentType.MONTHLY,
      customerId: customerId,
      managerId: managerId,
      notes: notes._id,
      status: paymentStatus,
      expectedAmount: Math.round(monthlyPayment),
      remainingAmount: Math.round(shortageAmount),
      excessAmount: 0,
      confirmedAt: isPaid ? new Date() : undefined,
      confirmedBy: isPaid ? user.sub : undefined,
      targetMonth: monthNumber,
    });

    logger.debug(`✅ Payment created for month ${monthNumber}:`, {
      id: payment._id,
      status: paymentStatus,
      amount: actualAmount,
      expected: monthlyPayment,
      shortage: shortageAmount,
    });

    return payment;
  }

  
  static async createAllMonthlyPaymentsForContract(data: {
    contractId: any;
    period: number;
    monthlyPayment: number;
    startDate: Date;
    customerId: any;
    managerId: any;
  }) {
    const {
      contractId,
      period,
      monthlyPayment,
      startDate,
      customerId,
      managerId,
    } = data;

    logger.debug("📅 Creating all monthly payments for contract:", {
      contractId,
      period,
      monthlyPayment,
    });

    const payments = [];
    const start = new Date(startDate);

    for (let month = 1; month <= period; month++) {
      const paymentDate = new Date(start);
      paymentDate.setMonth(paymentDate.getMonth() + month);

      const notes = await Notes.create({
        text: `${month}-oy to'lovi (rejalashtirilgan)`,
        customer: customerId,
        createBy: String(managerId),
      });

      const payment = await Payment.create({
        amount: Math.round(monthlyPayment),
        actualAmount: 0,
        date: paymentDate,
        isPaid: false,
        paymentType: PaymentType.MONTHLY,
        customerId: customerId,
        managerId: managerId,
        notes: notes._id,
        status: PaymentStatus.SCHEDULED,
        expectedAmount: Math.round(monthlyPayment),
        remainingAmount: Math.round(monthlyPayment),
        excessAmount: 0,
        targetMonth: month,
        reminderDate: null,
        contractId: String(contractId),
      });

      payments.push(payment);

      logger.debug(`  ✓ Payment created for month ${month}: ${payment._id}`);
    }

    logger.debug(`✅ Created ${payments.length} SCHEDULED payment(s) for contract ${contractId}`);

    return payments;
  }

  
  static async createMultipleMonthlyPayments(data: {
    totalAmount: number;
    monthlyPayment: number;
    startMonthIndex: number;
    maxMonths: number;
    customerId: any;
    managerId: any;
    user: IJwtUser;
    contract: any;
    notePrefix?: string;
  }) {
    const {
      totalAmount,
      monthlyPayment,
      startMonthIndex,
      maxMonths,
      customerId,
      managerId,
      user,
      contract,
      notePrefix = "",
    } = data;

    const createdPayments = [];
    let remainingAmount = totalAmount;
    let currentMonthIndex = startMonthIndex;

    logger.debug("📊 Creating multiple payments:", {
      totalAmount,
      monthlyPayment,
      startMonthIndex,
      maxMonths,
    });

    while (remainingAmount > 0.01 && currentMonthIndex < maxMonths) {
      const monthNumber = currentMonthIndex + 1;
      const paymentAmount = Math.min(remainingAmount, monthlyPayment);

      const noteText = notePrefix
        ? `${notePrefix} - ${monthNumber}-oy to'lovi: ${Math.round(paymentAmount)} $`
        : undefined;

      const payment = await this.createMonthlyPayment({
        monthNumber,
        amount: monthlyPayment,
        actualAmount: paymentAmount,
        monthlyPayment,
        customerId,
        managerId,
        user,
        noteText,
        isPaid: true,
      });

      createdPayments.push(payment);

      if (!contract.payments) {
        contract.payments = [];
      }
      (contract.payments as any[]).push(payment._id);

      remainingAmount -= paymentAmount;
      currentMonthIndex++;
    }

    logger.debug(`✅ Created ${createdPayments.length} payment(s)`);

    return {
      payments: createdPayments,
      remainingAmount,
      lastMonthIndex: currentMonthIndex,
    };
  }
}
