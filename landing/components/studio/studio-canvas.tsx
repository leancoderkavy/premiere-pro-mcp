"use client"

import { Suspense, useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber"
import { Group, OrthographicCamera, SRGBColorSpace, TextureLoader } from "three"
import { studioArtwork } from "@/lib/studio-artwork"

function FilmAssembly({ onReady }: { onReady: (ready: boolean) => void }) {
  const assembly = useRef<Group>(null)
  const renderedFrames = useRef(0)
  const source = useLoader(TextureLoader, studioArtwork.sequence.src)
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
      (0.06 - pointer.y * 0.03 - assembly.current.rotation.x) * ease
    assembly.current.rotation.y +=
      (-0.08 + pointer.x * 0.07 - assembly.current.rotation.y) * ease
    assembly.current.position.y = Math.sin(clock.elapsedTime * 0.65) * 0.035
  })

  return (
    <group ref={assembly} rotation={[0.06, -0.08, 0]}>
      <mesh position={[0, 0.63, 0]}>
        <boxGeometry args={[7.86, 4.5, 0.14]} />
        <meshStandardMaterial
          color="#64647c"
          metalness={0.85}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0, 0.63, 0.078]}>
        <planeGeometry args={[7.72, 4.41]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <group position={[0.2, -2.1, 0.7]} rotation={[-0.06, 0, 0]}>
        <mesh position={[0, 0, -0.06]}>
          <boxGeometry args={[7.3, 1.68, 0.14]} />
          <meshStandardMaterial
            color="#1b1b32"
            metalness={0.65}
            roughness={0.4}
          />
        </mesh>
        {[0, 1, 2, 3].map((row) => (
          <group key={row} position={[0, 0.54 - row * 0.36, 0.035]}>
            {[0, 1, 2, 3].map((col) => (
              <mesh
                key={col}
                position={[-2.66 + col * 1.75 + (row % 2) * 0.1, 0, 0]}
              >
                <boxGeometry args={[1.58, 0.22, 0.04]} />
                <meshStandardMaterial
                  color={
                    row < 2 ? (col % 2 ? "#b5a4e8" : "#9999ff") : "#6658a0"
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

function SceneFraming() {
  const get = useThree((state) => state.get)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  useEffect(() => {
    const { camera } = get()
    if (!(camera instanceof OrthographicCamera)) return
    camera.zoom = Math.min(width / 8.5, height / 6)
    camera.updateProjectionMatrix()
  }, [get, width, height])
  return null
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
      <color attach="background" args={["#050507"]} />
      <SceneFraming />
      <ContextRecovery onError={onError} />
      <ambientLight intensity={2} />
      <directionalLight position={[3, 5, 7]} intensity={4} color="#ececff" />
      <pointLight position={[-5, -1, 4]} intensity={14} color="#9999ff" />
      <Suspense fallback={null}>
        <FilmAssembly onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}
