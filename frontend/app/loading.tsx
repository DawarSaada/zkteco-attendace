import { Fingerprint } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="animate-in fade-in relative grid h-14 w-14 place-items-center rounded-2xl border border-brand-line bg-brand-soft text-brand duration-300">
        <Fingerprint size={26} aria-hidden="true" />
        <span className="absolute inset-0 animate-ping rounded-2xl border border-brand-line opacity-40" />
      </div>
      <div className="h-1 w-32 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full w-1/2 animate-pulse rounded-full bg-brand" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
