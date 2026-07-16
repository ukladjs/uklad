import { useCallback } from 'react';
import { TraceItem } from '../../types/Trace';
import { dispatch } from '@flexsurfer/reflex';
import { Badge } from '../ui/Badge';

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

interface TraceListItemProps {
  item: TraceItem;
  selected: boolean;
  showBadges: boolean;
  showParams?: boolean;
  showTimestamps?: boolean;
}

function EventTraceItem({ item, showBadges, showParams, showTimestamps }: Omit<TraceListItemProps, 'selected'>) {
  let eventId = 'unknown-event';
  let restParams: any[] = [];

  const eventData = item.traces[0]?.tags?.event;

  // If eventData is an array (typical event dispatch format: ['event-name', ...params])
  if (Array.isArray(eventData) && eventData.length > 0) {
    eventId = eventData[0];
    restParams = eventData.slice(1);
  }

  return (
    <div className="flex items-center justify-between px-2 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {showTimestamps && item.traces[0]?.start && (
          <span className="text-[10px] text-base-content opacity-30 font-mono flex-shrink-0">
            {formatTimestamp(item.traces[0].start)}
          </span>
        )}
        <span className="text-base-content opacity-80 flex-shrink-0">{eventId}</span>
        {showParams && restParams.length > 0 && (
          <span className="inline-block bg-base-200 px-1 py-0.5 rounded text-xs truncate text-base-content opacity-40">
            {restParams.map((param, index) =>
              (typeof param === 'object' ? JSON.stringify(param) : String(param)) +
              (index < restParams.length - 1 ? ', ' : '')
            )}
          </span>
        )}
      </div>
      {showBadges && (
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {item.badges.map((badge) => {
            return <Badge key={badge.label} opType={badge.label} label={badge.label + (badge.number > 1 ? (": " + badge.number) : "")} style="soft" className="opacity-60" />
          })}
        </div>
      )}
    </div>
  );
}

function RenderTraceItem({ item, showBadges, showTimestamps }: Omit<TraceListItemProps, 'selected'>) {
  return (
    <div className="flex items-center justify-between px-2 py-2 text-sm">
      <div className="flex items-center gap-2 flex-shrink-0">
        {showTimestamps && item.traces[0]?.start && (
          <span className="text-[10px] text-base-content opacity-30 font-mono flex-shrink-0">
            {formatTimestamp(item.traces[0].start)}
          </span>
        )}
        <span className="text-info opacity-60">render</span>
      </div>
      {showBadges && (
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {item.badges.map((badge) => {
            return <Badge key={badge.label} opType={badge.label} label={badge.label + (badge.number > 1 ? (": " + badge.number) : "")} style="soft" className="opacity-60" />
          })}
        </div>
      )}
    </div>
  );
}

export default function TraceListItem({ item, selected, showBadges, showParams, showTimestamps }: TraceListItemProps) {
  const isEvent = item.type === 'event';

  const handleClick = useCallback(() => {
    dispatch(['set-selected-trace', item]);
  }, [item]);

  return (
    <li className={`hover:bg-base-300 border-b border-base-300 cursor-pointer ${selected ? 'bg-base-300' : ''}`} onClick={handleClick}>
      {isEvent ? (
        <EventTraceItem item={item} showBadges={showBadges} showParams={showParams} showTimestamps={showTimestamps} />
      ) : (
        <RenderTraceItem item={item} showBadges={showBadges} showTimestamps={showTimestamps} />
      )}
    </li>
  );
} 