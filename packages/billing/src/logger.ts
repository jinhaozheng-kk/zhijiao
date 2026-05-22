export interface BillingLogger {
  error: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  info: (obj: object, msg: string) => void;
}

const noop: BillingLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
};

let current: BillingLogger = noop;

export function setBillingLogger(l: BillingLogger): void {
  current = l;
}

export function getBillingLogger(): BillingLogger {
  return current;
}
