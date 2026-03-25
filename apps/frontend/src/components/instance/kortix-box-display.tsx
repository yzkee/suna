'use client';

import { useRef, useEffect, useState, Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useTheme } from 'next-themes';

/**
 * Static Kortix Box 3D display — no scroll, LED always on, gentle idle rotation.
 * Designed for the instances page left panel.
 */

function useGlowTexture() {
  return useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(74, 222, 128, 0.8)');
    gradient.addColorStop(0.5, 'rgba(74, 222, 128, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
}

function KortixBoxModel({ isDark }: { isDark: boolean }) {
  const groupRef = useRef<THREE.Group>(null!);
  const innerRef = useRef<THREE.Group>(null!);
  const { scene } = useGLTF('/models/kortix_box_2.glb');
  const [ready, setReady] = useState(false);
  const glowTexture = useGlowTexture();
  const materialsApplied = useRef<'dark' | 'light' | null>(null);

  useEffect(() => {
    if (!scene) return;

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scaleFactor = 2.5 / Math.max(size.x, size.y, size.z);

    if (innerRef.current) {
      innerRef.current.scale.setScalar(scaleFactor);
      const center = new THREE.Vector3();
      box.getCenter(center);
      innerRef.current.position.set(
        -center.x * scaleFactor,
        -center.y * scaleFactor,
        -center.z * scaleFactor,
      );
    }

    setReady(true);
  }, [scene]);

  // Apply materials based on theme
  useEffect(() => {
    if (!scene || !ready) return;
    const mode = isDark ? 'dark' : 'light';
    if (materialsApplied.current === mode) return;
    materialsApplied.current = mode;

    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        child.castShadow = true;
        child.receiveShadow = true;

        const isLogo = child.name === 'kortix_logo'
          || child.parent?.name === 'kortix_logo'
          || child.name === 'TEXTS'
          || child.parent?.name === 'TEXTS';
        if (isLogo) {
          const mat = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            emissive: '#ffffff',
            emissiveIntensity: isDark ? 6.0 : 3.0,
            toneMapped: false,
            roughness: 0.2,
            metalness: 0,
          });
          child.material = mat;
        } else if (child.name.toLowerCase().includes('led') || child.parent?.name.toLowerCase().includes('led')) {
          const ledMat = new THREE.MeshStandardMaterial({
            color: '#000000',
            emissive: '#4ade80',
            emissiveIntensity: 4.0,
            toneMapped: false,
            transparent: true,
            opacity: 1,
            roughness: 0.2,
            metalness: 0,
          });
          child.material = ledMat;

          // Point Light for LED glow
          let light = child.getObjectByName('led_real_light') as THREE.PointLight;
          if (!light) {
            light = new THREE.PointLight('#4ade80', 2.5, 0.5);
            light.name = 'led_real_light';
            light.position.set(0, 0, 0.02);
            child.add(light);
          } else {
            light.intensity = 2.5;
          }

          // Glow sprite
          if (glowTexture) {
            let sprite = child.getObjectByName('led_glow_sprite') as THREE.Sprite;
            if (!sprite) {
              const spriteMat = new THREE.SpriteMaterial({
                map: glowTexture,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
              });
              sprite = new THREE.Sprite(spriteMat);
              sprite.name = 'led_glow_sprite';
              sprite.scale.set(0.15, 0.15, 1);
              sprite.position.set(0, 0, 0.015);
              child.add(sprite);
            } else {
              sprite.material.opacity = 1.0;
            }
          }
        } else {
          const original = child.material as THREE.MeshStandardMaterial;
          const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(isDark ? '#050505' : '#d8d8d8'),
            metalness: 0,
            roughness: isDark ? 0.85 : 0.8,
            clearcoat: 0,
            reflectivity: 0,
            envMapIntensity: isDark ? 0.15 : 0.3,
          });

          if (original.normalMap) {
            mat.normalMap = original.normalMap;
            mat.normalScale = original.normalScale.clone();
          }
          if (original.aoMap) {
            mat.aoMap = original.aoMap;
            mat.aoMapIntensity = original.aoMapIntensity;
          }
          child.material = mat;
        }
      }
    });
  }, [scene, ready, isDark, glowTexture]);

  return (
    <group ref={groupRef} scale={1.1} visible={ready} position={[0, -0.3, 0]} rotation={[0.3, -0.4, 0]}>
      <group ref={innerRef}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

function SceneLights({ isDark }: { isDark: boolean }) {
  return (
    <>
      <ambientLight intensity={isDark ? 0.05 : 0.3} color={isDark ? '#1a1a2e' : '#f0f0ff'} />
      {/* Key light */}
      <spotLight
        position={[5, 8, 5]}
        intensity={isDark ? 1.5 : 1.5}
        angle={0.5}
        penumbra={1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
        color={isDark ? '#c0c0ff' : '#ffffff'}
      />
      {/* Rim light */}
      <spotLight
        position={[-5, 5, -5]}
        intensity={isDark ? 3 : 2}
        angle={0.5}
        penumbra={1}
        color={isDark ? '#ffecd0' : '#d0d0ff'}
      />
      {/* Fill */}
      <pointLight
        position={[0, -2, 3]}
        intensity={isDark ? 0.2 : 0.15}
        color={isDark ? '#4a4a6a' : '#9999bb'}
        distance={10}
      />
    </>
  );
}

export default function KortixBoxDisplay({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = !mounted || resolvedTheme === 'dark';

  return (
    <div className={className}>
      <Canvas
        shadows
        camera={{ position: [0, 0.5, 5.5], fov: 32 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: isDark ? 0.8 : 1.0,
        }}
        dpr={[1.5, 2]}
        style={{ background: 'transparent' }}
      >
        <SceneLights isDark={isDark} />
        <Suspense fallback={null}>
          <KortixBoxModel isDark={isDark} />
          <ContactShadows
            position={[0, -1.5, 0]}
            opacity={isDark ? 0.4 : 0.2}
            scale={10}
            blur={2.5}
            far={4}
            color="#000000"
          />
          <Environment preset="city" background={false} blur={1} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload('/models/kortix_box_2.glb');
