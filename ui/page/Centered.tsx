import type { ReactNode } from "react";

export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
