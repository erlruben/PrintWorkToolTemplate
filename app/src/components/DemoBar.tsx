import { DEMO_ROLES, demoRole, setDemoRole, type DemoRole } from "../demo/demoFetch";
import { ROLE_LABEL } from "../lib/types";

/**
 * Demo mode strip shown while no Supabase project is set up.
 * Switching role reloads the app as that person; the sample data resets on reload
 * and nothing is saved.
 */
export default function DemoBar() {
  return (
    <div className="demo-bar" role="status">
      <strong>Demo mode</strong>
      <span className="demo-bar-note">
        Sample data · nothing is saved · reload to reset
      </span>
      <label className="demo-bar-role">
        View as
        <select
          value={demoRole()}
          onChange={(e) => {
            setDemoRole(e.target.value as DemoRole);
            window.location.reload();
          }}
        >
          {DEMO_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r] ?? r}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
