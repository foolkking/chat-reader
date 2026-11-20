import type { Locator } from "@playwright/test";

// CDP acknowledging touchMove (or Playwright acknowledging wheel) does not
// mean the compositor has applied its last delta. Arm before sending input.
// This barrier runs ONLY while the saved-position response is still held:
// it must never absorb a jump caused by releasing that response.
export function watchHeldReaderInput(root: Locator) {
  return root.evaluateHandle((el) => {
    let lastTouchY: number | null = null, touchMoves = 0, wheels = 0, released = false;
    const onTouchMove = (event: Event) => {
      const touch = (event as TouchEvent).touches[0];
      if (touch) { lastTouchY = touch.clientY; touchMoves++; }
    };
    const onWheel = () => { wheels++; };
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    const calls: { method: string; released: boolean; before: number; after: number }[] = [];
    const ownTop = Object.getOwnPropertyDescriptor(el, "scrollTop");
    const nativeTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
    Object.defineProperty(el, "scrollTop", {
      configurable: true, get: () => nativeTop.get!.call(el) as number,
      set(value: number) {
        const before = el.scrollTop;
        nativeTop.set!.call(el, value);
        calls.push({ method: "scrollTop", released, before, after: el.scrollTop });
      },
    });
    const methods = (["scrollTo", "scrollBy"] as const).map(method => {
      const own = Object.getOwnPropertyDescriptor(el, method), original = el[method];
      Object.defineProperty(el, method, { configurable: true, writable: true, value: (...args: unknown[]) => {
        const before = el.scrollTop;
        Reflect.apply(original, el, args);
        calls.push({ method, released, before, after: el.scrollTop });
      } });
      return { method, own };
    });
    return {
      async settle(finalTouchY: number | null) {
        const start = performance.now(), frames: { top: number; touchY: number | null }[] = [];
        let quiet = 0, lastTop = el.scrollTop;
        while (performance.now() - start < 2000) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          if (released) throw Error("Input barrier must finish before releasing the saved position");
          const top = el.scrollTop;
          const inputArrived = finalTouchY === null ? wheels > 0
            : lastTouchY !== null && Math.abs(lastTouchY - finalTouchY) < 1;
          quiet = inputArrived && top === lastTop ? quiet + 1 : 0;
          frames.push({ top, touchY: lastTouchY }); lastTop = top;
          if (quiet >= 4) return { top, quietFrames: quiet, touchMoves, wheels, lastTouchY, frames };
        }
        throw Error("Native reader input did not settle within its original 2s input budget");
      },
      release() { released = true; },
      readCalls() { return calls; },
      dispose() {
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("wheel", onWheel);
        if (ownTop) Object.defineProperty(el, "scrollTop", ownTop);
        else Reflect.deleteProperty(el, "scrollTop");
        for (const { method, own } of methods) {
          if (own) Object.defineProperty(el, method, own); else Reflect.deleteProperty(el, method);
        }
      },
    };
  });
}
