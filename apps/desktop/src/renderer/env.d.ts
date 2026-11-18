import type { DesktopApi } from "@automation-studio/shared-types";

declare global {
  interface Window {
    api: DesktopApi;
  }
}
