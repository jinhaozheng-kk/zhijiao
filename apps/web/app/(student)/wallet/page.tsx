import { TopupForm } from "./topup-form";
import { LedgerList } from "./ledger-list";

export default function WalletPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10 space-y-8">
      <h1 className="text-2xl font-bold">钱包</h1>
      <TopupForm />
      <LedgerList />
    </main>
  );
}
