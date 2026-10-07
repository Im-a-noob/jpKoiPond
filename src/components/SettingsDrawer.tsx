import React, { useState } from 'react';
import { X, Sliders, Sun, Droplets, Waves, Sparkles, Volume2, Shield, Terminal } from 'lucide-react';
import { QualityLevel } from '../types/garden';

export interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  engine: any;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  onClose,
  engine,
}) => {
  if (!isOpen || !engine) return null;

  const params = engine.getParams ? engine.getParams() : {};

  const [timeOfDay, setTimeOfDay] = useState<number>(params.timeOfDay ?? 10.5);
  const [waterClarity, setWaterClarity] = useState<number>(params.waterClarity ?? 1.6);
  const [waveHeight, setWaveHeight] = useState<number>(params.waveHeight ?? 1.0);
  const [caustics, setCaustics] = useState<number>(params.causticStrength ?? 1.0);
  const [bloom, setBloom] = useState<number>(params.bloomStrength ?? 0.3);
  const [volume, setVolume] = useState<number>(params.volume ?? 0.7);
  const [quality, setQuality] = useState<QualityLevel>(params.quality ?? 'High');

  const handleTimeChange = (v: number) => {
    setTimeOfDay(v);
    engine.setTimeOfDay?.(v);
  };

  const handleClarityChange = (v: number) => {
    setWaterClarity(v);
    engine.setWaterClarity?.(v);
  };

  const handleWaveChange = (v: number) => {
    setWaveHeight(v);
    engine.setWaveHeight?.(v);
  };

  const handleCausticChange = (v: number) => {
    setCaustics(v);
    engine.setCausticStrength?.(v);
  };

  const handleBloomChange = (v: number) => {
    setBloom(v);
    engine.setBloomStrength?.(v);
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    engine.setVolume?.(v);
  };

  const handleQualityChange = (q: QualityLevel) => {
    setQuality(q);
    engine.setQuality?.(q);
  };

  const formatHours = (h: number) => {
    const hours = Math.floor(h);
    const mins = Math.floor((h % 1) * 60);
    return `${hours}:${String(mins).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 glass-card border-l border-white/15 p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-300">
      <div className="space-y-6 overflow-y-auto pr-1">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-amber-300" />
            <h3 className="font-serif text-lg text-amber-100">Garden Parameters</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quality presets */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-emerald-300/80 font-medium flex items-center justify-between">
            <span>Graphics Quality</span>
            <span className="text-white font-mono">{quality}</span>
          </label>
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-black/30 border border-white/10">
            {(['High', 'Med', 'Low', 'Auto'] as const).map((q) => (
              <button
                key={q}
                onClick={() => handleQualityChange(q)}
                className={`py-1.5 rounded-lg text-xs font-medium transition-all ${
                  quality === q
                    ? 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-500/50'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Sun & Time of day */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200 flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              Time of Day
            </span>
            <span className="font-mono text-amber-300">{formatHours(timeOfDay)}</span>
          </div>
          <input
            type="range"
            min={6}
            max={19}
            step={0.1}
            value={timeOfDay}
            onChange={(e) => handleTimeChange(parseFloat(e.target.value))}
            className="w-full accent-amber-400 cursor-pointer h-1.5 bg-white/10 rounded-lg appearance-none"
          />
        </div>

        {/* Water clarity */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200 flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5 text-cyan-400" />
              Water Clarity
            </span>
            <span className="font-mono text-cyan-300">{waterClarity.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.3}
            max={2.0}
            step={0.05}
            value={waterClarity}
            onChange={(e) => handleClarityChange(parseFloat(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-white/10 rounded-lg appearance-none"
          />
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span>Murky Lagoon</span>
            <span>Crystal Spring</span>
          </div>
        </div>

        {/* Waves & Ripples */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200 flex items-center gap-1.5">
              <Waves className="w-3.5 h-3.5 text-teal-400" />
              Wave Height
            </span>
            <span className="font-mono text-teal-300">{waveHeight.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={2.0}
            step={0.05}
            value={waveHeight}
            onChange={(e) => handleWaveChange(parseFloat(e.target.value))}
            className="w-full accent-teal-400 cursor-pointer h-1.5 bg-white/10 rounded-lg appearance-none"
          />
        </div>

        {/* Caustics */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-200" />
              Underwater Caustics
            </span>
            <span className="font-mono text-amber-200">{caustics.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={2.5}
            step={0.1}
            value={caustics}
            onChange={(e) => handleCausticChange(parseFloat(e.target.value))}
            className="w-full accent-amber-300 cursor-pointer h-1.5 bg-white/10 rounded-lg appearance-none"
          />
        </div>

        {/* Bloom */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
              Bloom Glow
            </span>
            <span className="font-mono text-emerald-300">{bloom.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={1.0}
            step={0.05}
            value={bloom}
            onChange={(e) => handleBloomChange(parseFloat(e.target.value))}
            className="w-full accent-emerald-400 cursor-pointer h-1.5 bg-white/10 rounded-lg appearance-none"
          />
        </div>

        {/* Volume */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-zinc-300" />
              Soundscape Volume
            </span>
            <span className="font-mono text-zinc-300">{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={1.0}
            step={0.02}
            value={volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="w-full accent-zinc-200 cursor-pointer h-1.5 bg-white/10 rounded-lg appearance-none"
          />
        </div>
      </div>

      {/* Developer dat.gui Toggle */}
      <div className="pt-4 border-t border-white/10 space-y-2">
        <button
          type="button"
          onClick={() => engine.toggleGUI?.()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium text-emerald-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
        >
          <Terminal className="w-4 h-4" />
          <span>Toggle dat.gui Debug Panel (H)</span>
        </button>
      </div>
    </div>
  );
};
