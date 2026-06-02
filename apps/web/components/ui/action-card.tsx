import Link from "next/link";

export function ActionCard({
  href,
  title,
  description,
  label,
}: {
  href: string;
  title: string;
  description: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      <span className="mt-6 inline-flex text-sm font-medium">{label}</span>
    </Link>
  );
}
