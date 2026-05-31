const WECHAT_OFFICIAL_ACCOUNT = "PLACEHOLDER_WECHAT_OFFICIAL_ACCOUNT";
const SUPPORT_EMAIL = "support@zhijiao.example";
const OPERATOR_ENTITY = "PLACEHOLDER_OPERATOR_ENTITY";
const ICP_NUMBER = "PLACEHOLDER_ICP_NUMBER";

const COPY = {
  title: "\u8d26\u53f7\u6ce8\u9500\u4e0e\u4e2a\u4eba\u4fe1\u606f\u5904\u7406",
  pipl47:
    "\u4f9d\u636e\u300a\u4e2a\u4eba\u4fe1\u606f\u4fdd\u62a4\u6cd5\u300b\u7b2c\u56db\u5341\u4e03\u6761\uff0c\u60a8\u6709\u6743\u8bf7\u6c42\u6ce8\u9500\u8d26\u53f7\u5e76\u5220\u9664\u6216\u533f\u540d\u5316\u60a8\u7684\u4e2a\u4eba\u4fe1\u606f\u3002",
  pipl45:
    "\u4f9d\u636e\u300a\u4e2a\u4eba\u4fe1\u606f\u4fdd\u62a4\u6cd5\u300b\u7b2c\u56db\u5341\u4e94\u6761\uff0c\u60a8\u4e5f\u6709\u6743\u83b7\u53d6\u4e2a\u4eba\u4fe1\u606f\u526f\u672c\u3002\u8bf7\u901a\u8fc7\u4e0a\u8ff0\u6e20\u9053\u7533\u8bf7\uff0c\u6211\u4eec\u4f1a\u4ee5 JSON \u6587\u4ef6\u5f62\u5f0f\u4ea4\u4ed8\u3002",
};

export default function DeactivateSupportPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-900">
      <h1 className="text-3xl font-bold tracking-tight">{COPY.title}</h1>
      <p className="mt-4 text-slate-700">{COPY.pipl47}</p>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">{"\u5982\u4f55\u7533\u8bf7"}</h2>
        <p>{"\u5f53\u524d\u6ce8\u9500\u6d41\u7a0b\u901a\u8fc7\u4eba\u5de5\u5904\u7406\u3002\u8bf7\u9009\u62e9\u4ee5\u4e0b\u4efb\u4e00\u6e20\u9053\u4e0e\u6211\u4eec\u8054\u7cfb\uff1a"}</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>{"\u5fae\u4fe1\u516c\u4f17\u53f7\uff1a"}{WECHAT_OFFICIAL_ACCOUNT}</li>
          <li>{"\u5ba2\u670d\u90ae\u7bb1\uff1a"}{SUPPORT_EMAIL}</li>
          <li>{"\u5de5\u5355\uff1a\u6682\u672a\u5f00\u653e"}</li>
        </ul>
        <p>{"\u8bf7\u5728\u7533\u8bf7\u4e2d\u63d0\u4f9b\u6ce8\u518c\u624b\u673a\u53f7\u7528\u4e8e\u8eab\u4efd\u6838\u9a8c\uff1b\u6ce8\u9500\u539f\u56e0\u53ef\u9009\u3002"}</p>
        <p>{"\u5df2\u767b\u5f55\u7528\u6237\u53ef\u5728\u300c\u6570\u636e\u4e0e\u9690\u79c1\u300d(/account/privacy)\u81ea\u52a9\u4e0b\u8f7d\u6570\u636e\u526f\u672c\u6216\u53d1\u8d77\u6ce8\u9500\u7533\u8bf7\u3002"}</p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">{"\u5904\u7406\u65f6\u9650"}</h2>
        <p>{"\u6211\u4eec\u627f\u8bfa\u5728\u6536\u5230\u5b8c\u6574\u8eab\u4efd\u6838\u9a8c\u4fe1\u606f\u540e 15 \u4e2a\u5de5\u4f5c\u65e5\u5185\u5b8c\u6210\u6ce8\u9500\u3002"}</p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">{"\u8eab\u4efd\u6838\u9a8c\u65b9\u5f0f"}</h2>
        <p>{"\u6211\u4eec\u4f1a\u901a\u8fc7\u60a8\u6ce8\u518c\u65f6\u4f7f\u7528\u7684\u624b\u673a\u53f7\u53d1\u9001\u9a8c\u8bc1\u7801\u8fdb\u884c\u6838\u9a8c\u3002\u5fae\u4fe1\u6ce8\u518c\u7684\u8d26\u53f7\u9700\u63d0\u4f9b\u7ed1\u5b9a\u624b\u673a\u53f7\u3002"}</p>
        <p>{"\u672a\u6ee1 14 \u5468\u5c81\u7684\u7528\u6237\uff0c\u8bf7\u7531\u76d1\u62a4\u4eba\u53d1\u8d77\u7533\u8bf7\u5e76\u5b8c\u6210\u5fc5\u8981\u6838\u9a8c\u3002"}</p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">{"\u6ce8\u9500\u540e\u60a8\u7684\u6570\u636e\u5904\u7f6e"}</h2>
        <ol className="list-decimal space-y-2 pl-6">
          <li>{"\u7acb\u5373\u5220\u9664\uff1a\u59d3\u540d\u3001\u5934\u50cf\u3001\u767b\u5f55\u8eab\u4efd\u3001\u9a8c\u8bc1\u7801\u8bb0\u5f55\u3001\u9519\u9898\u672c\u3001\u53d8\u5f0f\u9898\u3001\u81ea\u5efa\u9898\u76ee\u5185\u5bb9\u3002"}</li>
          <li>{"\u53bb\u6807\u8bc6\u5316\uff1a\u4f1a\u8bdd\u8bb0\u5f55\u3001\u652f\u4ed8\u8ba2\u5355\u4e2d\u7684 IP \u4e0e\u8bbe\u5907\u4fe1\u606f\u3002"}</li>
          <li>{"\u4f9d\u6cd5\u4fdd\u7559\uff1a\u652f\u4ed8\u91d1\u989d\u3001\u8ba2\u5355\u53f7\u3001\u4ea4\u6613\u53f7\u5c06\u4f5c\u4e3a\u8d22\u52a1\u51ed\u8bc1\u4fdd\u7559\uff0c\u4f46\u4e0e\u8eab\u4efd\u4fe1\u606f\u5207\u65ad\u5173\u8054\u3002"}</li>
          <li>{"\u6ce8\u9500\u540e\u8d26\u53f7\u65e0\u6cd5\u6062\u590d\uff1b\u5982\u9700\u518d\u6b21\u4f7f\u7528\u672c\u4ea7\u54c1\uff0c\u8bf7\u4f7f\u7528\u65b0\u8d26\u53f7\u6ce8\u518c\u3002"}</li>
        </ol>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">{"\u6570\u636e\u526f\u672c\u6743\u5229"}</h2>
        <p>{COPY.pipl45}</p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">{"\u4e3b\u4f53\u4fe1\u606f"}</h2>
        <p>{"\u8fd0\u8425\u4e3b\u4f53\uff1a"}{OPERATOR_ENTITY}</p>
        <p>{"ICP\u5907\u6848\u53f7\uff1a"}{ICP_NUMBER}</p>
      </section>
    </main>
  );
}
