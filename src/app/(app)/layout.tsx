import { AppChrome } from "@/components/app-chrome";
import { OfflinePrecache } from "@/components/pwa";
import { SyncProvider } from "@/lib/sync/provider";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SyncProvider>
      <OfflinePrecache />
      <AppChrome>{children}</AppChrome>
    </SyncProvider>
  );
}
