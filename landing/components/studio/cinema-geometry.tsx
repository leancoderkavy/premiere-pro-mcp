"use client"

import { useEffect, useMemo, useRef } from "react"
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
  scale = 1
}: {
  shot: number
  position: [number, number, number]
  rotation: [number, number, number]
  scale?: number
}) {
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
    <group position={position} rotation={rotation} scale={scale}>
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

export function EditTimeline({ chapter }: { chapter: number }) {
  const playhead = useRef<Group>(null)
  useFrame(({ clock }, delta) => {
    if (!playhead.current) return
    const target = -3.7 + chapter * 3.3 + Math.sin(clock.elapsedTime * 0.23) * 0.6
    playhead.current.position.x += (target - playhead.current.position.x) * Math.min(delta * 2, 1)
  })
  return (
    <group position={[0, -1.8, 0.8]} rotation={[-0.62, -0.07, -0.015]}>
      <mesh>
        <boxGeometry args={[10.5, 1.82, 0.16]} />
        <meshStandardMaterial color="#14121f" metalness={0.75} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0.9, 0.1]}>
        <boxGeometry args={[10.5, 0.015, 0.02]} />
        <meshBasicMaterial color="#8e7bcc" />
      </mesh>
      <mesh position={[0, 0.69, 0.095]}>
        <planeGeometry args={[10.1, 0.16]} />
        <shaderMaterial
          vertexShader={surfaceVertex}
          fragmentShader={`varying vec2 vUv;void main(){float tick=floor(vUv.x*49.);if(fract(vUv.x*49.)>.05)discard;if(mod(tick,4.)>.5&&vUv.y>.375)discard;gl_FragColor=vec4(.55,.52,.62,1.);}`}
        />
      </mesh>
      {[0, 1, 2].map((row) => (
        <group key={row} position={[0, 0.32 - row * 0.45, 0.13]}>
          {Array.from({ length: row === 2 ? 4 : 6 }, (_, i) => {
            const width = row === 2 ? 2.4 : 1.5
            const x = row === 2 ? -3.78 + i * 2.53 : -4.2 + i * 1.68
            return (
              <mesh key={i} position={[x, 0, 0]}>
                <boxGeometry args={[width, 0.31, 0.07]} />
                <meshStandardMaterial
                  color={row === 2 ? "#426d70" : row === 1 ? "#635186" : "#9980db"}
                  emissive={row === 2 ? "#29585a" : "#65518e"}
                  emissiveIntensity={0.2}
                  metalness={0.25}
                  roughness={0.5}
                />
              </mesh>
            )
          })}
          {row === 2 && (
            <mesh position={[0, 0, 0.045]}>
              <planeGeometry args={[9.8, 0.27]} />
              <shaderMaterial
                vertexShader={surfaceVertex}
                fragmentShader={`varying vec2 vUv;void main(){float i=floor(vUv.x*100.);float amplitude=.13+abs(sin(i*2.31)*cos(i*.43))*.82;if(fract(vUv.x*100.)>.19||abs(vUv.y-.5)*2.>amplitude)discard;gl_FragColor=vec4(.576,.753,.737,1.);}`}
              />
            </mesh>
          )}
        </group>
      ))}
      <group ref={playhead} position={[-3.7, 0, 0.24]}>
        <mesh>
          <boxGeometry args={[0.018, 1.68, 0.015]} />
          <meshBasicMaterial color="#f6d3a6" />
        </mesh>
        <mesh position={[0, 0.8, 0]} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.09, 0.15, 3]} />
          <meshBasicMaterial color="#f6d3a6" />
        </mesh>
      </group>
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
