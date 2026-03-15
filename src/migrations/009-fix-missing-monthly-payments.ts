

import mongoose from 'mongoose';
import Contract from '../schemas/contract.schema';
import Payment, { PaymentType } from '../schemas/payment.schema';
import Notes from '../schemas/notes.schema';
import logger from '../utils/logger';

async function fixMissingMonthlyPayments() {
  try {
    logger.info('🔧 Starting migration: Fix Missing Monthly Payments');
    
    const contracts = await Contract.find({
      isDeleted: false,
      status: 'active',
    }).populate('payments');
    
    logger.info(`📊 Found ${contracts.length} active contracts`);
    
    let fixedCount = 0;
    let totalPaymentsCreated = 0;
    
    for (const contract of contracts) {
      const payments = contract.payments as any[];
      
      const initialPayment = payments.find(p => p.paymentType === PaymentType.INITIAL);
      const monthlyPayments = payments.filter(p => p.paymentType === PaymentType.MONTHLY);
      
      const expectedMonthlyPayments = contract.period;
      const actualMonthlyPayments = monthlyPayments.length;
      
      if (actualMonthlyPayments < expectedMonthlyPayments) {
        logger.info(`\n📋 Contract ${contract._id} needs fixing:`);
        logger.info(`   Customer: ${(contract.customer as any).fullName}`);
        logger.info(`   Period: ${contract.period} months`);
        logger.info(`   Expected monthly payments: ${expectedMonthlyPayments}`);
        logger.info(`   Actual monthly payments: ${actualMonthlyPayments}`);
        logger.info(`   Missing: ${expectedMonthlyPayments - actualMonthlyPayments}`);
        
        const startDate = new Date(contract.startDate);
        const originalDay = contract.originalPaymentDay || startDate.getDate();
        
        const existingMonths = monthlyPayments.map(p => p.targetMonth).sort((a, b) => a - b);
        
        for (let month = 1; month <= expectedMonthlyPayments; month++) {
          if (existingMonths.includes(month)) {
            continue;
          }
          
          const paymentDate = new Date(
            startDate.getFullYear(),
            startDate.getMonth() + month,
            1
          );
          
          const lastDayOfMonth = new Date(
            paymentDate.getFullYear(),
            paymentDate.getMonth() + 1,
            0
          ).getDate();
          
          paymentDate.setDate(Math.min(originalDay, lastDayOfMonth));
          
          
          let notesId = initialPayment?.notes;
          if (!notesId) {
            const anyPaymentWithNotes = monthlyPayments.find(p => p.notes);
            if (anyPaymentWithNotes) {
              notesId = anyPaymentWithNotes.notes;
            } else {
              const newNotes = await Notes.create({
                text: `Avtomatik yaratilgan ${month}-oy uchun`,
                customer: contract.customer,
                createBy: contract.createBy,
              });
              notesId = newNotes._id;
            }
          }
          
          const newPayment = await Payment.create({
            amount: contract.monthlyPayment,
            date: paymentDate,
            isPaid: false,
            paymentType: PaymentType.MONTHLY,
            targetMonth: month,
            status: 'PENDING',
            customerId: contract.customer,
            managerId: contract.createBy,
            notes: notesId,
          });
          
          contract.payments.push(newPayment._id as any);
          totalPaymentsCreated++;
          
          logger.info(`   ✅ Created payment for month ${month}: ${paymentDate.toISOString().split('T')[0]}`);
        }
        
        const unpaidPayments = await Payment.find({
          _id: { $in: contract.payments },
          isPaid: false,
          paymentType: PaymentType.MONTHLY,
        }).sort({ targetMonth: 1 });
        
        if (unpaidPayments.length > 0) {
          contract.nextPaymentDate = unpaidPayments[0].date;
          logger.info(`   ✅ Updated nextPaymentDate: ${contract.nextPaymentDate.toISOString().split('T')[0]}`);
        }
        
        await contract.save();
        fixedCount++;
      }
    }
    
    logger.info(`\n✅ Migration completed successfully!`);
    logger.info(`📊 Fixed contracts: ${fixedCount}`);
    logger.info(`📊 Total payments created: ${totalPaymentsCreated}`);
    
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasiya_db';
  
  mongoose.connect(MONGODB_URI)
    .then(async () => {
      logger.info('✅ Connected to MongoDB');
      await fixMissingMonthlyPayments();
      process.exit(0);
    })
    .catch((err) => {
      logger.error('❌ MongoDB connection failed:', err);
      process.exit(1);
    });
}

export default fixMissingMonthlyPayments;
