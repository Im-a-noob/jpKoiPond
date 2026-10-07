import React from 'react';
import { CameraMode, GardenHUDStats, KoiInfo, WeatherMode } from '../types/garden';
import { Compass, Eye, X, Sparkles } from 'lucide-react';

export interface HUDOverlayProps {
  stats: GardenHUDStats | null;
  caption: string;
  toast: string;
  cleanView: boolean;
  onExitCleanView: () => void;
  onUnfollowKoi: () => void;
}

export const HUDOverlay: React.FC<HUDOverlayProps> = ({
  stats,
  caption,
  toast,
  cleanView,
  onExitCleanView,
  onUnfollowKoi,
}) => {
  return (
    <>
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-4 py-2 rounded-full glass text-xs font-medium text-emerald-100 shadow-xl border border-white/20 animate-in fade-in slide-in-from-top-2 duration-300">
          {toast}
        </div>
      )}

      {/* Clean Mode Hint */}
      {cleanView && (
        <div
          onClick={onExitCleanView}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full glass text-xs text-emerald-100/80 hover:text-white cursor-pointer transition-opacity border border-white/10 flex items-center gap-2"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Zen view · Press V or Esc to show controls</span>
        </div>
      )}

      {!cleanView && (
        <>
          {/* Top-Left Telemetry HUD */}
          {stats && (
            <div className="fixed top-3 sm:top-4 left-3 sm:left-4 z-30 pointer-events-none p-2.5 sm:p-3 rounded-2xl glass text-[11px] font-mono tabular-nums text-emerald-100/80 space-y-1 border border-white/10 max-w-[280px]">
              <div className="flex items-center justify-between gap-4 font-semibold text-zinc-100">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {stats.fps} FPS
                </span>
                <span className="text-zinc-400 text-[10px]">{stats.resolution}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-300 text-[10px] pt-0.5 border-t border-white/10">
                <span>Time: {stats.timeOfDay}</span>
                <span>Koi: {stats.fishCount}</span>
                <span>{stats.weather}</span>
              </div>
              {stats.isUnderwater && (
                <div className="text-[10px] text-cyan-300 font-medium">
                  Underwater: {((stats.waterClarity ?? 1) * 100).toFixed(0)}% Clarity
                </div>
              )}
            </div>
          )}

          {/* Active Koi Follow Card */}
          {stats?.followedKoi && (
            <div className="fixed top-3 sm:top-4 right-3 sm:right-4 z-30 p-3 sm:p-3.5 rounded-2xl glass border border-amber-500/30 text-xs shadow-xl animate-in fade-in duration-200 max-w-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <Compass className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-serif text-sm text-zinc-100 flex items-center gap-1.5">
                      <span>{stats.followedKoi.name}</span>
                      <span className="text-amber-400 font-mono text-xs">{stats.followedKoi.kanji}</span>
                    </div>
                    <div className="text-[11px] text-emerald-300/80 font-mono">
                      {stats.followedKoi.category} • {stats.followedKoi.lengthCm} cm
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onUnfollowKoi}
                  title="Return to cinematic camera"
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Cinematic Shot Subtitle / Caption */}
          {caption && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none text-center animate-in fade-in duration-500">
              <h2 className="font-serif text-sm sm:text-lg tracking-[0.2em] uppercase text-[#f4efe6] drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
                {caption}
              </h2>
            </div>
          )}
        </>
      )}
    </>
  );
};
