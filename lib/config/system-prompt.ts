import fs from "fs";
import path from "path";

export interface SystemPromptData {
  credentials: {
    backoffice: { username: string; password: string };
    partner: { username: string; password: string };
    website: { testPhoneNumber: string; otpCode: string };
  };
  testCards: {
    visa: { number: string; expiry: string; cvv: string };
    mastercard: { number: string; expiry: string; cvv: string };
  };
  otp: {
    defaultCode: string;
    testPhoneNumber: string;
  };
  commonData: {
    testEmail: string;
    testPhone: string;
    testName: string;
  };
}

let _cached: SystemPromptData | null = null;

export function clearSystemPromptCache(): void {
  _cached = null;
}

export function getSystemPromptData(): SystemPromptData {
  if (_cached) return _cached;

  const filePath = path.join(process.cwd(), "data", "system-prompt.json");
  const examplePath = path.join(process.cwd(), "data", "system-prompt.json.example");

  const targetPath = fs.existsSync(filePath) ? filePath : examplePath;

  if (!fs.existsSync(targetPath)) {
    throw new Error(
      "data/system-prompt.json bulunamadı. data/system-prompt.json.example dosyasını kopyalayın."
    );
  }

  _cached = JSON.parse(fs.readFileSync(targetPath, "utf-8")) as SystemPromptData;
  return _cached;
}

export function injectTemplateVars(
  template: string,
  data: SystemPromptData
): string {
  return template
    .replace(/\{\{credentials\.backoffice\.username\}\}/g, data.credentials.backoffice.username)
    .replace(/\{\{credentials\.backoffice\.password\}\}/g, data.credentials.backoffice.password)
    .replace(/\{\{credentials\.partner\.username\}\}/g, data.credentials.partner.username)
    .replace(/\{\{credentials\.partner\.password\}\}/g, data.credentials.partner.password)
    .replace(/\{\{credentials\.website\.testPhoneNumber\}\}/g, data.credentials.website.testPhoneNumber)
    .replace(/\{\{credentials\.website\.otpCode\}\}/g, data.credentials.website.otpCode)
    // Geriye dönük uyumluluk — eski template'lerdeki email/password placeholder'ları
    .replace(/\{\{credentials\.website\.email\}\}/g, data.commonData.testEmail)
    .replace(/\{\{credentials\.website\.password\}\}/g, data.credentials.website.otpCode)
    .replace(/\{\{otp\.defaultCode\}\}/g, data.otp.defaultCode)
    .replace(/\{\{otp\.testPhoneNumber\}\}/g, data.otp.testPhoneNumber)
    .replace(/\{\{commonData\.testEmail\}\}/g, data.commonData.testEmail)
    .replace(/\{\{commonData\.testPhone\}\}/g, data.commonData.testPhone)
    .replace(/\{\{commonData\.testName\}\}/g, data.commonData.testName)
    .replace(/\{\{testCards\.visa\.number\}\}/g, data.testCards.visa.number)
    .replace(/\{\{testCards\.visa\.expiry\}\}/g, data.testCards.visa.expiry)
    .replace(/\{\{testCards\.visa\.cvv\}\}/g, data.testCards.visa.cvv)
    .replace(/\{\{testCards\.mastercard\.number\}\}/g, data.testCards.mastercard.number)
    .replace(/\{\{testCards\.mastercard\.expiry\}\}/g, data.testCards.mastercard.expiry)
    .replace(/\{\{testCards\.mastercard\.cvv\}\}/g, data.testCards.mastercard.cvv);
}
