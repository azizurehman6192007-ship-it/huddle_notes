import { requireMembership } from "@/lib/auth";
import { ToastProvider } from "@/components/ui/Toast";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects a signed-in user with no team to /welcome.
  await requireMembership();

  return <ToastProvider>{children}</ToastProvider>;
}
