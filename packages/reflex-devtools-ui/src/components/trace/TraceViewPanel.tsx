import { useCallback, useEffect, useRef } from 'react';
import { useSubscription, dispatch } from '@flexsurfer/reflex';

interface TraceViewPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TraceViewPanel({ isOpen, onClose }: TraceViewPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const showRenders = useSubscription<boolean>(['showRenders']);
  const showBadges = useSubscription<boolean>(['showBadges']);
  const showParams = useSubscription<boolean>(['showParams']);
  const showTimestamps = useSubscription<boolean>(['showTimestamps']);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [isOpen, onClose]);

  const handleToggleShowRenders = useCallback(() => {
    dispatch(['toggle-show-renders']);
  }, []);

  const handleToggleShowBadges = useCallback(() => {
    dispatch(['toggle-show-badges']);
  }, []);

  const handleToggleShowParams = useCallback(() => {
    dispatch(['toggle-show-params']);
  }, []);

  const handleToggleShowTimestamps = useCallback(() => {
    dispatch(['toggle-show-timestamps']);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="absolute top-full left-0 mt-1 bg-base-100 border border-base-300 rounded-md shadow-lg p-2 z-50 min-w-48"
    >
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer p-1 hover:bg-base-200 rounded text-sm">
          <input
            type="checkbox"
            checked={showRenders || false}
            onChange={handleToggleShowRenders}
            className="checkbox checkbox-xs"
          />
          <span>Show renders</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer p-1 hover:bg-base-200 rounded text-sm">
          <input
            type="checkbox"
            checked={showBadges || false}
            onChange={handleToggleShowBadges}
            className="checkbox checkbox-xs"
          />
          <span>Show badges</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer p-1 hover:bg-base-200 rounded text-sm">
          <input
            type="checkbox"
            checked={showParams || false}
            onChange={handleToggleShowParams}
            className="checkbox checkbox-xs"
          />
          <span>Show params</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer p-1 hover:bg-base-200 rounded text-sm">
          <input
            type="checkbox"
            checked={showTimestamps || false}
            onChange={handleToggleShowTimestamps}
            className="checkbox checkbox-xs"
          />
          <span>Show timestamps</span>
        </label>
      </div>
    </div>
  );
}
