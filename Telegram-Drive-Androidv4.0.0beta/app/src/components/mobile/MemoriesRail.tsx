import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { getOnThisDayMemories } from '../../services/mediaGallery';
import { useMediaThumbnail } from '../../hooks/useMediaThumbnail';
import { MemoriesStoryViewer } from './MemoriesStoryViewer';
import type { MemoryGroup } from '../../types';

/** Localized "1 year ago" / "N years ago" label for a memory group. */
export function memoryYearsAgoLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  yearsAgo: number,
): string {
  return yearsAgo === 1
    ? t('gallery.one_year_ago')
    : t('gallery.years_ago', { count: yearsAgo });
}

/**
 * "Flashbacks / On this day" rail rendered at the top of the photo gallery.
 * Pulls records whose month/day match today (year in the past), grouped by
 * years-ago, straight from SQLite — no Telegram call.
 */
export function MemoriesRail() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<MemoryGroup[] | null>(null);
  const [activeYearsAgo, setActiveYearsAgo] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOnThisDayMemories()
      .then((value) => {
        if (!cancelled) setGroups(value);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only surface groups with at least one SYNCED, thumbnailed item.
  const visible = useMemo(
    () => (groups ?? []).filter((group) => group.items.some((item) => item.hasMicroThumb)),
    [groups],
  );

  if (!groups || visible.length === 0) return null;

  return (
    <div className="shrink-0 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-telegram-primary" />
        <h4 className="text-xs font-bold uppercase tracking-wide text-telegram-subtext">
          {t('gallery.on_this_day')}
        </h4>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {visible.map((group) => (
          <button
            key={group.yearsAgo}
            type="button"
            onClick={() => setActiveYearsAgo(group.yearsAgo)}
            className="shrink-0 w-[92px] flex flex-col gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-telegram-primary rounded-xl"
          >
            <div className="w-[92px] h-[92px] rounded-2xl overflow-hidden bg-telegram-hover/20 border border-telegram-border/20">
              <MemoryCover group={group} />
            </div>
            <span className="text-[11px] font-semibold text-telegram-text leading-tight">
              {memoryYearsAgoLabel(t, group.yearsAgo)}
            </span>
          </button>
        ))}
      </div>

      {activeYearsAgo !== null && (
        <MemoriesStoryViewer
          groups={visible}
          activeYearsAgo={activeYearsAgo}
          onClose={() => setActiveYearsAgo(null)}
        />
      )}
    </div>
  );
}

function MemoryCover({ group }: { group: MemoryGroup }) {
  const cover = group.items.find((item) => item.hasMicroThumb);
  const thumb = useMediaThumbnail(cover?.id ?? 0, 'micro', Boolean(cover?.hasMicroThumb));
  return thumb ? (
    <img src={thumb} alt={group.label} className="w-full h-full object-cover" draggable={false} />
  ) : (
    <div className="w-full h-full flex items-center justify-center text-telegram-subtext">
      <Sparkles className="w-5 h-5" />
    </div>
  );
}
