import type { AirSetupSummary } from "@studio/shared";
import { describeAirSetup } from "./lib/air-setup";

const STEP_ICON: Record<AirSetupSummary["steps"][number]["state"], string> = { pending: "○", running: "◐", done: "✓", failed: "✕" };

/** The installation of the second machine: which of the seven steps it is at, the model download, and whether the Air has been heard from. */
export function AirSetupPanel({ setup }: { setup: AirSetupSummary }) {
  const view = describeAirSetup(setup);
  return (
    <div className="balancer-panel air-setup" aria-live="polite">
      <h3>{view.title}</h3>
      <p className="microcopy">{view.message}</p>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent} aria-label="Tiến trình cài máy Air">
        <i style={{ width: `${view.percent}%` }} />
      </div>
      <ol className="air-setup-steps">
        {view.steps.map((step) => (
          <li key={step.id} className={`air-step air-step-${step.state}`}>
            <span aria-hidden="true">{STEP_ICON[step.state]}</span>
            <div>
              <strong>{step.name}</strong>
              {step.detail ? <small>{step.detail}</small> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

