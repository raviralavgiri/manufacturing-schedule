import { Sun, Moon, Monitor } from "lucide-react";
import { clsx } from "clsx";
import { useTheme, type ThemeChoice } from "../utils/theme";

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun size={12} /> },
  { value: "dark", label: "Dark", icon: <Moon size={12} /> },
  { value: "system", label: "Auto", icon: <Monitor size={12} /> },
];

/** Three-way segmented toggle: Light · Dark · System (auto). */
export default function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5"
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map((o) => {
        const active = choice === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => setChoice(o.value)}
            className={clsx(
              "flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition",
              active
                ? "bg-gradient-to-r from-cyan-400/30 to-violet-400/30 text-white shadow-glow"
                : "text-ink-300 hover:bg-white/8 hover:text-white"
            )}
            title={`Theme: ${o.label}`}
          >
            {o.icon}
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
