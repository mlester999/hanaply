'use client';

import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, Html, Line } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';

function useSceneCapability() {
  const [state, setState] = useState({ reduced: true, lowPower: true });
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setState({
        reduced: query.matches,
        lowPower: window.innerWidth < 700 || (navigator.hardwareConcurrency ?? 8) <= 4,
      });
    };
    update();
    query.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      query.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return state;
}

function useVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!ref.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setVisible(entry.isIntersecting);
      },
      {
        rootMargin: '120px',
      },
    );
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, visible };
}

const clusters = [
  { label: 'Experience', color: '#3157e8', pos: [0, 1.9, 0] as [number, number, number] },
  { label: 'Skills', color: '#22c7a9', pos: [0, 1.15, 0] as [number, number, number] },
  { label: 'Projects', color: '#3157e8', pos: [0, 0.38, 0] as [number, number, number] },
  { label: 'Tools', color: '#22c7a9', pos: [0, -0.38, 0] as [number, number, number] },
  { label: 'Education', color: '#6c83c9', pos: [0, -1.15, 0] as [number, number, number] },
  { label: 'Preferences', color: '#ff7a59', pos: [0, -1.9, 0] as [number, number, number] },
];

function EvidenceGraph({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  const profile: [number, number, number] = [-2.7, 0, 0];
  const target: [number, number, number] = [2.7, 0, 0];
  return (
    <group>
      <ambientLight intensity={1.6} />
      <pointLight position={[0, 3, 5]} intensity={22} color="#7091ff" />
      {clusters.map((node) => (
        <group key={node.label}>
          <Line
            points={[profile, node.pos]}
            color={selected === node.label ? '#6f8cff' : '#344a83'}
            lineWidth={selected === node.label ? 2 : 1}
            transparent
            opacity={selected === node.label ? 0.95 : 0.45}
          />
          <Line
            points={[node.pos, target]}
            color={selected === node.label ? '#22c7a9' : '#26395f'}
            lineWidth={selected === node.label ? 2 : 1}
            transparent
            opacity={selected === node.label ? 0.9 : 0.32}
          />
          <mesh
            position={node.pos}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(node.label);
            }}
          >
            <boxGeometry args={[1.35, 0.42, selected === node.label ? 0.2 : 0.12]} />
            <meshStandardMaterial
              color={node.color}
              emissive={node.color}
              emissiveIntensity={selected === node.label ? 2.6 : 1}
            />
          </mesh>
          <Html position={[node.pos[0], node.pos[1], node.pos[2] + 0.16]} center distanceFactor={9}>
            <button
              className={`scene-label ${selected === node.label ? 'active' : ''}`}
              onClick={() => {
                onSelect(node.label);
              }}
            >
              {node.label}
            </button>
          </Html>
        </group>
      ))}
      <mesh position={profile}>
        <boxGeometry args={[1.5, 0.9, 0.18]} />
        <meshStandardMaterial color="#243d91" emissive="#3157e8" emissiveIntensity={1.4} />
      </mesh>
      <Html position={profile} center distanceFactor={8}>
        <span className="scene-core-label">
          Verified
          <br />
          career profile
        </span>
      </Html>
      <mesh position={target}>
        <boxGeometry args={[1.5, 1.05, 0.2]} />
        <meshStandardMaterial color="#164d52" emissive="#22c7a9" emissiveIntensity={1.4} />
      </mesh>
      <Html position={target} center distanceFactor={8}>
        <span className="scene-target-label">
          Sample role
          <br />
          <b>88 match</b>
        </span>
      </Html>
    </group>
  );
}

const clusterFacts: Record<string, string[]> = {
  Experience: ['3 years workflow operations', 'Client discovery and delivery'],
  Skills: ['TypeScript', 'API integration', 'Process analysis'],
  Projects: ['Job ingestion prototype', 'Support triage automation'],
  Tools: ['n8n', 'Supabase', 'OpenAI'],
  Education: ['Information systems coursework', 'Continuous technical learning'],
  Preferences: ['Remote or hybrid', 'Asia/Manila collaboration'],
};

export function CareerConstellationScene() {
  const { ref, visible } = useVisible<HTMLDivElement>();
  const { reduced, lowPower } = useSceneCapability();
  const [selected, setSelected] = useState('Skills');
  const [flat, setFlat] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const canRender = !reduced && !lowPower && !flat && visible && !webglUnavailable;
  return (
    <div ref={ref} className="constellation-experience">
      <div className="scene-toolbar">
        <span>Demonstration Data</span>
        <button
          type="button"
          onClick={() => {
            setFlat((value) => !value);
          }}
        >
          {flat ? 'Show depth view' : 'Use flat diagram'}
        </button>
      </div>
      <div
        className="constellation-canvas"
        aria-label="Career evidence map connecting a verified profile to a sample job"
      >
        {canRender ? (
          <Canvas
            camera={{ position: [0, 0, 7.5], fov: 42 }}
            dpr={[1, 1.4]}
            fallback={<FlatEvidenceMap selected={selected} onSelect={setSelected} />}
            gl={{ alpha: true, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => {
              gl.domElement.addEventListener(
                'webglcontextlost',
                () => {
                  setWebglUnavailable(true);
                },
                {
                  once: true,
                },
              );
            }}
          >
            <EvidenceGraph selected={selected} onSelect={setSelected} />
            <AdaptiveDpr />
          </Canvas>
        ) : (
          <FlatEvidenceMap selected={selected} onSelect={setSelected} />
        )}
      </div>
      <div className="cluster-detail" aria-live="polite">
        <span>Relevant cluster</span>
        <h3>{selected}</h3>
        <ul>
          {(clusterFacts[selected] ?? []).map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
        <p>
          <i /> Illuminated because this evidence supports the sample Automation Engineer role.
        </p>
      </div>
    </div>
  );
}

function FlatEvidenceMap({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flat-constellation">
      <div className="flat-core">
        Verified
        <br />
        career profile
      </div>
      <div className="flat-evidence-stack">
        {clusters.map((cluster) => (
          <button
            type="button"
            key={cluster.label}
            className={`flat-node ${selected === cluster.label ? 'active' : ''}`}
            onClick={() => {
              onSelect(cluster.label);
            }}
          >
            {cluster.label}
          </button>
        ))}
      </div>
      <div className="flat-target">
        Sample role<strong>88 match</strong>
      </div>
    </div>
  );
}
