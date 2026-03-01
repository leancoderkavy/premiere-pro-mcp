import React, { ComponentPropsWithoutRef, CSSProperties } from "react"
import { cn } from "@/lib/utils"

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<"button"> {
  shimmerColor?: string
  shimmerSize?: string
  borderRadius?: string
  shimmerDuration?: string
  background?: string
  className?: string
  children?: React.ReactNode
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = "#ffffff",
      shimmerSize = "0.05em",
      shimmerDuration = "3s",
      borderRadius = "100px",
      background = "rgba(0, 0, 0, 1)",
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        style={{
          "--spread": "90deg",
          "--shimmer-color": shimmerColor,
          "--radius": borderRadius,
          "--speed": shimmerDuration,
          "--cut": shimmerSize,
          "--bg": background,
        } as CSSProperties}
        className={cn(
          "group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden px-6 py-3 whitespace-nowrap text-white border border-white/10",
          "transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px",
          "[border-radius:var(--radius)] [background:var(--bg)]",
          className
        )}
        ref={ref}
        {...props}
      >
        <div className={cn("-z-30 blur-[2px]", "[container-type:size] absolute inset-0 overflow-visible")}>
          <div className="absolute inset-0 [aspect-ratio:1] h-[100cqh] animate-[shimmer-slide_var(--speed)_ease-in-out_infinite_alternate]">
            <div className="absolute -inset-full w-auto rotate-0 animate-[spin_var(--speed)_linear_infinite] [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
          </div>
        </div>
        {children}
        <div className={cn(
          "absolute inset-0 size-full rounded-2xl px-4 py-1.5 text-sm font-medium shadow-[inset_0_-8px_10px_#ffffff1f]",
          "transform-gpu transition-all duration-300 ease-in-out",
          "group-hover:shadow-[inset_0_-6px_10px_#ffffff3f]",
          "group-active:shadow-[inset_0_-10px_10px_#ffffff3f]"
        )} />
        <div className="absolute [inset:var(--cut)] -z-20 [border-radius:var(--radius)] [background:var(--bg)]" />
      </button>
    )
  }
)
ShimmerButton.displayName = "ShimmerButton"
