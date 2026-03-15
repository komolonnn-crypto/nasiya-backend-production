

import { Request, Response } from "express";
import mongoose from "mongoose";
import Contract from "../schemas/contract.schema";
import Payment from "../schemas/payment.schema";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  checks: {
    database: HealthCheck;
    memory: HealthCheck;
    contracts: HealthCheck;
    payments: HealthCheck;
  };
}

interface HealthCheck {
  status: "pass" | "warn" | "fail";
  message: string;
  responseTime?: number;
  details?: any;
}

async function checkDatabase(): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    if (mongoose.connection.readyState !== 1) {
      return {
        status: "fail",
        message: "Database not connected",
        responseTime: Date.now() - startTime,
      };
    }

    if (!mongoose.connection.db) {
      return {
        status: "fail",
        message: "Database not initialized",
        responseTime: Date.now() - startTime,
      };
    }

    await mongoose.connection.db.admin().ping();

    const responseTime = Date.now() - startTime;

    return {
      status: responseTime < 100 ? "pass" : "warn",
      message:
        responseTime < 100 ? "Database connected" : "Database slow response",
      responseTime,
      details: {
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        name: mongoose.connection.name,
      },
    };
  } catch (error: any) {
    return {
      status: "fail",
      message: `Database error: ${error.message}`,
      responseTime: Date.now() - startTime,
    };
  }
}

function checkMemory(): HealthCheck {
  const usage = process.memoryUsage();
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
  const usagePercent = (heapUsedMB / heapTotalMB) * 100;

  let status: "pass" | "warn" | "fail" = "pass";
  let message = `Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`;

  if (usagePercent > 90) {
    status = "fail";
    message = `Critical memory usage: ${usagePercent.toFixed(1)}%`;
  } else if (usagePercent > 75) {
    status = "warn";
    message = `High memory usage: ${usagePercent.toFixed(1)}%`;
  }

  return {
    status,
    message,
    details: {
      heapUsed: heapUsedMB,
      heapTotal: heapTotalMB,
      usagePercent: usagePercent.toFixed(1),
      rss: Math.round(usage.rss / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
    },
  };
}

async function checkContracts(): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    const count = await Contract.countDocuments();
    const responseTime = Date.now() - startTime;

    return {
      status: responseTime < 200 ? "pass" : "warn",
      message: `Contract service operational (${count} contracts)`,
      responseTime,
      details: {
        totalContracts: count,
      },
    };
  } catch (error: any) {
    return {
      status: "fail",
      message: `Contract service error: ${error.message}`,
      responseTime: Date.now() - startTime,
    };
  }
}

async function checkPayments(): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    const count = await Payment.countDocuments();
    const responseTime = Date.now() - startTime;

    return {
      status: responseTime < 200 ? "pass" : "warn",
      message: `Payment service operational (${count} payments)`,
      responseTime,
      details: {
        totalPayments: count,
      },
    };
  } catch (error: any) {
    return {
      status: "fail",
      message: `Payment service error: ${error.message}`,
      responseTime: Date.now() - startTime,
    };
  }
}

export async function healthCheck(req: Request, res: Response): Promise<void> {
  try {
    const [database, memory, contracts, payments] = await Promise.all([
      checkDatabase(),
      Promise.resolve(checkMemory()),
      checkContracts(),
      checkPayments(),
    ]);

    const checks = { database, memory, contracts, payments };

    const hasFailure = Object.values(checks).some((c) => c.status === "fail");
    const hasWarning = Object.values(checks).some((c) => c.status === "warn");

    let overallStatus: "healthy" | "degraded" | "unhealthy";
    if (hasFailure) {
      overallStatus = "unhealthy";
    } else if (hasWarning) {
      overallStatus = "degraded";
    } else {
      overallStatus = "healthy";
    }

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      version: process.env.npm_package_version || "unknown",
      checks,
    };

    const statusCode = overallStatus === "unhealthy" ? 503 : 200;

    res.status(statusCode).json(healthStatus);
  } catch (error: any) {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
}

export function livenessProbe(req: Request, res: Response): void {
  res.status(200).json({ status: "alive" });
}

export async function readinessProbe(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ status: "not ready", reason: "database" });
      return;
    }

    res.status(200).json({ status: "ready" });
  } catch (error: any) {
    res.status(503).json({ status: "not ready", error: error.message });
  }
}
