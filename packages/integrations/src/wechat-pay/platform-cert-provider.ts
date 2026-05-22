import { readFileSync } from "node:fs";

export interface PlatformCertProvider {
  getBySerial(serial: string): Promise<string | null>;
}

export class SingleFilePlatformCertProvider implements PlatformCertProvider {
  private readonly cert: string;
  constructor(
    private readonly serial: string,
    pubKeyFile: string,
  ) {
    this.cert = readFileSync(pubKeyFile, "utf8");
  }
  async getBySerial(serial: string): Promise<string | null> {
    return serial === this.serial ? this.cert : null;
  }
}
