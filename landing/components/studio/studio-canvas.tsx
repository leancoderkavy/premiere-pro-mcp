"use client"

import { Suspense, useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber"
import { Group, SRGBColorSpace, TextureLoader } from "three"

function FilmAssembly({ onReady }: { onReady: (ready: boolean) => void }) {
  const assembly = useRef<Group>(null)
  const renderedFrames = useRef(0)
  const source = useLoader(TextureLoader, "/marketing/cinematic-portal.webp")
  const texture = useMemo(() => {
    const copy = source.clone()
    copy.colorSpace = SRGBColorSpace
    copy.needsUpdate = true
    return copy
  }, [source])
  useEffect(() => {
    renderedFrames.current = 0
    return () => {
      onReady(false)
      texture.dispose()
    }
  }, [onReady, texture])

  useFrame(({ clock, pointer, gl }, delta) => {
    if (gl.getContext().isContextLost()) return
    // Announce this canvas only after a frame has rendered. A previous canvas's
    // ready state must not hide the fallback while a replacement initializes.
    if (++renderedFrames.current === 2) onReady(true)
    if (!assembly.current) return
    const ease = Math.min(delta * 3, 1)
    assembly.current.rotation.x +=
      (0.12 - pointer.y * 0.06 - assembly.current.rotation.x) * ease
    assembly.current.rotation.y +=
      (-0.18 + pointer.x * 0.12 - assembly.current.rotation.y) * ease
    assembly.current.position.y = Math.sin(clock.elapsedTime * 0.65) * 0.065
  })

  return (
    <group ref={assembly} rotation={[0.12, -0.18, -0.035]}>
      <mesh position={[0, 0.63, 0]}>
        <boxGeometry args={[6.86, 4.04, 0.14]} />
        <meshStandardMaterial
          color="#566052"
          metalness={0.85}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0, 0.63, 0.078]}>
        <planeGeometry args={[6.74, 3.92]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <group position={[0.35, -1.9, 0.7]} rotation={[-0.12, 0, 0]}>
        <mesh position={[0, 0, -0.06]}>
          <boxGeometry args={[6.3, 1.68, 0.14]} />
          <meshStandardMaterial
            color="#1d2920"
            metalness={0.65}
            roughness={0.4}
          />
        </mesh>
        {[0, 1, 2, 3].map((row) => (
          <group key={row} position={[0, 0.54 - row * 0.36, 0.035]}>
            {[0, 1, 2, 3].map((col) => (
              <mesh
                key={col}
                position={[-2.26 + col * 1.48 + (row % 2) * 0.12, 0, 0]}
              >
                <boxGeometry args={[1.32, 0.22, 0.04]} />
                <meshStandardMaterial
                  color={
                    row < 2 ? (col % 2 ? "#9cae87" : "#d2ff5a") : "#487b66"
                  }
                  roughness={0.6}
                  metalness={0.15}
                />
              </mesh>
            ))}
          </group>
        ))}
        <mesh position={[0.8, 0, 0.14]}>
          <boxGeometry args={[0.022, 1.48, 0.025]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
    </group>
  )
}

function ContextRecovery({ onError }: { onError: () => void }) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    gl.domElement.addEventListener("webglcontextlost", onError)
    return () => gl.domElement.removeEventListener("webglcontextlost", onError)
  }, [gl, onError])
  return null
}

export default function StudioCanvas({
  onReady,
  onError
}: {
  onReady: (ready: boolean) => void
  onError: () => void
}) {
  useEffect(() => () => onReady(false), [onReady])
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 10], zoom: 76 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      aria-hidden="true"
    >
      <color attach="background" args={["#0a0c0b"]} />
      <ContextRecovery onError={onError} />
      <ambientLight intensity={2} />
      <directionalLight position={[3, 5, 7]} intensity={4} color="#e5f3d4" />
      <pointLight position={[-5, -1, 4]} intensity={14} color="#d2ff5a" />
      <Suspense fallback={null}>
        <FilmAssembly onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}
