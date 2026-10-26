/**
 * 选择题选项渲染：预览页与打印页共用，保证两处字母序（A/B/C/D）与换行行为一致。
 *
 * `optionsJson` 来自 `PaperItem.optionsJson`（Prisma Json），只在确实是数组且非空时渲染；
 * 非选择题 / 题库题缺 options 时返回 null（不占位、不报错）。
 * 选项内可能含 LaTeX（如 `$x^2$`），统一走 MathText 渲染。
 */
import { MathText } from "@/components/math-text";

export function PaperItemOptions({
  optionsJson,
  className,
}: {
  optionsJson: unknown;
  className?: string;
}) {
  if (!Array.isArray(optionsJson) || optionsJson.length === 0) return null;
  return (
    <ul
      className={className ?? "mt-2 space-y-1 text-sm leading-7 text-slate-900"}
      data-testid="paper-item-options"
    >
      {optionsJson.map((opt, idx) => (
        <li key={idx} className="whitespace-pre-wrap">
          {String.fromCharCode(65 + idx)}. <MathText text={String(opt)} />
        </li>
      ))}
    </ul>
  );
}
