import type { ReactNode } from "react";

export function PageHeader(props: { title: string; description?: string; actions?: ReactNode }): ReactNode {
  return (
    <div className="flex shrink-0 items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{props.title}</h1>
        {props.description ? <p className="mt-1 text-sm text-muted-foreground">{props.description}</p> : null}
      </div>
      {props.actions ? <div className="shrink-0">{props.actions}</div> : null}
    </div>
  );
}
