import { Boxes, Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import { cn } from "@/shared/lib/cn";
import { detectModelProvider, getVisibleModelProviders, type ModelProviderId } from "./model-provider-icons";

export type ModelProviderSelectProps = {
  value: string;
  models: ModelRouteDTO[];
  onChange: (model: string) => void;
};

/** Render a local provider mark as a monochrome mask so it follows the theme. */
function ProviderMark({ provider }: { provider: ModelProviderId }) {
  if (provider === "other") return <Boxes className="model-provider-mark model-provider-mark-fallback" aria-hidden="true" />;
  return <span className={cn("model-provider-mark", `model-provider-mark-${provider}`)} aria-hidden="true" />;
}

/**
 * Compact model picker shared by chat, image, video, and voice composers.
 * The closed control contains one provider mark only. Opening it reveals a
 * short, grouped model list so long model IDs never consume phone width.
 */
export function ModelProviderSelect({ value, models, onChange }: ModelProviderSelectProps) {
  const { t } = useTranslation();
  const groups = useMemo(() => getVisibleModelProviders(models), [models]);
  const detectedValueProvider = value ? detectModelProvider(value) : null;
  const currentGroup = groups.find((group) => group.id === detectedValueProvider) ?? groups[0];
  const [open, setOpen] = useState(false);

  // Close a stale menu when switching panel capability removes its models.
  useEffect(() => {
    if (!currentGroup) setOpen(false);
  }, [currentGroup]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="model-provider-trigger"
              aria-label={currentGroup ? `${t("creativeConsole.model")} · ${currentGroup.label}` : t("creativeConsole.selectModel")}
              title={value || t("creativeConsole.selectModel")}
              disabled={models.length === 0}
            >
              <ProviderMark provider={currentGroup?.id ?? "other"} />
              <ChevronDown className="model-provider-trigger-chevron" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{currentGroup?.label ?? t("creativeConsole.noModels")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" side="top" className="model-provider-menu">
        <div className="model-provider-menu-list" role="listbox" aria-label={t("creativeConsole.model")}>
          {groups.map((group) => (
            <section key={group.id} className="model-provider-group">
              <div className="model-provider-group-heading">
                <ProviderMark provider={group.id} />
                <span>{group.label}</span>
                <span className="model-provider-group-count">{group.models.length}</span>
              </div>
              <div className="model-provider-group-models">
                {group.models.map((item) => {
                  const selected = item.publicId === value;
                  return (
                    <button
                      key={item.publicId}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn("model-provider-option", selected && "selected")}
                      onClick={() => {
                        onChange(item.publicId);
                        setOpen(false);
                      }}
                    >
                      <span className="model-provider-option-name" title={item.publicId}>{item.publicId}</span>
                      {selected ? <Check className="model-provider-option-check" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

