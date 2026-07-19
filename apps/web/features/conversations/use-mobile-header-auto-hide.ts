"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export function useMobileHeaderAutoHide({
  scrollRootRef,
  forcedVisible,
  resetKey,
}: {
  scrollRootRef: RefObject<HTMLElement | null>;
  forcedVisible: boolean;
  resetKey: string;
}) {
  const [visible, setVisible] = useState(true);
  const lastScrollTopRef = useRef(0);
  const downwardDistanceRef = useRef(0);

  useEffect(() => {
    const root = scrollRootRef.current;
    lastScrollTopRef.current = root?.scrollTop ?? 0;
    downwardDistanceRef.current = 0;
    setVisible(true);
  }, [resetKey, scrollRootRef]);

  useEffect(() => {
    let root: HTMLElement | null = null;
    let frameId = 0;

    const resetBaseline = () => {
      if (!root) return;
      lastScrollTopRef.current = root.scrollTop;
      downwardDistanceRef.current = 0;
      setVisible(true);
    };
    const handleScroll = () => {
      const current = root?.scrollTop;
      if (current === undefined) return;
      const delta = current - lastScrollTopRef.current;
      lastScrollTopRef.current = current;

      if (window.innerWidth >= 768 || forcedVisible || current < 24) {
        downwardDistanceRef.current = 0;
        setVisible(true);
        return;
      }
      if (delta < -8) {
        downwardDistanceRef.current = 0;
        setVisible(true);
        return;
      }
      if (delta > 0) {
        downwardDistanceRef.current += delta;
        if (current > 80 && downwardDistanceRef.current >= 48) setVisible(false);
      }
    };

    const bindScrollRoot = () => {
      root = scrollRootRef.current;
      if (!root) {
        frameId = window.requestAnimationFrame(bindScrollRoot);
        return;
      }
      root.addEventListener("scroll", handleScroll, { passive: true });
      window.addEventListener("resize", resetBaseline);
      window.addEventListener("orientationchange", resetBaseline);
      resetBaseline();
    };

    bindScrollRoot();
    return () => {
      window.cancelAnimationFrame(frameId);
      root?.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", resetBaseline);
      window.removeEventListener("orientationchange", resetBaseline);
    };
  }, [forcedVisible, scrollRootRef]);

  return visible;
}
