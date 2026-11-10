import { AppChrome } from "@/components/app-chrome";
import { SyncProvider } from "@/lib/sync/provider";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SyncProvider>
      <AppChrome>{children}</AppChrome>
    </SyncProvider>
  );
}
