import type { SVGProps } from "react";

// A simple ultrasound transducer (probe): a rounded handle that tapers to a
// flat scanning head, with arc-wave lines emanating from the tip. Drawn with
// currentColor so it inherits Tailwind text-color utilities exactly like a
// Lucide icon, and sized via the standard 24x24 viewBox so w-5/h-5 etc. work.
export function UltrasoundProbeIcon({
  className,
  strokeWidth = 2,
  ...props
}: SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* Handle: rounded rectangular body */}
      <path d="M9 2.5h6a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-.44 1.06l-1.06 1.06a1.5 1.5 0 0 0-.44 1.06V17H8.44v-1.26a1.5 1.5 0 0 0-.44-1.06l-1.06-1.06A1.5 1.5 0 0 1 7.5 12.5V4A1.5 1.5 0 0 1 9 2.5Z" />
      {/* Scanning head face */}
      <path d="M8.44 17h7.12" />
      {/* Arc waves from the tip */}
      <path d="M9.5 20a3.5 3.5 0 0 1 5 0" />
      <path d="M11 22a1.5 1.5 0 0 1 2 0" />
    </svg>
  );
}

export default UltrasoundProbeIcon;
