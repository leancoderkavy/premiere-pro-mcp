"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useFrame, useLoader } from "@react-three/fiber"
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  SRGBColorSpace,
  TextureLoader
} from "three"
import { cinemaAtlas } from "./cinema-content"

const surfaceVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`

export function FilmFrame({
  shot,
  position,
  rotation,
  scale = 1,
  onSelect
}: {
  shot: number
  position: [number, number, number]
  rotation: [number, number, number]
  scale?: number
  onSelect: (shot: number) => void
}) {
  const group = useRef<Group>(null)
  const [initial] = useState({ position, rotation, scale })
  useFrame(({ clock }, delta) => {
    const mesh = group.current
    if (!mesh) return
    const ease = Math.min(1, delta * 4)
    mesh.position.x += (position[0] - mesh.position.x) * ease
    mesh.position.y +=
      (position[1] + Math.sin(clock.elapsedTime * 0.45 + shot * 2) * 0.035 - mesh.position.y) * ease
    mesh.position.z += (position[2] - mesh.position.z) * ease
    mesh.rotation.x += (rotation[0] - mesh.rotation.x) * ease
    mesh.rotation.y += (rotation[1] - mesh.rotation.y) * ease
    mesh.rotation.z += (rotation[2] - mesh.rotation.z) * ease
    mesh.scale.setScalar(mesh.scale.x + (scale - mesh.scale.x) * ease)
  })
  const source = useLoader(TextureLoader, cinemaAtlas)
  const texture = useMemo(() => {
    const copy = source.clone()
    copy.colorSpace = SRGBColorSpace
    copy.repeat.set(0.55, 0.324)
    copy.offset.set(shot === 0 ? 0.08 : 0.22, (2 - shot) / 3 + 0.005)
    copy.needsUpdate = true
    return copy
  }, [source, shot])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <group
      ref={group}
      position={initial.position}
      rotation={initial.rotation}
      scale={initial.scale}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(shot)
      }}
    >
      <mesh>
        <boxGeometry args={[6.2, 2.9, 0.1]} />
        <meshStandardMaterial color="#181820" metalness={0.8} roughness={0.29} />
      </mesh>
      <mesh position={[0, 0, 0.061]}>
        <planeGeometry args={[6.08, 2.47]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[0, side * 1.448, 0.01]}>
            <boxGeometry args={[6.22, 0.014, 0.12]} />
            <meshBasicMaterial
              color={side === 1 ? "#bbb2e2" : "#7261bf"}
              transparent
              opacity={0.65}
            />
          </mesh>
          <mesh position={[0, side * 1.34, 0.063]}>
            <planeGeometry args={[6.08, 0.055]} />
            <shaderMaterial
              vertexShader={surfaceVertex}
              fragmentShader={`varying vec2 vUv;void main(){if(fract(vUv.x*26.)>.49)discard;gl_FragColor=vec4(.4,.376,.431,1.);}`}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export function FilmRibbon() {
  const geometry = useMemo(() => {
    const vertices: number[] = [],
      uv: number[] = [],
      indices: number[] = []
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      const x = (t - 0.5) * 15,
        y = Math.sin(t * Math.PI * 2) * 0.6 - 1.1,
        z = -2.2 + Math.cos(t * Math.PI * 2) * 1.5
      vertices.push(x, y - 0.22, z, x, y + 0.22, z)
      uv.push(t, 0, t, 1)
      if (i < 100) {
        const a = i * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const shape = new BufferGeometry()
    shape.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3))
    shape.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2))
    shape.setIndex(indices)
    shape.computeVertexNormals()
    return shape
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} rotation={[0, 0, -0.05]}>
      <shaderMaterial
        side={DoubleSide}
        transparent
        depthWrite={false}
        vertexShader={`varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`}
        fragmentShader={`varying vec2 vUv; void main(){float edge=step(.7,abs(vUv.y-.5)*2.);float hole=step(.3,fract(vUv.x*75.))*step(fract(vUv.x*75.),.7)*edge; if(hole>.5)discard; float line=step(.98,fract(vUv.x*18.)); vec3 color=mix(vec3(.16,.12,.25),vec3(.48,.4,.65),edge+line); gl_FragColor=vec4(color,.65);}`}
      />
    </mesh>
  )
}
