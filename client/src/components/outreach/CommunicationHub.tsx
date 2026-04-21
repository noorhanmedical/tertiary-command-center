import { Mail, Megaphone } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OutreachCallItem } from "./types";
import { EmailComposer } from "./EmailComposer";
import { MaterialsPanel } from "./MaterialsPanel";

export function CommunicationHub({
  selectedItem, facility, onExpandEmail, onExpandMaterials,
}: {
  selectedItem: OutreachCallItem | null;
  facility: string;
  onExpandEmail?: () => void;
  onExpandMaterials?: () => void;
}) {
  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Mail className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold text-slate-800">Communication hub</h2>
      </div>
      <Tabs defaultValue="email" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="email" className="text-xs" data-testid="hub-tab-email">
            <Mail className="h-3 w-3 mr-1" /> Email
          </TabsTrigger>
          <TabsTrigger value="materials" className="text-xs" data-testid="hub-tab-materials">
            <Megaphone className="h-3 w-3 mr-1" /> Materials
          </TabsTrigger>
        </TabsList>
        <TabsContent value="email" className="mt-3">
          <EmailComposer selectedItem={selectedItem} facility={facility} onExpand={onExpandEmail} />
        </TabsContent>
        <TabsContent value="materials" className="mt-3">
          <MaterialsPanel selectedItem={selectedItem} onExpand={onExpandMaterials} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
