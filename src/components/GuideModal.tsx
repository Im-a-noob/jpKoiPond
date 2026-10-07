import React from 'react';
import { X, Sparkles, Navigation, Hand, Droplets } from 'lucide-react';

export interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl glass-card overflow-hidden border border-white/15 shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-300">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif text-lg text-amber-100">Garden Guide</h3>
              <p className="text-xs text-emerald-200/60 font-sans">Controls & Interactions</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lead instructions */}
        <div className="mt-4 p-3 rounded-2xl bg-white/5 border border-white/10 text-xs text-emerald-100/90 leading-relaxed flex items-start gap-2.5">
          <Droplets className="w-4 h-4 text-cyan-300 flex-shrink-0 mt-0.5" />
          <span>
            Click anywhere on the pond surface to generate ripples and a physical splash. Click the green frog resting on the lily pad to watch it leap!
          </span>
        </div>

        {/* Shortcuts list */}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Camera Mode</span>
            <kbd>C</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Feed the Koi</span>
            <kbd>E</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Hold Camera</span>
            <kbd>P</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Stroke a Koi</span>
            <kbd>G</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Freeze Time</span>
            <kbd>O</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Follow Koi</span>
            <kbd>K</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Clean / Zen View</span>
            <kbd>V</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Change Weather</span>
            <kbd>T</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Mute Sound</span>
            <kbd>M</kbd>
          </div>
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-zinc-300">Dev Panel</span>
            <kbd>H</kbd>
          </div>
        </div>

        {/* Manual Flight Details */}
        <div className="mt-4 p-3 rounded-2xl bg-black/30 border border-white/10 text-xs space-y-1.5">
          <div className="font-semibold text-amber-200 flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5" />
            <span>Manual Drone Camera Navigation</span>
          </div>
          <div className="text-zinc-300 flex flex-wrap items-center gap-1.5 pt-1">
            <span>Look:</span> <kbd>Drag</kbd>
            <span className="ml-2">Move:</span> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
            <span className="ml-2">Altitude:</span> <kbd>Q</kbd><kbd>Space</kbd>
            <span className="ml-2">Turbo:</span> <kbd>Shift</kbd>
          </div>
        </div>

        <div className="mt-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl font-medium text-xs text-white bg-white/10 hover:bg-white/15 transition-all cursor-pointer"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
