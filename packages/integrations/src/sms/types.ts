export interface SmsAdapter {
  send(phone: string, code: string): Promise<void>;
}

export class NotConfiguredError extends Error {
  constructor(what: string) { super(`${what} not configured`); this.name = "NotConfiguredError"; }
}
