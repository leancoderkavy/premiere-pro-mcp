"use client"

import { Suspense, useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Group, PerspectiveCamera } from "three"
import { EditTimeline, FilmFrame, FilmRibbon } from "./cinema-geometry"

function Atmosphere() {
  const dust = useMemo(
    () =>
      new Float32Array(
        Array.from(
          { length: 90 * 3 },
          (_, i) => Math.sin(i * 127.1 + 43.7) * (i % 3 === 0 ? 8 : i % 3 === 1 ? 3.5 : 4)
        )
      ),
    []
  )
  const motes = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (motes.current) motes.current.rotation.z = Math.sin(clock.elapsedTime * 0.045) * 0.07
  })
  return (
    <>
      <group ref={motes}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dust, 3]} />
          </bufferGeometry>
          <pointsMaterial
            color="#c9bdc9"
            size={0.015}
            transparent
            opacity={0.38}
            sizeAttenuation
            depthWrite={false}
          />
        </points>
      </group>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 3, 0.6, -3.8]} rotation={[0, 0, side * -0.5]}>
          <planeGeometry args={[5, 8]} />
          <shaderMaterial
            transparent
            depthWrite={false}
            vertexShader={`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`}
            fragmentShader={`varying vec2 vUv;void main(){float beam=pow(max(0.,1.-abs(vUv.x-.5)*2.),3.)*sin(vUv.y*3.14159);gl_FragColor=vec4(.57,.46,.8,beam*.12);}`}
          />
        </mesh>
      ))}
    </>
  )
}

function FilmAssembly({
  onReady,
  chapter
}: {
  onReady: (ready: boolean) => void
  chapter: number
}) {
  const assembly = useRef<Group>(null)
  const renderedFrames = useRef(0)
  useEffect(() => {
    renderedFrames.current = 0
    return () => onReady(false)
  }, [onReady])
  useFrame(({ clock, pointer, gl, camera }, delta) => {
    if (gl.getContext().isContextLost()) return
    if (++renderedFrames.current === 2) onReady(true)
    const ease = Math.min(delta * 2, 1)
    if (assembly.current) {
      assembly.current.rotation.y +=
        (pointer.x * 0.065 +
          Math.sin(clock.elapsedTime * 0.12) * 0.025 -
          assembly.current.rotation.y) *
        ease
      assembly.current.position.y = Math.sin(clock.elapsedTime * 0.32) * 0.035
    }
    camera.position.x += (pointer.x * 0.24 - camera.position.x) * ease
    camera.position.y += (0.65 + pointer.y * 0.12 - camera.position.y) * ease
    camera.lookAt(0, -0.2, 0)
  })
  return (
    <>
      <Atmosphere />
      <group ref={assembly}>
        <FilmRibbon />
        <FilmFrame
          shot={(chapter + 2) % 3}
          position={[-4.05, 0.4, -1.65]}
          rotation={[0.06, 0.35, -0.075]}
          scale={0.7}
        />
        <FilmFrame
          shot={(chapter + 1) % 3}
          position={[4.15, 0.8, -2]}
          rotation={[-0.03, -0.36, 0.07]}
          scale={0.7}
        />
        <FilmFrame shot={chapter} position={[0, 0.75, 0.35]} rotation={[0.025, -0.03, -0.015]} />
        <EditTimeline chapter={chapter} />
      </group>
      <ambientLight intensity={1.4} />
      <pointLight position={[-4, 4, 5]} color="#aaa1ff" intensity={55} distance={15} />
      <pointLight position={[5, -1, 3]} color="#9c85ff" intensity={35} distance={12} />
      <pointLight position={[0, 3, 1]} color="#f2c69e" intensity={15} distance={8} />
    </>
  )
}

function SceneFraming() {
  const get = useThree((state) => state.get)
  const size = useThree((state) => state.size)
  useEffect(() => {
    const { camera } = get()
    if (!(camera instanceof PerspectiveCamera)) return
    camera.position.z = Math.max(
      8.2,
      7.1 / (Math.tan((21 * Math.PI) / 180) * (size.width / size.height))
    )
    camera.updateProjectionMatrix()
  }, [get, size.width, size.height])
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
  onError,
  chapter
}: {
  onReady: (ready: boolean) => void
  onError: () => void
  chapter: number
}) {
  useEffect(() => () => onReady(false), [onReady])
  return (
    <Canvas
      camera={{ position: [0, 0.65, 8.2], fov: 42 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      aria-hidden="true"
    >
      <SceneFraming />
      <ContextRecovery onError={onError} />
      <Suspense fallback={null}>
        <FilmAssembly onReady={onReady} chapter={chapter} />
      </Suspense>
    </Canvas>
  )
}
