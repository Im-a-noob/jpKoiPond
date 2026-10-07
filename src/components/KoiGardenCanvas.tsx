import React, { useEffect, useRef } from 'react';
import { createGardenEngine } from '../engine/GardenEngine';
import { renderer } from '../engine/subsystems/lighting';
import { CameraMode, GardenHUDStats, KoiInfo, QualityLevel, WeatherMode } from '../types/garden';

export interface KoiGardenCanvasProps {
  onProgress?: (progress: number, message: string) => void;
  onToast?: (message: string) => void;
  onCaption?: (caption: string) => void;
  onHUDStats?: (stats: GardenHUDStats) => void;
  onFollowKoi?: (koi: KoiInfo | null) => void;
  onCameraModeChange?: (mode: CameraMode) => void;
  onWeatherChange?: (weather: WeatherMode) => void;
  onMuteChange?: (muted: boolean) => void;
  onHoldChange?: (held: boolean) => void;
  onFreezeChange?: (frozen: boolean) => void;
  onReady?: () => void;
  engineRef?: React.MutableRefObject<any>;
}

export const KoiGardenCanvas = React.memo<KoiGardenCanvasProps>(({
  onProgress,
  onToast,
  onCaption,
  onHUDStats,
  onFollowKoi,
  onCameraModeChange,
  onWeatherChange,
  onMuteChange,
  onHoldChange,
  onFreezeChange,
  onReady,
  engineRef,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    if (renderer && renderer.domElement) {
      if (!container.contains(renderer.domElement)) {
        container.innerHTML = '';
        container.appendChild(renderer.domElement);
      }
      renderer.domElement.tabIndex = 0;
      renderer.domElement.className = 'w-full h-full block focus:outline-none cursor-grab active:cursor-grabbing';
    }

    const engine = createGardenEngine(renderer.domElement, {
      onProgress,
      onToast,
      onCaption,
      onHUDStats,
      onFollowKoi,
      onCameraModeChange: onCameraModeChange ? ((m: string) => onCameraModeChange(m as CameraMode)) : undefined,
      onWeatherChange: onWeatherChange ? ((w: string) => onWeatherChange(w as WeatherMode)) : undefined,
      onMuteChange,
      onHoldChange,
      onFreezeChange,
      onReady,
    });

    if (engineRef) {
      engineRef.current = engine;
    }

    return () => {
      engine.dispose();
      if (engineRef) {
        engineRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden w-full h-full bg-[#0b1411]"
    />
  );
});
