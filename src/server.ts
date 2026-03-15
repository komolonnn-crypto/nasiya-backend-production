import "reflect-metadata";
import app from "./app";

import connectDB from "./config/db";
import bot from "./bot/main";

import { checkAllContractsStatus } from "./utils/checkAllContractsStatus";
import createCurrencyCourse from "./utils/createCurrencyCourse";
import createSuperAdmin from "./utils/createSuperAdmin";
import seedRoles from "./utils/createRole";
import logger from "./utils/logger";

import debtorService from "./dashboard/services/debtor.service";
import backupService from "./services/backup.service";
import { startReminderCleanupCron } from "./cron/reminder-cleanup.cron";

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();
    await seedRoles();
    await createCurrencyCourse();
    await createSuperAdmin();

    app.listen(PORT, () => {
      logger.debug(`Server is running on port ${PORT}`);
    });

    backupService.startScheduledBackup();

    startReminderCleanupCron();

    setInterval(
      async () => {
        try {
          await debtorService.createOverdueDebtors();
        } catch (error) {
          logger.error("Error in automatic debtor creation:", error);
        }
      },
      24 * 60 * 60 * 1000,
    );

    setInterval(
      async () => {
        try {
          logger.info(
            "🕐 Running scheduled task: Check expired PENDING payments",
          );
          const paymentService = (
            await import("./dashboard/services/payment.service")
          ).default;
          await paymentService.checkAndRejectExpiredPayments();
        } catch (error) {
          logger.error("Error in automatic PENDING payment rejection:", error);
        }
      },
      60 * 60 * 1000,
    );

    setTimeout(async () => {
      try {
        await debtorService.createOverdueDebtors();
      } catch (error) {
        logger.error("Error in initial debtor creation:", error);
      }
    }, 5000);

    setTimeout(async () => {
      try {
        logger.info("🔥 === MANUAL DEBTOR TRIGGER (DEBUG) ===");
        const result = await debtorService.createOverdueDebtors();
        logger.info("🔥 Manual trigger result:", result);
      } catch (error) {
        logger.error("Error in manual debtor trigger:", error);
      }
    }, 30000);

    setTimeout(async () => {
      try {
        logger.debug("🔍 Starting contract status check...");
        await checkAllContractsStatus();
      } catch (error) {
        logger.error("Error in contract status check:", error);
      }
    }, 10000);

    setTimeout(async () => {
      try {
        logger.info("🕐 Initial check: Expired PENDING payments");
        const paymentService = (
          await import("./dashboard/services/payment.service")
        ).default;
        await paymentService.checkAndRejectExpiredPayments();
      } catch (error) {
        logger.error("Error in initial PENDING payment check:", error);
      }
    }, 15000);

    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    logger.debug(`Dastur xotira iste'moli: ${Math.round(used * 100) / 100} MB`);
  } catch (error) {
    logger.error("Server start error:", error);
  }
};

const startApplication = async () => {
  try {
    await startServer();

    const enableBot = process.env.ENABLE_BOT;
    const hasToken = !!process.env.BOT_TOKEN;
    const botHostUrl = process.env.BOT_HOST_URL;

    logger.debug(` Bot configuration check:`);
    logger.debug(`   - Has token: ${hasToken}`);
    logger.debug(`   - Environment: ${process.env.NODE_ENV || "development"}`);
    logger.debug(`   - ENABLE_BOT: ${enableBot || "not set"}`);

    const shouldStartBot = hasToken && enableBot !== "false";
    const isProduction = process.env.NODE_ENV === "production";
    const isValidWebhookUrl = botHostUrl && botHostUrl.startsWith("https://");

    if (shouldStartBot) {
      if (isValidWebhookUrl) {
        logger.debug("Setting up Telegram webhook...");
        try {
          await bot.telegram.deleteWebhook({ drop_pending_updates: true });

          const webhookUrl = `${botHostUrl}/telegram-webhook`;
          await bot.telegram.setWebhook(webhookUrl, {
            drop_pending_updates: true,
          });

          const webhookInfo = await bot.telegram.getWebhookInfo();
          logger.debug(
            `Webhook status: ${webhookInfo.url ? "Active" : "Inactive"}`,
          );
          logger.debug(`Webhook URL: ${webhookInfo.url}`);
        } catch (botError: any) {
          logger.error("Webhook setup failed:", botError.message);
        }
      } else {
        logger.debug("Starting bot in polling mode (development)...");
        try {
          await bot.telegram.deleteWebhook({ drop_pending_updates: true });

          bot
            .launch({
              dropPendingUpdates: true,
            })
            .then(() => {
              logger.debug("🤖 Bot started successfully in polling mode");
            })
            .catch((err) => {
              logger.error("Bot polling failed:", err.message);
            });

          process.once("SIGINT", () => bot.stop("SIGINT"));
          process.once("SIGTERM", () => bot.stop("SIGTERM"));

          logger.debug("🤖 Bot polling mode initialized");
        } catch (botError: any) {
          logger.error("Bot polling setup failed:", botError.message);
        }
      }
    } else if (hasToken && enableBot === "false") {
      logger.debug("Bot disabled by ENABLE_BOT=false");
    } else {
      logger.debug("Bot token not found, skipping bot initialization");
    }
  } catch (err) {
    logger.error("Application start error:", err);
    process.exit(1);
  }
};

startApplication();
