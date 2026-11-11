import { CameraHandTrackingPreview } from "@/shared/components/camera/CameraHandTrackingPreview";

/** Independent hand-tracking lab (not linked from Home). */
export default function CameraPage() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-black">
      <h1 className="sr-only">Camera hand-tracking lab</h1>
      <CameraHandTrackingPreview />
    </main>
  );
}
