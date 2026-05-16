"use client";

import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { CostBreakdown } from "@/lib/orchestrator/types";
import { cn } from "@/lib/cn";
import { GithubIcon } from "@/components/ui/brand-icons";
import { VercelLogo } from "./vercel-logo";

const COMING_SOON = "Coming in Phase 1B";

export interface ActionBarProps {
  visible: boolean;
  cost?: CostBreakdown;
}

function formatUsd(n: number) {
  return `$${n.toFixed(2)}`;
}

function comingSoonAlert(label: string) {
  return () => alert(`${label} — coming in Phase 1B.`);
}

export function ActionBar({ visible, cost }: ActionBarProps) {
  return (
    <div
      className={cn(
        "shrink-0 transition-all duration-300 overflow-hidden border-t border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-[#0a0a0a]/85 backdrop-blur",
        visible ? "h-16 opacity-100" : "h-0 opacity-0 pointer-events-none",
      )}
    >
      <div className="h-16 px-4 sm:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 text-xs text-zinc-500 dark:text-zinc-500">
          <Badge tone="green">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Generated
          </Badge>
          {cost && (
            <div className="hidden md:flex items-center gap-1.5 tabular-nums truncate">
              <span>
                Plan{" "}
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {formatUsd(cost.plan)}
                </span>
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span>
                Copy{" "}
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {formatUsd(cost.copy)}
                </span>
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span>
                Images{" "}
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {formatUsd(cost.images)}
                </span>
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span>
                Code{" "}
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {formatUsd(cost.html)}
                </span>
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span>
                Total{" "}
                <span className="text-zinc-900 dark:text-zinc-100 font-semibold">
                  {formatUsd(cost.total)}
                </span>
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Tooltip label={COMING_SOON} side="top">
            <Button
              variant="outline"
              size="md"
              onClick={comingSoonAlert("Download .zip")}
            >
              <Download size={14} /> Download .zip
            </Button>
          </Tooltip>
          <Tooltip label={COMING_SOON} side="top">
            <Button
              variant="dark"
              size="md"
              onClick={comingSoonAlert("Deploy to Vercel")}
            >
              <VercelLogo size={12} /> Deploy to Vercel
            </Button>
          </Tooltip>
          <Tooltip label={COMING_SOON} side="top">
            <Button
              variant="primary"
              size="md"
              onClick={comingSoonAlert("Push to GitHub")}
            >
              <GithubIcon size={14} /> Push to GitHub
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
