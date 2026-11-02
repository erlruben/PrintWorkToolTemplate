import { DEMO_ROLES, demoRole, setDemoRole, type DemoRole } from "../demo/demoFetch";
import { ROLE_LABEL } from "../lib/types";

export type DemoDevice = "phone" | "tablet" | "computer";

const DEVICES: { value: DemoDevice; label: string }[] = [
  { value: "phone", label: "Phone" },
  { value: "tablet", label: "Tablet" },
  { value: "computer", label: "Computer" },
];

/**
 * Demo mode strip shown while no Supabase project is set up.
 * The outer demo preview can reload its embedded app when the role changes.
 */
export default function DemoBar({
  device,
  onDeviceChange,
  onRoleChange,
}: {
  device: DemoDevice;
  onDeviceChange: (device: DemoDevice) => void;
  onRoleChange: () => void;
}) {
  return (
    <div className="demo-bar" role="status">
      <strong>Demo mode</strong>
      <span className="demo-bar-note">
        Sample data · nothing is saved · reload to reset
      </span>
      <div className="demo-bar-controls">
        <label className="demo-bar-role">
          View as
          <select
            value={demoRole()}
            onChange={(e) => {
              setDemoRole(e.target.value as DemoRole);
              onRoleChange();
            }}
          >
            {DEMO_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r] ?? r}
              </option>
            ))}
          </select>
        </label>
        <label className="demo-bar-device">
          View on
          <select
            value={device}
            onChange={(e) => onDeviceChange(e.target.value as DemoDevice)}
          >
            {DEVICES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
