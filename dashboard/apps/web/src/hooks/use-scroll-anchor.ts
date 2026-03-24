import { useCallback, useEffect, useRef, useState } from 'react';

export function useScrollAnchor<T>(items: T[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!isLocked && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [items.length, isLocked]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsLocked(distFromBottom > 100);
  }, []);

  const jumpToLatest = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setIsLocked(false);
    }
  }, []);

  return { containerRef, isLocked, handleScroll, jumpToLatest };
}
