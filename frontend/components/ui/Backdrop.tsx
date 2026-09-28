/**
 * Decorative page backdrop: two drifting aurora pools over a masked grid.
 * Purely presentational, so it is hidden from assistive tech and never
 * intercepts pointer events.
 */
export function Backdrop() {
  return (
    <div
      aria-hidden="true"
      className="grid-overlay pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="animate-in fade-in orb-drift absolute -top-40 -start-24 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,var(--canvas-glow-1),transparent_65%)] blur-2xl duration-[1400ms]" />
      <div className="animate-in fade-in orb-drift-slow absolute -top-24 end-0 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--canvas-glow-2),transparent_65%)] blur-2xl duration-[1400ms]" />
      <div className="absolute bottom-0 start-1/3 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--canvas-glow-1),transparent_70%)] opacity-60 blur-3xl" />
    </div>
  );
}
