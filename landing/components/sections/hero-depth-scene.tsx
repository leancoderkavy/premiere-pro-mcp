"use client"

import { useRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import type { Group, Mesh } from "three"

const clips = [
  { position: [-3.6, 1.15, -1.1], scale: [2.1, 0.34, 0.1], color: "#8b7cff" },
  { position: [-1.25, 1.15, -0.75], scale: [1.25, 0.34, 0.1], color: "#a99cff" },
  { position: [0.25, 1.15, -0.4], scale: [1.45, 0.34, 0.1], color: "#ef76b9" },
  { position: [2.05, 1.15, -0.05], scale: [1.75, 0.34, 0.1], color: "#8b7cff" },
  { position: [-3.05, 0.25, -0.65], scale: [2.75, 0.34, 0.1], color: "#6d5dd3" },
  { position: [0.05, 0.25, -0.3], scale: [1.8, 0.34, 0.1], color: "#ef76b9" },
  { position: [2.25, 0.25, 0.05], scale: [2.1, 0.34, 0.1], color: "#806fdc" },
  { position: [-3.7, -0.65, -0.2], scale: [1.9, 0.28, 0.1], color: "#2da886" },
  { position: [-1.5, -0.65, 0.15], scale: [1.65, 0.28, 0.1], color: "#249879" },
  { position: [0.45, -0.65, 0.5], scale: [1.95, 0.28, 0.1], color: "#2da886" },
  { position: [2.7, -0.65, 0.85], scale: [1.85, 0.28, 0.1], color: "#249879" },
] as const

function SequenceScene() {
  const group = useRef<Group>(null)
  const playhead = useRef<Mesh>(null)

  useFrame(({ clock, pointer }, delta) => {
    if (group.current) {
      const targetX = -0.12 + pointer.y * 0.05
      const targetY = -0.18 + pointer.x * 0.09
      group.current.rotation.x += (targetX - group.current.rotation.x) * Math.min(1, delta * 2.2)
      group.current.rotation.y += (targetY - group.current.rotation.y) * Math.min(1, delta * 2.2)
      group.current.position.y = Math.sin(clock.elapsedTime * 0.35) * 0.08
    }

    if (playhead.current) {
      playhead.current.position.x = -4.8 + ((clock.elapsedTime * 0.62) % 1) * 9.6
    }
  })

  return (
    <>
      <fog attach="fog" args={["#030304", 7, 14]} />
      <group ref={group} position={[0.7, -0.45, -1.4]} rotation={[-0.12, -0.18, 0]}>
        {[-1.35, -0.45, 0.45].map((y) => (
          <mesh key={y} position={[0, y, -0.35]}>
            <boxGeometry args={[10.5, 0.015, 0.015]} />
            <meshBasicMaterial color="#4b455f" transparent opacity={0.35} />
          </mesh>
        ))}

        {clips.map((clip, index) => (
          <mesh key={index} position={clip.position} scale={clip.scale}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial
              color={clip.color}
              emissive={clip.color}
              emissiveIntensity={0.28}
              metalness={0.15}
              roughness={0.45}
              transparent
              opacity={0.82}
            />
          </mesh>
        ))}

        <mesh ref={playhead} position={[-4.8, -0.1, 1.05]}>
          <boxGeometry args={[0.025, 3.8, 0.025]} />
          <meshBasicMaterial color="#f7d7ef" transparent opacity={0.85} />
        </mesh>

        <mesh position={[0, -1.6, -0.55]}>
          <planeGeometry args={[10.5, 0.8]} />
          <meshBasicMaterial color="#08070d" transparent opacity={0.7} />
        </mesh>
      </group>

      <ambientLight intensity={0.7} />
      <pointLight position={[-4, 4, 5]} color="#9a86ff" intensity={32} distance={13} />
      <pointLight position={[5, -2, 4]} color="#ef76b9" intensity={20} distance={12} />
    </>
  )
}

export function HeroDepthScene() {
  return (
    <div className="hero-depth-scene absolute inset-0" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 8], fov: 40 }}
        gl={{ alpha: true, antialias: false, powerPreference: "high-performance" }}
      >
        <SequenceScene />
      </Canvas>
    </div>
  )
}
