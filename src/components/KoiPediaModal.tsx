import React, { useState } from 'react';
import { X, Search, Compass, Sparkles, Filter } from 'lucide-react';
import { KOI_COLLECTION_DATA } from '../engine/koiData';
import { KoiInfo } from '../types/garden';

export interface KoiPediaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFollowKoi: (index: number) => void;
  activeFollowedKoi?: KoiInfo | null;
}

export const KoiPediaModal: React.FC<KoiPediaModalProps> = ({
  isOpen,
  onClose,
  onFollowKoi,
  activeFollowedKoi,
}) => {
  const [search, setSearch] = useState('');
  const [sizeFilter, setSizeFilter] = useState<'all' | 'small' | 'medium' | 'jumbo'>('all');
  const [selectedKoi, setSelectedKoi] = useState<KoiInfo>(
    activeFollowedKoi || KOI_COLLECTION_DATA[0]
  );

  if (!isOpen) return null;

  const filteredKoi = KOI_COLLECTION_DATA.filter((k) => {
    const matchesSearch =
      k.name.toLowerCase().includes(search.toLowerCase()) ||
      k.kanji.includes(search) ||
      k.romaji.toLowerCase().includes(search.toLowerCase()) ||
      k.category.toLowerCase().includes(search.toLowerCase());
    const matchesSize = sizeFilter === 'all' || k.size === sizeFilter;
    return matchesSearch && matchesSize;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-3xl glass-card overflow-hidden border border-white/15 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
          <div>
            <h2 className="text-xl font-serif tracking-wide text-amber-100 flex items-center gap-2">
              <span>錦鯉図鑑</span>
              <span className="text-xs uppercase tracking-widest text-emerald-400 font-sans font-medium px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/30">
                Koi-Pedia
              </span>
            </h2>
            <p className="text-xs text-emerald-200/60 font-sans">
              20 authentic Japanese koi across 18 living varieties in your garden pond
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-white/10 bg-black/10">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-white/40" />
            <input
              type="text"
              placeholder="Search by name, Kanji, or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Filter className="w-3.5 h-3.5 mr-1" />
            {(['all', 'jumbo', 'medium', 'small'] as const).map((sz) => (
              <button
                key={sz}
                onClick={() => setSizeFilter(sz)}
                className={`px-2.5 py-1 rounded-lg capitalize transition-colors ${
                  sizeFilter === sz
                    ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                    : 'bg-white/5 text-zinc-400 hover:text-white'
                }`}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        {/* Content Body: Split View */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          {/* Koi Grid / List */}
          <div className="w-full md:w-1/2 overflow-y-auto p-4 space-y-2 border-r border-white/10">
            {filteredKoi.map((koi) => {
              const isSelected = selectedKoi.id === koi.id;
              const isCurrentlyFollowed = activeFollowedKoi?.id === koi.id;

              return (
                <div
                  key={koi.id}
                  onClick={() => setSelectedKoi(koi)}
                  className={`p-3 rounded-2xl cursor-pointer transition-all border flex items-center justify-between ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-500/40 shadow-md'
                      : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.08] hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Color palette preview swatch */}
                    <div className="flex -space-x-1.5 p-1 rounded-full bg-black/40 border border-white/10">
                      {koi.colorPalette.map((col, idx) => (
                        <div
                          key={idx}
                          className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-sm"
                          style={{ backgroundColor: col }}
                        />
                      ))}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-sm text-zinc-100">{koi.name}</span>
                        <span className="text-xs text-amber-400/80 font-mono">{koi.kanji}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                        <span className="capitalize">{koi.size} ({koi.lengthCm}cm)</span>
                        <span>•</span>
                        <span>{koi.category}</span>
                      </div>
                    </div>
                  </div>

                  {isCurrentlyFollowed && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Tracking
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Koi Detailed Profile Card */}
          <div className="w-full md:w-1/2 p-6 overflow-y-auto bg-black/20 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-serif text-amber-100 flex items-baseline gap-3">
                    <span>{selectedKoi.name}</span>
                    <span className="text-base text-amber-400/90 font-normal">{selectedKoi.kanji}</span>
                  </div>
                  <div className="text-xs text-emerald-300 font-mono tracking-wide mt-0.5">
                    {selectedKoi.romaji} • {selectedKoi.category}
                  </div>
                </div>

                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {selectedKoi.rarity}
                </span>
              </div>

              {/* Badges */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
                  <div className="text-[10px] uppercase text-zinc-400">Scale Type</div>
                  <div className="text-zinc-200 font-medium mt-0.5">{selectedKoi.scaleType}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
                  <div className="text-[10px] uppercase text-zinc-400">Estimated Length</div>
                  <div className="text-zinc-200 font-medium mt-0.5">{selectedKoi.lengthCm} cm ({selectedKoi.size})</div>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <h4 className="text-xs uppercase tracking-wider text-amber-300/80 font-medium">History & Lore</h4>
                <p className="text-xs leading-relaxed text-zinc-300">
                  {selectedKoi.description}
                </p>
              </div>

              {/* Pattern */}
              <div className="space-y-1.5 p-3 rounded-xl bg-black/30 border border-white/10">
                <h4 className="text-xs uppercase tracking-wider text-amber-300/80 font-medium flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Pattern & Markings
                </h4>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {selectedKoi.patternDescription}
                </p>
              </div>
            </div>

            {/* Follow Action */}
            <div className="pt-6 mt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  onFollowKoi(selectedKoi.id);
                  onClose();
                }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-teal-950/50 transition-all cursor-pointer active:scale-98"
              >
                <Compass className="w-4 h-4" />
                <span>Track & Follow This Koi in 3D</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
