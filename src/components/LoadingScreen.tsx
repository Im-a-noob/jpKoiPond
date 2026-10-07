import React from 'react';
import { Sparkles } from 'lucide-react';

export interface LoadingScreenProps {
  progress: number;
  message: string;
  isReady: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  progress,
  message,
  isReady,
}) => {
  if (isReady) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070e0c] text-white transition-opacity duration-700 p-6 select-none">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(240,137,76,0.08),transparent_65%)] pointer-events-none" />

      <div className="relative flex flex-col items-center max-w-sm w-full text-center space-y-6">
        {/* Japanese Title */}
        <div className="space-y-1">
          <div className="text-3xl font-serif text-amber-200/90 tracking-widest">
            鯉の庭園
          </div>
          <h1 className="text-xl sm:text-2xl font-serif tracking-wider text-emerald-100">
            Koi Pond Garden
          </h1>
          <p className="text-xs text-emerald-200/50 font-sans tracking-wide">
            Real-Time Procedural 3D Japanese Garden
          </p>
        </div>

        {/* Lotus emblem */}
        <div className="w-12 h-12 rounded-full border border-amber-500/20 bg-amber-500/10 flex items-center justify-center text-amber-300 animate-pulse">
          <Sparkles className="w-6 h-6" />
        </div>

        {/* Progress Bar */}
        <div className="w-full space-y-2">
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden border border-white/10 p-[1px]">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-400 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-emerald-200/70 px-1">
            <span className="truncate max-w-[240px]">{message || 'Preparing environment...'}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
        </div>

        <p className="text-[11px] text-zinc-500 max-w-xs leading-relaxed pt-2">
          Every stone, leaf, koi scale, wave ripple, and sound is procedurally synthesized in your browser.
        </p>
      </div>
    </div>
  );
};
