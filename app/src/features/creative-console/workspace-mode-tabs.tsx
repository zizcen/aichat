import { AudioLines, ImageIcon, MessageSquareText, Video, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CreativeMode = "chat" | "image" | "video" | "voice";

export type SegmentedTabItem = {
  value: string;
  label: string;
  icon: LucideIcon;
};

export function SegmentedTabs(props: {
  value?: string;
  items: readonly SegmentedTabItem[];
  ariaLabel?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Tabs value={props.value} onValueChange={props.onChange}>
      <TabsList aria-label={props.ariaLabel} className="segmented-tabs-list h-9 w-full rounded-full bg-secondary/50 p-1">
        {props.items.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} className="segmented-tab-trigger flex-1 gap-1.5 whitespace-nowrap rounded-full px-3 [&_svg]:size-3.5" value={value}>
            <Icon />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function WorkspaceModeTabs(props: {
  value?: CreativeMode;
  onChange: (mode: CreativeMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <SegmentedTabs
      value={props.value}
      onChange={(value) => {
        if (value === "chat" || value === "image" || value === "video" || value === "voice")
          props.onChange(value);
      }}
      ariaLabel="创作模式"
      items={[
        { value: "chat", label: t("creativeConsole.modes.chat"), icon: MessageSquareText },
        { value: "image", label: t("creativeConsole.modes.image"), icon: ImageIcon },
        { value: "video", label: t("creativeConsole.modes.video"), icon: Video },
        { value: "voice", label: t("creativeConsole.modes.voice"), icon: AudioLines },
      ]}
    />
  );
}
