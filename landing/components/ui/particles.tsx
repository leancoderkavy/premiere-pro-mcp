"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface ParticlesProps {
  className?: string
  quantity?: number
  staticity?: number
  ease?: number
  size?: number
  refresh?: boolean
  color?: string
  vx?: number
  vy?: number
}

function hexToRgb(hex: string): [number, number, number] {
  hex = hex.replace("#", "")
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("")
  const n = parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function Particles({
  className,
  quantity = 100,
  staticity = 50,
  ease = 50,
  size = 0.4,
  refresh = false,
  color = "#ffffff",
  vx = 0,
  vy = 0,
}: ParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const circles = useRef<Circle[]>([])
  const mouse = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const canvasSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1
  const rafID = useRef<number | null>(null)

  interface Circle {
    x: number; y: number; translateX: number; translateY: number
    size: number; alpha: number; targetAlpha: number; dx: number; dy: number
    magnetism: number
  }

  const rgb = hexToRgb(color)

  const circleParams = useCallback((): Circle => {
    const x = Math.floor(Math.random() * canvasSize.current.w)
    const y = Math.floor(Math.random() * canvasSize.current.h)
    const size_ = Math.floor(Math.random() * 2) + size
    const alpha = 0
    const targetAlpha = parseFloat((Math.random() * 0.6 + 0.1).toFixed(1))
    const dx = (Math.random() - 0.5) * 0.1
    const dy = (Math.random() - 0.5) * 0.1
    const magnetism = 0.1 + Math.random() * 4
    return { x, y, translateX: 0, translateY: 0, size: size_, alpha, targetAlpha, dx, dy, magnetism }
  }, [size])

  const drawCircle = useCallback((circle: Circle, update = false) => {
    if (!context.current) return
    const { x, y, translateX, translateY, size: s, alpha } = circle
    context.current.translate(translateX, translateY)
    context.current.beginPath()
    context.current.arc(x, y, s, 0, 2 * Math.PI)
    context.current.fillStyle = `rgba(${rgb.join(", ")}, ${alpha})`
    context.current.fill()
    context.current.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (!update) circles.current.push(circle)
  }, [dpr, rgb])

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = canvasContainerRef.current
    if (!canvas || !container) return
    circles.current = []
    canvasSize.current = { w: container.offsetWidth, h: container.offsetHeight }
    canvas.width = canvasSize.current.w * dpr
    canvas.height = canvasSize.current.h * dpr
    canvas.style.width = `${canvasSize.current.w}px`
    canvas.style.height = `${canvasSize.current.h}px`
    context.current = canvas.getContext("2d")
    if (context.current) context.current.scale(dpr, dpr)
    for (let i = 0; i < quantity; i++) drawCircle(circleParams())
  }, [quantity, dpr, drawCircle, circleParams])

  const remapValue = (v: number, s1: number, e1: number, s2: number, e2: number) =>
    ((v - s1) / (e1 - s1)) * (e2 - s2) + s2

  const animate = useCallback(() => {
    if (!context.current) return
    context.current.clearRect(0, 0, canvasSize.current.w, canvasSize.current.h)
    circles.current.forEach((circle, i) => {
      const edge = [
        circle.x + circle.translateX - circle.size,
        canvasSize.current.w - circle.x - circle.translateX - circle.size,
        circle.y + circle.translateY - circle.size,
        canvasSize.current.h - circle.y - circle.translateY - circle.size,
      ]
      const closest = edge.reduce((a, b) => Math.min(a, b))
      const remap = parseFloat(remapValue(closest, 0, 20, 0, 1).toFixed(2))
      if (remap > 1) {
        circle.alpha += 0.02
        if (circle.alpha > circle.targetAlpha) circle.alpha = circle.targetAlpha
      } else {
        circle.alpha = circle.targetAlpha * remap
      }
      circle.x += circle.dx + vx
      circle.y += circle.dy + vy
      circle.translateX += (mouse.current.x / (staticity / circle.magnetism) - circle.translateX) / ease
      circle.translateY += (mouse.current.y / (staticity / circle.magnetism) - circle.translateY) / ease
      drawCircle(circle, true)
      if (
        circle.x < -circle.size || circle.x > canvasSize.current.w + circle.size ||
        circle.y < -circle.size || circle.y > canvasSize.current.h + circle.size
      ) {
        circles.current.splice(i, 1)
        drawCircle(circleParams())
      }
    })
    rafID.current = window.requestAnimationFrame(animate)
  }, [vx, vy, staticity, ease, drawCircle, circleParams])

  useEffect(() => {
    initCanvas()
    rafID.current = window.requestAnimationFrame(animate)
    return () => { if (rafID.current) cancelAnimationFrame(rafID.current) }
  }, [initCanvas, animate])

  useEffect(() => { initCanvas() }, [refresh, initCanvas])

  useEffect(() => {
    const handleResize = () => initCanvas()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [initCanvas])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  return (
    <div ref={canvasContainerRef} className={cn("pointer-events-none", className)} aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  )
}
