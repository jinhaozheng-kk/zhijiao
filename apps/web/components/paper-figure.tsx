/**
 * 试卷配图渲染器：把 AI 产出的「受约束图形 DSL」确定性渲染成 SVG。
 *
 * 设计要点：
 * - 不渲染任何模型给的 SVG/HTML，只按白名单图元（点/线段/圆/文字）绘制，无注入风险；
 * - GEOMETRY：点坐标先自动求包围盒并等比缩放到 0–100 画布（容忍模型给的越界坐标）；
 * - COORDINATE：按 axes 范围等比映射数据坐标，画坐标轴/刻度/点/线段；
 * - 打印友好：纯黑描边、无背景、viewBox 缩放，由外层控制尺寸。
 */
import type { FigureSpec, FigureSegment } from "@zhijiao/ai";
import { sampleCurve } from "@/lib/function-curve";

const FONT_POINT = 3.6;
const FONT_LABEL = 3.2;
const FONT_AXIS = 2.6;
const STROKE = 0.9;

export const FIGURE_TESTID = "paper-figure";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function niceStep(span: number): number {
  const raw = span / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow;
}

function ArrowDefs() {
  return (
    <defs>
      <marker id="pf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
      </marker>
    </defs>
  );
}

function GeometrySvg({ spec }: { spec: Extract<FigureSpec, { kind: "GEOMETRY" }> }) {
  // 兜底：模型经常只给 points 不给 segments（实测简写版会丢线段）。
  // 点 ≥2 → 按点名顺序连接；≥3 时闭合，保证至少画出三角形/四边形示意。
  const segments: FigureSegment[] =
    spec.segments.length > 0
      ? spec.segments
      : spec.points.length >= 3
        ? spec.points.map((p, i) => ({
            from: p.id,
            to: spec.points[(i + 1) % spec.points.length]!.id,
          }))
        : spec.points.length === 2
          ? [{ from: spec.points[0]!.id, to: spec.points[1]!.id }]
          : [];
  const xs = spec.points.map((p) => p.x);
  const ys = spec.points.map((p) => p.y);
  for (const c of spec.circles) {
    xs.push(c.cx - c.r, c.cx + c.r);
    ys.push(c.cy - c.r, c.cy + c.r);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const pad = 10;
  const inner = 100 - pad * 2;
  const scale = inner / Math.max(spanX, spanY);
  const offX = pad + (inner - spanX * scale) / 2 - minX * scale;
  const offY = pad + (inner - spanY * scale) / 2 - minY * scale;
  const tx = (x: number) => offX + x * scale;
  const ty = (y: number) => offY + y * scale;

  const pointById = new Map(spec.points.map((p) => [p.id, p]));
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="auto"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="几何图形"
      className="block w-full text-slate-900"
      style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1 / 1" }}
      data-testid={FIGURE_TESTID}
    >
      <ArrowDefs />
      {spec.circles.map((c, i) => (
        <circle
          key={`c${i}`}
          cx={tx(c.cx)}
          cy={ty(c.cy)}
          r={Math.max(c.r * scale, 0.3)}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeDasharray={c.dashed ? "2 1.4" : undefined}
        />
      ))}
      {segments.map((s, i) => {
        const from = pointById.get(s.from);
        const to = pointById.get(s.to);
        if (!from || !to) return null;
        return (
          <line
            key={`s${i}`}
            x1={tx(from.x)}
            y1={ty(from.y)}
            x2={tx(to.x)}
            y2={ty(to.y)}
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeDasharray={s.dashed ? "2 1.4" : undefined}
          />
        );
      })}
      {spec.points.map((p) => (
        <g key={p.id}>
          <circle cx={tx(p.x)} cy={ty(p.y)} r={1.1} fill="currentColor" />
          <text x={tx(p.x) + 2.2} y={ty(p.y) - 1.6} fontSize={FONT_POINT} fill="currentColor">
            {p.id}
          </text>
        </g>
      ))}
      {spec.labels.map((l, i) => (
        <text key={`l${i}`} x={tx(l.x)} y={ty(l.y)} fontSize={FONT_LABEL} fill="currentColor" textAnchor="middle">
          {l.text}
        </text>
      ))}
    </svg>
  );
}

