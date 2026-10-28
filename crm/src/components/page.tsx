import type { ComponentType, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";

// Kit page header (original/(users) list page): optional breadcrumb trail, bold title, actions on the right.
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** A `Breadcrumb` from `ui/breadcrumb`, shown above the title. */
  breadcrumbs?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      {breadcrumbs}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// Kit stats card (dashboard-11): icon chip and label, then a bold value and a muted hint. No demo deltas.
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
  icon?: ComponentType<{ className?: string }> | undefined;
}) {
  return (
    <Card className="h-full w-full">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 p-4 pb-2">
        {Icon && (
          <span className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded-full">
            <Icon className="size-3.5" />
          </span>
        )}
        <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-0 pb-4">
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
