import type { ComponentType, SVGProps } from 'react';

/**
 * Structural type for a lucide-react icon.
 *
 * Declared structurally rather than importing `LucideIcon` so the primitives
 * keep working across lucide-react major versions.
 */
export type IconComponent = ComponentType<
  SVGProps<SVGSVGElement> & {
    size?: number | string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
  }
>;
