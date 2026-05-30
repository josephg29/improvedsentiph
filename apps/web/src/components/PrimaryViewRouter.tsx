import type { ComponentProps } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { ActivityPrimaryView } from "./ActivityPrimaryView";
import { CanvasPrimaryView } from "./CanvasPrimaryView";
import { PipelinesPrimaryView } from "./PipelinesPrimaryView";
import { SettingsPrimaryView } from "./SettingsPrimaryView";

type PrimaryViewRouterProps = {
  activePrimaryNav: PrimaryNavIndex;
  activityPrimaryViewProps: ComponentProps<typeof ActivityPrimaryView>;
  settingsPrimaryViewProps: ComponentProps<typeof SettingsPrimaryView>;
  canvasPrimaryViewProps: ComponentProps<typeof CanvasPrimaryView>;
};

// The Agents canvas (1) stays mounted behind the active view so terminal
// WebSocket/xterm instances survive nav switches; Pipelines (2), Activity (3)
// and Settings (8) render on top when selected.
const OVERLAY_NAVS = new Set<PrimaryNavIndex>([2, 3, 8]);
const isCanvasNav = (nav: PrimaryNavIndex) => !OVERLAY_NAVS.has(nav);

export const PrimaryViewRouter = ({
  activePrimaryNav,
  activityPrimaryViewProps,
  settingsPrimaryViewProps,
  canvasPrimaryViewProps,
}: PrimaryViewRouterProps) => {
  const canvasActive = isCanvasNav(activePrimaryNav);

  return (
    <div className="primary-view-router">
      <div
        className={`primary-view-canvas-slot${canvasActive ? "" : " primary-view-canvas-slot--hidden"}`}
        aria-hidden={!canvasActive}
      >
        <CanvasPrimaryView {...canvasPrimaryViewProps} />
      </div>

      {activePrimaryNav === 2 && <PipelinesPrimaryView />}

      {activePrimaryNav === 3 && <ActivityPrimaryView {...activityPrimaryViewProps} />}

      {activePrimaryNav === 8 && <SettingsPrimaryView {...settingsPrimaryViewProps} />}
    </div>
  );
};
