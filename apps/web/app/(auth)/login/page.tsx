import { LoginForm } from "@/components/LoginForm";
export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md p-8 space-y-6">
      <h1 className="text-2xl font-bold">登录</h1>
      <LoginForm />
    </main>
  );
}
