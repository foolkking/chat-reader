"use client";

import { useEffect, useRef, useState } from "react";
import { getCurrentOfflineRuntimeUserId } from "../lib/auth-client";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../lib/offline-access";

/** Device-local navigation only; never imports another account's layout. */
export function useNavigationDeviceState<T>(name: string, fallback: T, validate: (value: unknown) => value is T) {
  const [state, setState] = useState(fallback);
  const initial = useRef({ fallback, validate });
  useEffect(() => {
    const read = () => {
      setState(initial.current.fallback);
      try {
        const user = getCurrentOfflineRuntimeUserId();
        if (!user) return;
        const value: unknown = JSON.parse(localStorage.getItem(`chat-reader:navigation:${user}:${name}`) ?? "null");
        if (initial.current.validate(value)) setState(value);
      } catch { /* Device layout storage is optional. */ }
    };
    read();
    const event = `chat-reader:navigation-change:${name}`;
    window.addEventListener(event, read);
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, read);
    return () => { window.removeEventListener(event, read); window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, read); };
  }, [name]);
  const generation = authenticationGeneration();
  const update = (value: T) => {
    if (generation !== authenticationGeneration()) return;
    setState(value);
    try {
      const user = getCurrentOfflineRuntimeUserId();
      if (user) {
        localStorage.setItem(`chat-reader:navigation:${user}:${name}`, JSON.stringify(value));
        window.dispatchEvent(new Event(`chat-reader:navigation-change:${name}`));
      }
    } catch { /* In-memory layout still works when storage is unavailable. */ }
  };
  return [state, update] as const;
}
