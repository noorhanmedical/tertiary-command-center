import { useState } from "react";
import {
  Plus,
  Filter,
  SlidersHorizontal,
  Eye,
  Pencil,
  Trash2,
  Users,
  Phone,
  CalendarClock,
  Activity,
  Bell,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  // layout
  PlexusPage,
  PlexusPageInner,
  InteriorPageTitle,
  StructuralHeader,
  SectionTitle,
  PageToolbar,
  FrostedPanel,
  FeaturePanel,
  PlexusCard,
  // buttons
  PlexusButton,
  IconButton,
  // forms
  Field,
  TextField,
  Textarea,
  SearchInput,
  SelectDropdown,
  Checkbox,
  RadioGroup,
  Toggle,
  FilterButton,
  FilterChip,
  // status
  StatusBadge,
  CountBadge,
  RoleBadge,
  BillingStatus,
  // tabs
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  // metrics
  MetricStrip,
  MetricCard,
  ProgressBar,
  // data list
  DataList,
  DataListHeader,
  PatientRow,
  ScheduleRow,
  DocumentRow,
  BulkActionToolbar,
  // overlays
  Modal,
  ConfirmModal,
  Drawer,
  PlexusPopover,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  // feedback
  Alert,
  Toast,
  EmptyState,
  ErrorState,
  PermissionState,
  // skeletons
  SkeletonRow,
  SkeletonCard,
  SkeletonKpi,
  // navigation
  Breadcrumb,
  Accordion,
  Pagination,
  Stepper,
  Timeline,
  UploadArea,
  // date + chart
  DatePicker,
  ChartFrame,
  plexusChartPalette,
} from "@/components/plexus-ui";

/* ══════════════════════════════════════════════════════════════════════
   /ui-system-preview  (§78)
   Isolated, route-scoped gallery of the Plexus winter design system. Uses the
   real production-intended primitives from client/src/components/plexus-ui.
   No live page is touched by this route.
   ══════════════════════════════════════════════════════════════════════ */

function GallerySection({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-6">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: "var(--w-blue)" }}>
          {n}
        </span>
        <SectionTitle>{title}</SectionTitle>
      </div>
      {children}
    </section>
  );
}

const CHART_DATA = [
  { label: "Mon", visits: 24, calls: 18 },
  { label: "Tue", visits: 31, calls: 22 },
  { label: "Wed", visits: 28, calls: 26 },
  { label: "Thu", visits: 35, calls: 20 },
  { label: "Fri", visits: 30, calls: 24 },
];

