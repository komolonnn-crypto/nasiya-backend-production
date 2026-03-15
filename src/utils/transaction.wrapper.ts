

import mongoose, { ClientSession } from "mongoose";
import logger from "./logger";

const isReplicaSetEnabled = (): boolean => {
  const replicaSetEnv = process.env.MONGODB_REPLICA_SET;
  return replicaSetEnv === "true";
};

export async function withTransaction<T>(
  operation: (session: ClientSession | null) => Promise<T>
): Promise<T> {
  if (!isReplicaSetEnabled()) {
    logger.debug("📝 Running without transaction (standalone MongoDB)");
    return await operation(null);
  }

  logger.debug("🔒 Starting transaction (Replica Set)");
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await operation(session);
    await session.commitTransaction();
    logger.debug("✅ Transaction committed successfully");
    return result;
  } catch (error) {
    await session.abortTransaction();
    logger.error("❌ Transaction aborted due to error:", error);
    throw error;
  } finally {
    session.endSession();
  }
}

export async function withTransactionBatch<T extends any[]>(
  operations: Array<(session: ClientSession | null) => Promise<any>>
): Promise<T> {
  return withTransaction(async (session) => {
    const results = [];
    for (const operation of operations) {
      const result = await operation(session);
      results.push(result);
    }
    return results as T;
  });
}

export async function withTransactionRetry<T>(
  operation: (session: ClientSession | null) => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await withTransaction(operation);
    } catch (error: any) {
      lastError = error;
      
      const isRetryable = 
        error.hasErrorLabel?.("TransientTransactionError") ||
        error.hasErrorLabel?.("UnknownTransactionCommitResult");
      
      if (!isRetryable || attempt === maxRetries) {
        break;
      }
      
      logger.warn(`⚠️ Transaction failed (attempt ${attempt}/${maxRetries}), retrying...`);
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
  
  throw lastError;
}

export default withTransaction;
