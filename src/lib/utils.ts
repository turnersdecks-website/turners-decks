import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { cva, type VariantProps } from "class-variance-authority";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shared button styles, used by both .astro pages and React islands. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-base font-medium cursor-pointer transition-[opacity,background-color,color] hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Solid navy pill, for light sections.
        default: "bg-primary text-primary-foreground",
        cta: "bg-primary text-primary-foreground",
        // Outline navy pill, for light sections.
        outline: "border border-primary text-primary hover:bg-primary hover:text-primary-foreground hover:opacity-100",
        ghost: "text-primary hover:bg-accent hover:opacity-100",
        // Solid white and outline white pills, for navy sections.
        light: "bg-white text-primary",
        "outline-light": "border border-white text-white hover:bg-white hover:text-primary hover:opacity-100",
      },
      size: {
        default: "min-h-11 px-5 py-2.5 text-[0.9375rem]",
        sm: "min-h-11 px-4 py-2 text-sm",
        lg: "min-h-14 px-6 py-3.5",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];