export default function UiSystemPreviewPage() {
  const [search, setSearch] = useState("");
  const [ehrSearch, setEhrSearch] = useState("");
  const [selectValue, setSelectValue] = useState<string>();
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState("outreach");
  const [toggle, setToggle] = useState(true);
  const [tab, setTab] = useState("overview");
  const [date, setDate] = useState<Date>();
  const [page, setPage] = useState(2);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ehrDrawerOpen, setEhrDrawerOpen] = useState(false);
  const [showToast, setShowToast] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set(["p1"]));
  const [chips, setChips] = useState(["Active", "Needs intake"]);

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const rowActions = [
    { label: "View", icon: Eye },
    { label: "Edit", icon: Pencil },
    { label: "Delete", icon: Trash2, destructive: true },
  ];

  return (
    <PlexusPage>
      {showToast && (
        <div className="fixed right-6 top-6 z-[70]">
          <Toast
            tone="success"
            title="Preview loaded"
            description="All primitives are live and interactive."
            onDismiss={() => setShowToast(false)}
          />
        </div>
      )}

      <PlexusPageInner className="flex flex-col gap-10">
        {/* 45. Breadcrumb (above title, does not duplicate it) */}
        <Breadcrumb
          items={[{ label: "Design", href: "#" }, { label: "UI System Preview" }]}
        />

        {/* 1 + 2. Interior Page Title + Subtitle */}
        <div>
          <InteriorPageTitle title="UI System Preview" subtitle="Plexus Winter Design System" />
          {/* Route-isolation note as a normal-flow caption (not a second subtitle). */}
          <Alert tone="info" className="mt-1">
            Isolated route · uses production primitives · no live page affected
          </Alert>
        </div>

        {/* 3. Dark Structural Header */}
        <GallerySection n="03" title="Dark Structural Header">
          <StructuralHeader title="Mission Control" subtitle="Taylor Family Practice" icon={<Activity className="size-5" />} />
        </GallerySection>

        {/* 4. Page Toolbar */}
        <GallerySection n="04" title="Page Toolbar">
          <PageToolbar
            actions={<PlexusButton icon={Plus}>Add Patient</PlexusButton>}
          >
            <SearchInput className="w-56" value={search} onChange={setSearch} placeholder="Search patients" />
            <FilterButton icon={Filter} count={2}>Filters</FilterButton>
            <FilterButton icon={SlidersHorizontal}>Status</FilterButton>
          </PageToolbar>
        </GallerySection>

        {/* 5-9. Buttons */}
        <GallerySection n="05–09" title="Buttons">
          <FrostedPanel className="flex flex-wrap items-center gap-3 p-6">
            <PlexusButton variant="primary" icon={Plus}>Primary</PlexusButton>
            <PlexusButton variant="secondary">Secondary</PlexusButton>
            <PlexusButton variant="tertiary">Tertiary</PlexusButton>
            <PlexusButton variant="destructive">Destructive</PlexusButton>
            <PlexusButton variant="primary" loading>Loading</PlexusButton>
            <PlexusButton variant="primary" disabled>Disabled</PlexusButton>
            <IconButton icon={Bell} label="Notifications" />
          </FrostedPanel>
        </GallerySection>

        {/* 10-16. Form controls */}
        <GallerySection n="10–16" title="Inputs, Search, Textarea, Dropdown, Checkbox, Radio, Toggle">
          <FrostedPanel className="grid gap-5 p-6 md:grid-cols-2">
            <Field label="Text Input" htmlFor="pv-text" helper="Helper text sits under the field.">
              <TextField id="pv-text" placeholder="Jane Doe" />
            </Field>
            <Field label="Search Input" htmlFor="pv-search">
              <SearchInput value={search} onChange={setSearch} placeholder="Search" />
            </Field>
            <Field label="Textarea" htmlFor="pv-textarea">
              <Textarea id="pv-textarea" placeholder="Clinical notes…" />
            </Field>
            <Field label="Dropdown" htmlFor="pv-select">
              <SelectDropdown
                ariaLabel="Status"
                value={selectValue}
                onValueChange={setSelectValue}
                placeholder="Select status"
                options={[
                  { value: "active", label: "Active" },
                  { value: "pending", label: "Pending" },
                  { value: "review", label: "In review" },
                ]}
              />
            </Field>
            <Field label="Text Input — Error" htmlFor="pv-err" error="Enter a valid MRN.">
              <TextField id="pv-err" defaultValue="12" invalid />
            </Field>
            <div className="flex flex-col gap-4">
              <Checkbox id="pv-cb" checked={checked} onCheckedChange={setChecked} label="Checkbox option" />
              <RadioGroup
                name="mode"
                value={radio}
                onValueChange={setRadio}
                options={[
                  { value: "outreach", label: "Outreach" },
                  { value: "visit", label: "Visit" },
                ]}
              />
              <Toggle id="pv-toggle" checked={toggle} onCheckedChange={setToggle} label="Enable notifications" />
            </div>
          </FrostedPanel>
        </GallerySection>

        {/* 17-18. Filter button + chips */}
        <GallerySection n="17–18" title="Filter Button & Chips">
          <FrostedPanel className="flex flex-wrap items-center gap-3 p-6">
            <FilterButton icon={Filter} count={chips.length}>Filters</FilterButton>
            {chips.map((c) => (
              <FilterChip key={c} label={c} onRemove={() => setChips((p) => p.filter((x) => x !== c))} />
            ))}
          </FrostedPanel>
        </GallerySection>

        {/* 19. Tabs */}
        <GallerySection n="19" title="Tabs">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="billing">Billing</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <PlexusCard tone="secondary" className="text-[13px]">Overview panel content.</PlexusCard>
            </TabsContent>
            <TabsContent value="history">
              <PlexusCard tone="secondary" className="text-[13px]">History panel content.</PlexusCard>
            </TabsContent>
            <TabsContent value="billing">
              <PlexusCard tone="secondary" className="text-[13px]">Billing panel content.</PlexusCard>
            </TabsContent>
          </Tabs>
        </GallerySection>

        {/* 20. Date Picker */}
        <GallerySection n="20" title="Date Picker">
          <DatePicker value={date} onChange={setDate} />
        </GallerySection>

        {/* 21-24. Cards + frost variants + dark feature */}
        <GallerySection n="21–24" title="Cards, Primary/Secondary Frost, Dark Feature Panel">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <PlexusCard>
              <div className="text-[14px] font-semibold" style={{ color: "var(--w-text)" }}>Primary Card</div>
              <p className="mt-1 text-[13px]" style={{ color: "var(--w-text-2)" }}>White surface, hairline edge.</p>
            </PlexusCard>
            <FrostedPanel variant="primary" className="p-6">
              <div className="text-[14px] font-semibold">Primary Frost</div>
              <p className="mt-1 text-[13px]" style={{ color: "var(--w-text-2)" }}>rgba white 0.74, blur 18.</p>
            </FrostedPanel>
            <FrostedPanel variant="secondary" className="p-6">
              <div className="text-[14px] font-semibold">Secondary Frost</div>
              <p className="mt-1 text-[13px]" style={{ color: "var(--w-text-2)" }}>rgba white 0.58, blur 16.</p>
            </FrostedPanel>
            <FeaturePanel>
              <div className="text-[14px] font-semibold">Dark Feature</div>
              <p className="mt-1 text-[13px] text-white/70">Navy/near-black, white text.</p>
            </FeaturePanel>
          </div>
        </GallerySection>

        {/* 25-28. Rows + list */}
        <GallerySection n="25–28" title="Patient / Schedule / Document Rows & List">
          <div className="flex flex-col gap-6">
            <DataList ariaLabel="Patients">
              <DataListHeader>Patients</DataListHeader>
              <PatientRow
                name="Marcus Webb"
                mrn="A-10293"
                demographics="48 · M"
                status="Ready"
                statusTone="ready"
                reviewCount={2}
                selectable
                selected={selectedRows.has("p1")}
                onSelectedChange={() => toggleRow("p1")}
                actions={rowActions}
              />
              <PatientRow
                name="Elena Ruiz"
                mrn="A-10471"
                demographics="63 · F"
                status="Needs Intake"
                statusTone="needs-intake"
                selectable
                selected={selectedRows.has("p2")}
                onSelectedChange={() => toggleRow("p2")}
                actions={rowActions}
              />
            </DataList>
            <BulkActionToolbar count={selectedRows.size} onClear={() => setSelectedRows(new Set())}>
              <PlexusButton variant="secondary" size="sm">Assign</PlexusButton>
              <PlexusButton variant="destructive-soft" size="sm">Archive</PlexusButton>
            </BulkActionToolbar>
            <DataList ariaLabel="Schedule">
              <DataListHeader>Schedule</DataListHeader>
              <ScheduleRow time="09:00" patient="Marcus Webb" visitType="Follow-up" provider="Dr. Lin" status="Scheduled" statusTone="scheduled" actions={rowActions} />
              <ScheduleRow time="09:30" patient="Elena Ruiz" visitType="New patient" provider="Dr. Amara" status="Completed" statusTone="completed" actions={rowActions} />
            </DataList>
            <DataList ariaLabel="Documents">
              <DataListHeader>Documents</DataListHeader>
              <DocumentRow name="Referral_Webb.pdf" type="Referral" owner="Front desk" uploadedDate="Aug 28" status="Ready" statusTone="ready" actions={rowActions} />
            </DataList>
          </div>
        </GallerySection>

        {/* 29-32. Badges + metrics */}
        <GallerySection n="29–32" title="Status / Count Badges, KPI Metric, Metric Strip">
          <FrostedPanel className="flex flex-col gap-5 p-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusBadge tone="ready">Ready</StatusBadge>
              <StatusBadge tone="pending">Pending</StatusBadge>
              <StatusBadge tone="review">Review</StatusBadge>
              <StatusBadge tone="scheduled">Scheduled</StatusBadge>
              <StatusBadge tone="blocked">Blocked</StatusBadge>
              <BillingStatus status="paid" />
              <BillingStatus status="denied" />
              <CountBadge count={12} />
              <CountBadge count={3} tone="blue" />
              <RoleBadge>Admin</RoleBadge>
            </div>
          </FrostedPanel>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <MetricCard label="Patients" value="1,284" icon={Users} delta={{ value: "4.2%", direction: "up" }} />
            <MetricCard label="Calls today" value="96" icon={Phone} delta={{ value: "1.1%", direction: "down" }} />
            <MetricCard label="Scheduled" value="42" icon={CalendarClock} />
          </div>
          <MetricStrip
            className="mt-4"
            metrics={[
              { label: "Ready", value: 128 },
              { label: "In review", value: 34 },
              { label: "Blocked", value: 6 },
              { label: "Completed", value: 512 },
            ]}
          />
        </GallerySection>

        {/* 33-38. Overlays + feedback */}
        <GallerySection n="33–38" title="Modal, Drawer, Popover, Tooltip, Toast, Alert">
          <FrostedPanel className="flex flex-wrap items-center gap-3 p-6">
            <PlexusButton variant="secondary" onClick={() => setModalOpen(true)}>Open Modal</PlexusButton>
            <PlexusButton variant="secondary" onClick={() => setConfirmOpen(true)}>Confirm Modal</PlexusButton>
            <PlexusButton variant="secondary" onClick={() => setDrawerOpen(true)}>Open Drawer</PlexusButton>
            <PlexusPopover trigger={<PlexusButton variant="secondary">Open Popover</PlexusButton>}>
              <div className="text-[13px]" style={{ color: "var(--w-text)" }}>
                Concise contextual detail lives here.
              </div>
            </PlexusPopover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PlexusButton variant="tertiary">Hover for tooltip</PlexusButton>
              </TooltipTrigger>
              <TooltipContent>Tooltip content</TooltipContent>
            </Tooltip>
            <PlexusButton variant="tertiary" onClick={() => setShowToast(true)}>Show Toast</PlexusButton>
          </FrostedPanel>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Alert tone="info" title="Info">Restrained informational banner.</Alert>
            <Alert tone="success" title="Success">Change saved.</Alert>
            <Alert tone="warning" title="Warning">Review needed before submit.</Alert>
            <Alert tone="error" title="Error">Could not reach the server.</Alert>
          </div>
        </GallerySection>

        {/* 39-42. Empty / loading / error / permission states */}
        <GallerySection n="39–42" title="Empty, Loading Skeleton, Error, Permission States">
          <div className="grid gap-4 lg:grid-cols-2">
            <PlexusCard><EmptyState kind="no-results" title="No results" message="Try adjusting your filters." action={<PlexusButton variant="secondary" size="sm">Clear filters</PlexusButton>} /></PlexusCard>
            <PlexusCard><ErrorState message="We couldn't load this list." onRetry={() => {}} /></PlexusCard>
            <PlexusCard><PermissionState variant="read-only" /></PlexusCard>
            <PlexusCard className="space-y-3">
              <SkeletonKpi />
              <SkeletonRow />
              <SkeletonRow />
            </PlexusCard>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </GallerySection>

        {/* 43-44. Pagination + accordion */}
        <GallerySection n="43–44" title="Pagination & Accordion">
          <FrostedPanel className="p-6">
            <Pagination page={page} pageCount={8} total={192} onPageChange={setPage} />
          </FrostedPanel>
          <div className="mt-4">
            <Accordion
              items={[
                { value: "a", title: "Insurance details", content: "Optional detail revealed on expand." },
                { value: "b", title: "Care history", content: "Another collapsible section." },
              ]}
            />
          </div>
        </GallerySection>

        {/* 46-50. Upload, Stepper, Progress */}
        <GallerySection n="46–50" title="Upload Area, Stepper, Progress Bar">
          <div className="grid gap-4 lg:grid-cols-2">
            <UploadArea files={[{ name: "chart_export.pdf", size: "1.2 MB" }]} onRemove={() => {}} />
            <div className="flex flex-col gap-6">
              <Stepper current={1} steps={[{ label: "Intake" }, { label: "Qualify" }, { label: "Schedule" }, { label: "Bill" }]} />
              <ProgressBar value={64} showPercent label="Onboarding" />
              <ProgressBar indeterminate label="Syncing…" />
            </div>
          </div>
        </GallerySection>

        {/* 49-51. Chart */}
        <GallerySection n="51" title="Chart">
          <ChartFrame
            title="Weekly activity"
            summary="Bar chart of visits and calls Monday through Friday."
            legend={[{ label: "Visits" }, { label: "Calls" }]}
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={CHART_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E3EAF2" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#7E8CA1", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#7E8CA1", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Bar dataKey="visits" fill={plexusChartPalette[0]} radius={[6, 6, 0, 0]} />
                <Bar dataKey="calls" fill={plexusChartPalette[1]} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </GallerySection>

        {/* 50-51. Activity timeline + audit/history */}
        <GallerySection n="53–54" title="Activity Timeline & Audit / History">
          <div className="grid gap-4 lg:grid-cols-2">
            <PlexusCard>
              <Timeline
                entries={[
                  { timestamp: "Aug 31, 09:14", actor: "Dr. Lin", action: "completed visit", detail: "Follow-up" },
                  { timestamp: "Aug 30, 16:02", actor: "Front desk", action: "scheduled appointment" },
                  { timestamp: "Aug 29, 11:47", actor: "System", action: "created record" },
                ]}
              />
            </PlexusCard>
            <PlexusCard>
              <Timeline
                entries={[
                  { timestamp: "Aug 31, 09:20", actor: "admin", action: "changed status", detail: "Pending → Ready" },
                  { timestamp: "Aug 31, 08:55", actor: "biller", action: "submitted claim", detail: "Claim #4821" },
                ]}
              />
            </PlexusCard>
          </div>
        </GallerySection>

        {/* 52. Representative interior-page composition: Patient EHR */}
        <GallerySection n="52" title="Interior Page Composition — Patient EHR">
          <div className="plexus-card overflow-hidden p-0">
            <div className="p-6 md:p-8">
              <InteriorPageTitle title="Patient EHR" subtitle="Taylor Family Practice" />
              <MetricStrip
                className="mb-6"
                metrics={[
                  { label: "Active", value: 84 },
                  { label: "Needs intake", value: 12 },
                  { label: "In review", value: 7 },
                ]}
              />
              <PageToolbar
                className="mb-5"
                actions={<PlexusButton icon={Plus}>Add Patient</PlexusButton>}
              >
                <SearchInput className="w-56" value={ehrSearch} onChange={setEhrSearch} placeholder="Search patients" />
                <FilterButton icon={Filter}>Filters</FilterButton>
                <FilterButton icon={SlidersHorizontal}>Status</FilterButton>
              </PageToolbar>
              <DataList ariaLabel="Patient list">
                <PatientRow name="Marcus Webb" mrn="A-10293" demographics="48 · M" status="Ready" statusTone="ready" reviewCount={2} onOpen={() => setEhrDrawerOpen(true)} actions={rowActions} />
                <PatientRow name="Elena Ruiz" mrn="A-10471" demographics="63 · F" status="Needs Intake" statusTone="needs-intake" onOpen={() => setEhrDrawerOpen(true)} actions={rowActions} />
                <PatientRow name="Priya Nair" mrn="A-10588" demographics="35 · F" status="Review" statusTone="review" reviewCount={1} onOpen={() => setEhrDrawerOpen(true)} actions={rowActions} />
              </DataList>
            </div>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--w-text-muted)" }}>
            Row click opens the right-side patient detail drawer. The live Patient EHR page is not modified.
          </p>
        </GallerySection>
      </PlexusPageInner>

      {/* Overlay instances */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Add Patient"
        description="Create a new patient record."
        footer={
          <>
            <PlexusButton variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancel</PlexusButton>
            <PlexusButton size="sm" onClick={() => setModalOpen(false)}>Save Changes</PlexusButton>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Full name" htmlFor="m-name"><TextField id="m-name" placeholder="Jane Doe" /></Field>
          <Field label="MRN" htmlFor="m-mrn"><TextField id="m-mrn" placeholder="A-00000" /></Field>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Archive patient?"
        message="This will archive the record for Marcus Webb. You can restore it later."
        confirmLabel="Archive patient"
        destructive
        onConfirm={() => {}}
      />

      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Patient detail"
        footer={<PlexusButton size="sm" className="w-full">Save Changes</PlexusButton>}
      >
        <div className="flex flex-col gap-4">
          <StatusBadge tone="ready">Ready</StatusBadge>
          <Field label="Notes" htmlFor="d-notes"><Textarea id="d-notes" placeholder="Contextual notes…" /></Field>
        </div>
      </Drawer>

      <Drawer open={ehrDrawerOpen} onOpenChange={setEhrDrawerOpen} title="Marcus Webb">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <StatusBadge tone="ready">Ready</StatusBadge>
            <span className="text-[13px]" style={{ color: "var(--w-text-muted)" }}>MRN A-10293 · 48 · M</span>
          </div>
          <Timeline
            entries={[
              { timestamp: "Aug 31, 09:14", actor: "Dr. Lin", action: "completed visit" },
              { timestamp: "Aug 29, 11:47", actor: "System", action: "created record" },
            ]}
          />
        </div>
      </Drawer>
    </PlexusPage>
  );
}
