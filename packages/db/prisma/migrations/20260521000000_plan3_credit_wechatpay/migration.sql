-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('TOPUP', 'DEBIT', 'COMPENSATION', 'ADJUST_ADD', 'ADJUST_SUB');

-- CreateEnum
CREATE TYPE "TopupStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WechatPayEventVerify" AS ENUM ('PENDING', 'OK', 'SIG_INVALID', 'CERT_NOT_FOUND', 'PARSE_FAILED');

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "idem_key" TEXT NOT NULL,
    "ref_table" TEXT,
    "ref_id" TEXT,
    "action_kind" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topup_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" "TopupStatus" NOT NULL DEFAULT 'CREATED',
    "out_trade_no" TEXT NOT NULL,
    "prepay_id" TEXT,
    "transaction_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3) NOT NULL,
    "ip_created" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topup_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_pay_events" (
    "id" TEXT NOT NULL,
    "out_trade_no" TEXT NOT NULL,
    "transaction_id" TEXT,
    "raw_body" TEXT NOT NULL,
    "signature" TEXT,
    "timestamp" TEXT,
    "nonce" TEXT,
    "serial" TEXT,
    "verify_status" "WechatPayEventVerify" NOT NULL DEFAULT 'PENDING',
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_pay_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_idem_key_key" ON "credit_ledger"("idem_key");

-- CreateIndex
CREATE INDEX "credit_ledger_wallet_id_created_at_idx" ON "credit_ledger"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "credit_ledger_ref_table_ref_id_idx" ON "credit_ledger"("ref_table", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "topup_orders_out_trade_no_key" ON "topup_orders"("out_trade_no");

-- CreateIndex
CREATE UNIQUE INDEX "topup_orders_transaction_id_key" ON "topup_orders"("transaction_id");

-- CreateIndex
CREATE INDEX "topup_orders_user_id_created_at_idx" ON "topup_orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "topup_orders_status_expired_at_idx" ON "topup_orders"("status", "expired_at");

-- CreateIndex
CREATE INDEX "topup_orders_user_id_status_created_at_idx" ON "topup_orders"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "topup_orders_user_id_paid_at_idx" ON "topup_orders"("user_id", "paid_at");

-- CreateIndex
CREATE INDEX "wechat_pay_events_out_trade_no_idx" ON "wechat_pay_events"("out_trade_no");

-- CreateIndex
CREATE INDEX "wechat_pay_events_handled_created_at_idx" ON "wechat_pay_events"("handled", "created_at");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
