"use client";
import { usePreferences } from "../../../components/preferences-provider";
import { ExtensionDevices } from "../../../features/browser-extension/devices";

export default function ExtensionDeviceSettings() {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  return <main className="mx-auto max-w-lg space-y-4 px-4 py-8 text-primary">
    <h1 className="text-lg font-semibold">{zh?"账号安全 · 浏览器插件":"Account security · Browser extensions"}</h1>
    <ExtensionDevices zh={zh} expanded/>
  </main>;
}
