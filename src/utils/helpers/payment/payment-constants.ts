

export const PAYMENT_CONSTANTS = {
  
  TOLERANCE: 0.01,

  
  PENDING_TIMEOUT_HOURS: 24,

  
  MAX_PREPAID_BALANCE: 100000,

  
  MIN_PAYMENT_AMOUNT: 0.01,

  
  MAX_SINGLE_PAYMENT: 100000,
} as const;

export const PAYMENT_MESSAGES = {
  PAYMENT_RECEIVED: "To'lov muvaffaqiyatli qabul qilindi",
  PAYMENT_CONFIRMED: "To'lov tasdiqlandi",
  PAYMENT_REJECTED: "To'lov rad etildi",
  PAYMENT_PENDING: "To'lov kassa tasdiqlashini kutmoqda",
  
  UNDERPAID: (amount: number) => `${amount.toFixed(2)} $ kam to'landi`,
  OVERPAID: (amount: number) => `${amount.toFixed(2)} $ ko'p to'landi`,
  
  NOT_FOUND: "To'lov topilmadi",
  ALREADY_CONFIRMED: "To'lov allaqachon tasdiqlangan",
  CONTRACT_NOT_FOUND: "Shartnoma topilmadi",
  MANAGER_NOT_FOUND: "Manager topilmadi",
  
  INSUFFICIENT_AMOUNT: "To'lov summasi yetarli emas",
  INVALID_AMOUNT: "To'lov summasi noto'g'ri",
  NO_REMAINING_DEBT: "Bu to'lovda qolgan qarz yo'q",
} as const;

export const AUDIT_MESSAGES = {
  PAYMENT_CREATED: "To'lov yaratildi",
  PAYMENT_CONFIRMED: "To'lov tasdiqlandi",
  PAYMENT_REJECTED: "To'lov rad etildi",
  PAYMENT_AUTO_REJECTED: "To'lov avtomatik rad etildi (timeout)",
} as const;
