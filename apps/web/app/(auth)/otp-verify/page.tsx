import { Suspense } from "react";
import { OtpForm } from "@/components/OtpForm";
export default function OtpVerifyPage() {
  return (
    <main className="mx-auto max-w-md p-8 space-y-6">
      <h1 className="text-2xl font-bold">输入验证码</h1>
      <Suspense fallback={<p>加载中...</p>}><OtpForm /></Suspense>
    </main>
  );
}
