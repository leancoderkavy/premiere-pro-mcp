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
      (0.015 - pointer.y * 0.025 - assembly.current.rotation.x) * ease
    assembly.current.rotation.y +=
      (-0.025 + pointer.x * 0.035 - assembly.current.rotation.y) * ease
    assembly.current.position.y = Math.sin(clock.elapsedTime * 0.65) * 0.035
  })

  return (
    <group ref={assembly} rotation={[0.015, -0.025, 0]}>
      <mesh>
        <planeGeometry args={[8, 4.57]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
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
    camera.zoom = Math.min(width / 8.2, height / 4.8)
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
      <Suspense fallback={null}>
        <FilmAssembly onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}
