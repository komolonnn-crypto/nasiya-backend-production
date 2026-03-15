

const isDevelopment = process.env.NODE_ENV === "development";
const isLoggingEnabled = process.env.ENABLE_LOGS === "true" || isDevelopment;

export const logger = {
  log: (...args: any[]) => {
    if (isLoggingEnabled) {
      console.log(...args);
    }
  },

  error: (...args: any[]) => {
    console.error(...args);
  },

  warn: (...args: any[]) => {
    if (isLoggingEnabled) {
      console.warn(...args);
    }
  },

  info: (...args: any[]) => {
    if (isLoggingEnabled) {
      console.info(...args);
    }
  },

  debug: (...args: any[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
};

export default logger;
