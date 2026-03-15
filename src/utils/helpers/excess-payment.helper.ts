

import logger from "../../utils/logger";

export class ExcessPaymentHelper {
  

  
  static async addToPrepaidBalance(
    excessAmount: number,
    contract: any,
  ): Promise<void> {
    if (excessAmount <= 0.01) {
      return;
    }

    contract.prepaidBalance = (contract.prepaidBalance || 0) + excessAmount;

    logger.debug(`💰 Zapas qo'shildi: ${excessAmount.toFixed(2)} $`);
    logger.debug(`💎 Jami zapas: ${contract.prepaidBalance.toFixed(2)} $`);
  }
}
