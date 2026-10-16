import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronDown, ChevronRight, Copy, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ASSIGNABLE_ROLE_GROUPS,
  ROLE_META,
  TIER_LABELS,
  getRoleFullLabel,
  type AppRole,
  type RoleModuleKey,
} from "@/lib/roleCatalog";

export interface RoleSourceUser {
  id: string;
  user_id: string;
  full_name: string;
  roles: AppRole[];
}

interface RoleAssignmentPanelProps {
  selected: AppRole[];
  onChange: (roles: AppRole[]) => void;
  /** Users whose roles can be copied. The user being edited should be excluded by the caller. */
  copySources?: RoleSourceUser[];
}

const TIER_BADGE: Record<string, string> = {
  manager: "border-blue-500/30 text-blue-600",
  officer: "border-emerald-500/30 text-emerald-600",
  viewer: "border-slate-400/40 text-slate-500",
  special: "border-amber-500/30 text-amber-600",
};

export function RoleAssignmentPanel({ selected, onChange, copySources }: RoleAssignmentPanelProps) {
  const [search, setSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  // Open the modules the user already has roles in.
  const [expanded, setExpanded] = useState<Set<RoleModuleKey>>(
    () => new Set(selected.map((r) => ROLE_META[r]?.module).filter(Boolean) as RoleModuleKey[])
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const term = search.trim().toLowerCase();

  const visibleGroups = useMemo(() => {
    return ASSIGNABLE_ROLE_GROUPS.map((g) => {
      const moduleMatches = term !== "" && g.label.toLowerCase().includes(term);
      const roles = g.roles.filter((r) => {
        if (selectedOnly && !selectedSet.has(r)) return false;
        if (term === "" || moduleMatches) return true;
        const m = ROLE_META[r];
        return (
          m.label.toLowerCase().includes(term) ||
          m.description.toLowerCase().includes(term) ||
          r.replace(/_/g, " ").includes(term) ||
          TIER_LABELS[m.tier].toLowerCase().includes(term)
        );
      });
      return { ...g, roles };
    }).filter((g) => g.roles.length > 0);
  }, [term, selectedOnly, selectedSet]);

  const toggleRole = (role: AppRole, checked: boolean) => {
    if (checked) onChange(selectedSet.has(role) ? selected : [...selected, role]);
    else onChange(selected.filter((r) => r !== role));
  };

  const toggleModule = (key: RoleModuleKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copyFrom = (source: RoleSourceUser) => {
    const merged = [...selected];
    for (const r of source.roles) {
      if (!merged.includes(r) && ROLE_META[r] && ASSIGNABLE_ROLE_GROUPS.some((g) => g.key === ROLE_META[r].module)) {
        merged.push(r);
      }
    }
    onChange(merged);
    setExpanded((prev) => {
      const next = new Set(prev);
      source.roles.forEach((r) => ROLE_META[r] && next.add(ROLE_META[r].module));
      return next;
    });
    setCopyOpen(false);
  };

  // While searching, show every matching module open.
  const isOpen = (key: RoleModuleKey) => term !== "" || selectedOnly || expanded.has(key);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search roles, modules or descriptions (e.g. gate, approve, viewer)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {copySources && copySources.length > 0 && (
          <Popover open={copyOpen} onOpenChange={setCopyOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="shrink-0">
                <Copy className="h-4 w-4 mr-2" />
                Copy from user
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[320px]" align="end">
              <Command>
                <CommandInput placeholder="Search user…" />
                <CommandList>
                  <CommandEmpty>No users found.</CommandEmpty>
                  <CommandGroup heading="Adds their roles to the current selection">
                    {copySources.map((u) => (
                      <CommandItem
                        key={u.id}
                        value={`${u.full_name} ${u.user_id}`}
                        onSelect={() => copyFrom(u)}
                      >
                        <div className="flex flex-col">
                          <span className="text-sm">{u.full_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {u.user_id} · {u.roles.length} role{u.roles.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch id="roles-selected-only" checked={selectedOnly} onCheckedChange={setSelectedOnly} />
          <Label htmlFor="roles-selected-only" className="text-sm cursor-pointer">
            Show selected only
          </Label>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(new Set(ASSIGNABLE_ROLE_GROUPS.map((g) => g.key)))}
          >
            Expand all
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>
            Collapse all
          </Button>
        </div>
      </div>

      {/* Selected chips */}
      <div className="rounded-md border bg-muted/30 p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">
            Selected roles ({selected.length})
          </span>
          {selected.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => onChange([])}
            >
              Clear all
            </Button>
          )}
        </div>
        {selected.length === 0 ? (
          <p className="text-xs text-muted-foreground">No roles selected.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selected.map((r) => (
              <Badge key={r} variant="outline" className={cn("gap-1 pr-1", ROLE_META[r]?.color)}>
                {getRoleFullLabel(r)}
                <button
                  type="button"
                  aria-label={`Remove ${getRoleFullLabel(r)}`}
                  className="rounded-sm hover:bg-foreground/10"
                  onClick={() => toggleRole(r, false)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Module groups */}
      <div className="rounded-md border divide-y max-h-[45vh] overflow-y-auto">
        {visibleGroups.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground text-center">No roles match your search.</p>
        )}
        {visibleGroups.map((g) => {
          const total = ASSIGNABLE_ROLE_GROUPS.find((x) => x.key === g.key)?.roles ?? [];
          const count = total.filter((r) => selectedSet.has(r)).length;
          const open = isOpen(g.key);
          return (
            <div key={g.key}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/50"
                onClick={() => toggleModule(g.key)}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {g.label}
                </span>
                <Badge variant={count > 0 ? "default" : "secondary"} className="text-xs">
                  {count}/{total.length}
                </Badge>
              </button>
              {open && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 px-3 pb-3">
                  {g.roles.map((r) => {
                    const meta = ROLE_META[r];
                    return (
                      <label
                        key={r}
                        className={cn(
                          "flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/50",
                          selectedSet.has(r) && "border-primary/50 bg-primary/5"
                        )}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={selectedSet.has(r)}
                          onCheckedChange={(c) => toggleRole(r, c === true)}
                        />
                        <span className="space-y-0.5">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            {meta.label}
                            <Badge variant="outline" className={cn("h-4 px-1 text-[10px]", TIER_BADGE[meta.tier])}>
                              {TIER_LABELS[meta.tier]}
                            </Badge>
                          </span>
                          <span className="block text-xs text-muted-foreground">{meta.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
