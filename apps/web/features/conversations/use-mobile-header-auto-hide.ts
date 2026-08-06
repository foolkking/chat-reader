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
  const upwardDistanceRef = useRef(0);
  const userIntentUntilRef = useRef(0);
  const intendedDirectionRef = useRef<"up" | "down" | null>(null);
  const lastTouchYRef = useRef<number | null>(null);

  useEffect(() => {
    if (forcedVisible) setVisible(true);
  }, [forcedVisible]);

  useEffect(() => {
    const root = scrollRootRef.current;
    lastScrollTopRef.current = root?.scrollTop ?? 0;
    downwardDistanceRef.current = 0;
    upwardDistanceRef.current = 0;
    userIntentUntilRef.current = 0;
    intendedDirectionRef.current = null;
    setVisible(true);
  }, [resetKey, scrollRootRef]);

  useEffect(() => {
    let root: HTMLElement | null = null;
    let frameId = 0;

    const resetBaseline = () => {
      if (!root) return;
      lastScrollTopRef.current = root.scrollTop;
      downwardDistanceRef.current = 0;
      upwardDistanceRef.current = 0;
      userIntentUntilRef.current = 0;
      intendedDirectionRef.current = null;
      setVisible(true);
    };

    const markUserIntent = (direction: "up" | "down") => {
      intendedDirectionRef.current = direction;
      userIntentUntilRef.current = window.performance.now() + 650;
      if (direction === "up") {
        downwardDistanceRef.current = 0;
        setVisible(true);
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) markUserIntent(event.deltaY < 0 ? "up" : "down");
    };

    const handleTouchStart = (event: TouchEvent) => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      const previousY = lastTouchYRef.current;
      if (currentY === undefined || previousY === null) return;
      const scrollDelta = previousY - currentY;
      lastTouchYRef.current = currentY;
      if (Math.abs(scrollDelta) >= 1) markUserIntent(scrollDelta < 0 ? "up" : "down");
    };

    const handleTouchEnd = () => {
      lastTouchYRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (["arrowup", "pageup", "home", "k"].includes(key) || (event.key === " " && event.shiftKey)) {
        markUserIntent("up");
      } else if (["arrowdown", "pagedown", "end", "j"].includes(key) || event.key === " ") {
        markUserIntent("down");
      }
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

      const hasUserIntent = window.performance.now() <= userIntentUntilRef.current;
      if (!hasUserIntent || intendedDirectionRef.current === null) return;

      if (intendedDirectionRef.current === "up") {
        downwardDistanceRef.current = 0;
        upwardDistanceRef.current += Math.abs(delta);
        setVisible(true);
        return;
      }
      if (delta > 0) {
        upwardDistanceRef.current = 0;
        downwardDistanceRef.current += delta;
        if (current > 80 && downwardDistanceRef.current >= 40) setVisible(false);
      }
    };

    const bindScrollRoot = () => {
      root = scrollRootRef.current;
      if (!root) {
        frameId = window.requestAnimationFrame(bindScrollRoot);
        return;
      }
      root.addEventListener("scroll", handleScroll, { passive: true });
      root.addEventListener("wheel", handleWheel, { passive: true });
      root.addEventListener("touchstart", handleTouchStart, { passive: true });
      root.addEventListener("touchmove", handleTouchMove, { passive: true });
      root.addEventListener("touchend", handleTouchEnd, { passive: true });
      root.addEventListener("touchcancel", handleTouchEnd, { passive: true });
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("resize", resetBaseline);
      window.addEventListener("orientationchange", resetBaseline);
      resetBaseline();
    };

    bindScrollRoot();
    return () => {
      window.cancelAnimationFrame(frameId);
      root?.removeEventListener("scroll", handleScroll);
      root?.removeEventListener("wheel", handleWheel);
      root?.removeEventListener("touchstart", handleTouchStart);
      root?.removeEventListener("touchmove", handleTouchMove);
      root?.removeEventListener("touchend", handleTouchEnd);
      root?.removeEventListener("touchcancel", handleTouchEnd);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", resetBaseline);
      window.removeEventListener("orientationchange", resetBaseline);
    };
  }, [forcedVisible, scrollRootRef]);

  return visible;
}
