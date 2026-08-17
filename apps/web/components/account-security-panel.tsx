"use client";

import { FormEvent, useState } from "react";
import { changeOwnerPassword, logoutCurrentDevice } from "../lib/auth-client";

export function AccountSecurityPanel() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await logoutCurrentDevice();
      window.location.replace("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Logout failed.");
      setBusy(false);
    }
  };

  const change = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await changeOwnerPassword({ currentPassword, newPassword, confirmPassword });
      window.location.replace("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password change failed.");
      setBusy(false);
    }
  };

  return <section className="space-y-2 border-t border-ui pt-3" aria-label="Account security">
    <div className="flex gap-2">
      <button type="button" onClick={() => setOpen((value) => !value)} className="btn-secondary min-h-9 flex-1 px-3 text-xs font-medium" aria-expanded={open}>Change password</button>
      <button type="button" onClick={() => void logout()} disabled={busy} className="btn-secondary min-h-9 flex-1 px-3 text-xs font-medium">Log out</button>
    </div>
    {open ? <form onSubmit={change} className="space-y-2 rounded-lg bg-subtle p-3">
      <label className="block text-xs font-medium text-secondary">Current password<input type="password" autoComplete="current-password" required maxLength={1024} className="input-base mt-1 min-h-9 w-full px-2" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label className="block text-xs font-medium text-secondary">New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} className="input-base mt-1 min-h-9 w-full px-2" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
      <label className="block text-xs font-medium text-secondary">Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} className="input-base mt-1 min-h-9 w-full px-2" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      <button type="submit" disabled={busy} className="btn-primary min-h-9 w-full px-3 text-xs font-medium">Change password and log out all devices</button>
    </form> : null}
    {!open && error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
  </section>;
}