function CoordinateSvg({ spec }: { spec: Extract<FigureSpec, { kind: "COORDINATE" }> }) {
  const { xMin, xMax, yMin, yMax } = spec.axes;
  const pad = 10;
  const inner = 100 - pad * 2;
  const scale = Math.min(inner / (xMax - xMin), inner / (yMax - yMin));
  const offX = pad + (inner - (xMax - xMin) * scale) / 2 - xMin * scale;
  // y 轴向上：数据 y 越大，画布 y 越小。
  const offY = pad + (inner - (yMax - yMin) * scale) / 2 + yMax * scale;
  const tx = (x: number) => offX + x * scale;
  const ty = (y: number) => offY - y * scale;

  const xAxisY = yMin <= 0 && 0 <= yMax ? ty(0) : yMin >= 0 ? ty(yMin) : ty(yMax);
  const yAxisX = xMin <= 0 && 0 <= xMax ? tx(0) : xMin >= 0 ? tx(xMin) : tx(xMax);

  const xStep = niceStep(xMax - xMin);
  const yStep = niceStep(yMax - yMin);
  const xTicks: number[] = [];
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax + 1e-9; v += xStep) xTicks.push(Number(v.toFixed(6)));
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) yTicks.push(Number(v.toFixed(6)));

  const pointById = new Map(spec.points.map((p) => [p.id, p]));
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="auto"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="平面直角坐标系"
      className="block w-full text-slate-900"
      style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1 / 1" }}
      data-testid={FIGURE_TESTID}
    >
      <ArrowDefs />
      {/* 网格 */}
      {xTicks.map((v) => (
        <line key={`gx${v}`} x1={tx(v)} y1={pad} x2={tx(v)} y2={100 - pad} stroke="currentColor" strokeWidth={0.15} opacity={0.25} />
      ))}
      {yTicks.map((v) => (
        <line key={`gy${v}`} x1={pad} y1={ty(v)} x2={100 - pad} y2={ty(v)} stroke="currentColor" strokeWidth={0.15} opacity={0.25} />
      ))}
      {/* 坐标轴 */}
      <line x1={pad - 3} y1={xAxisY} x2={100 - pad + 3} y2={xAxisY} stroke="currentColor" strokeWidth={STROKE} markerEnd="url(#pf-arrow)" />
      <line x1={yAxisX} y1={100 - pad + 3} x2={yAxisX} y2={pad - 3} stroke="currentColor" strokeWidth={STROKE} markerEnd="url(#pf-arrow)" />
      {/* 刻度与数字 */}
      {xTicks.filter((v) => v !== 0).map((v) => (
        <g key={`tx${v}`}>
          <line x1={tx(v)} y1={xAxisY - 0.8} x2={tx(v)} y2={xAxisY + 0.8} stroke="currentColor" strokeWidth={STROKE} />
          <text x={tx(v)} y={xAxisY + 4.2} fontSize={FONT_AXIS} fill="currentColor" textAnchor="middle">{fmt(v)}</text>
        </g>
      ))}
      {yTicks.filter((v) => v !== 0).map((v) => (
        <g key={`ty${v}`}>
          <line x1={yAxisX - 0.8} y1={ty(v)} x2={yAxisX + 0.8} y2={ty(v)} stroke="currentColor" strokeWidth={STROKE} />
          <text x={yAxisX - 1.6} y={ty(v) + 1} fontSize={FONT_AXIS} fill="currentColor" textAnchor="end">{fmt(v)}</text>
        </g>
      ))}
      <text x={yAxisX - 1.6} y={xAxisY + 1} fontSize={FONT_AXIS} fill="currentColor" textAnchor="end">O</text>
      {/* 函数图象（抛物线/直线/双曲线等）：受限表达式取样成折线 */}
      {(spec.curves ?? []).map((curve, index) =>
        sampleCurve(curve.expression, spec.axes).map((points, lineIndex) => (
          <polyline
            key={`cv${index}-${lineIndex}`}
            points={points.map((p) => `${tx(p.x).toFixed(2)},${ty(p.y).toFixed(2)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeDasharray={curve.dashed ? "2 1.4" : undefined}
          />
        )),
      )}
      {/* 圆（数据坐标） */}
      {spec.circles.map((c, i) => (
        <circle key={`c${i}`} cx={tx(c.cx)} cy={ty(c.cy)} r={Math.max(c.r * scale, 0.3)} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeDasharray={c.dashed ? "2 1.4" : undefined} />
      ))}
      {/* 线段 */}
      {spec.segments.map((s, i) => {
        const from = pointById.get(s.from);
        const to = pointById.get(s.to);
        if (!from || !to) return null;
        return (
          <line key={`s${i}`} x1={tx(from.x)} y1={ty(from.y)} x2={tx(to.x)} y2={ty(to.y)} stroke="currentColor" strokeWidth={STROKE} strokeDasharray={s.dashed ? "2 1.4" : undefined} />
        );
      })}
      {/* 点 */}
      {spec.points.map((p) => (
        <g key={p.id}>
          <circle cx={tx(p.x)} cy={ty(p.y)} r={1.1} fill="currentColor" />
          <text x={tx(p.x) + 2} y={ty(p.y) - 1.4} fontSize={FONT_POINT} fill="currentColor">{p.id}</text>
        </g>
      ))}
      {spec.labels.map((l, i) => (
        <text key={`l${i}`} x={tx(l.x)} y={ty(l.y)} fontSize={FONT_LABEL} fill="currentColor" textAnchor="middle">{l.text}</text>
      ))}
    </svg>
  );
}

export function PaperFigure({
  figure,
  className,
  maxWidthCm = 3.8,
}: {
  figure: FigureSpec | null | undefined;
  className?: string;
  /** 打印尺寸：真实浙江卷配图约 3–4.5cm 宽；太大一页放不下几张图。 */
  maxWidthCm?: number;
}) {
  if (!figure) return null;
  const body =
    figure.kind === "GEOMETRY" ? <GeometrySvg spec={figure} /> : <CoordinateSvg spec={figure} />;
  return (
    <div
      className={`mx-auto my-1 ${className ?? ""}`}
      style={{ width: `${maxWidthCm}cm`, maxWidth: "100%" }}
    >
      {body}
    </div>
  );
}

/**
 * 从 `Paper.paramsJson` 里按题号（1-based position）取配图。
 * 数据结构：paramsJson.figures = { "3": {...FigureSpec} }（兼容 string key）。
 */
export function figureForPosition(
  params: unknown,
  position: number,
): FigureSpec | null {
  if (!params || typeof params !== "object") return null;
  const figures = (params as { figures?: unknown }).figures;
  if (!figures || typeof figures !== "object") return null;
  const raw = (figures as Record<string, unknown>)[String(position)];
  if (!raw || typeof raw !== "object") return null;
  return raw as FigureSpec;
}
