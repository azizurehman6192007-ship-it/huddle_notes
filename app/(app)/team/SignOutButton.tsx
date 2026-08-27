"use client";

import { Button } from "@/components/ui/Button";

/** Submits the enclosing form to /api/auth/signout. */
export function SignOutButton() {
  return (
    <Button type="submit" variant="secondary" size="sm">
      Sign out
    </Button>
  );
}
