import { PlexusDrive } from "@/components/PlexusDrive";

export default function DrivePage() {
  return (
    <div className="flex flex-col h-full overflow-auto bg-background">
      <div className="max-w-6xl mx-auto w-full px-6 py-8">
        <PlexusDrive />
      </div>
    </div>
  );
}
