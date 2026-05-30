"use client";
import { trpc } from "@/lib/trpc-client";

export default function GuardianConsentPage() {
  const create = trpc.family.createInviteCode.useMutation();
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold">请监护人确认后开通</h1>
      <p className="mt-3 text-sm text-slate-600">
        你还不满 14 周岁，按照未成年人保护规定，需要监护人确认同意后才能开始使用学习功能。这一步很简单，按下面的指引来就好。
      </p>

      <div className="mt-6 space-y-4">
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          data-testid="btn-create-consent-code"
        >
          {create.isPending ? "生成中…" : "生成监护人邀请码"}
        </button>

        {create.data && (
          <div className="rounded border bg-slate-50 p-4" data-testid="consent-code">
            <p className="text-sm text-slate-600">把这串邀请码发给监护人：</p>
            <p className="mt-1 font-mono text-2xl tracking-widest">
              {create.data.code}
            </p>
            <p className="mt-1 text-xs text-slate-500">有效期 15 分钟</p>
          </div>
        )}

        {create.isError && (
          <p className="text-sm text-rose-600" data-testid="consent-code-error">
            邀请码生成失败，请稍后再试一次。
          </p>
        )}
      </div>

      <section className="mt-8 space-y-3 text-sm text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">监护人怎么做</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>请监护人使用<strong>家长（PARENT）账号</strong>登录。</li>
          <li>
            在<strong>家长端绑定</strong>页面输入上面这串邀请码。
          </li>
          <li>阅读并确认下面的同意声明，即可为孩子开通账号。</li>
        </ol>
      </section>

      <section className="mt-8 space-y-3 text-sm text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">监护人同意声明</h2>
        <p>
          我作为该未成年人的监护人，知悉并同意本平台为其提供学习服务而处理其学习数据，包括用于<strong>AI 答疑</strong>、<strong>错题本</strong>与<strong>学情</strong>等功能。
        </p>
        <p>
          这些数据仅用于向孩子提供上述学习服务，不会用于其它无关用途。监护人可<strong>随时撤回同意</strong>，撤回后孩子账号将停止使用相关功能。
        </p>
        <p className="text-xs text-slate-500">
          如果你对这些内容有疑问，可以先和监护人一起阅读，再决定是否继续。
        </p>
      </section>
    </main>
  );
}
