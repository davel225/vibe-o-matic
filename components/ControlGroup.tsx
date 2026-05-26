interface ControlGroupProps {
  label: string;
  value?: string;
  children: React.ReactNode;
}

export default function ControlGroup({ label, value, children }: ControlGroupProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-body uppercase tracking-[0.18em] text-white/50">
          {label}
        </span>
        {value !== undefined && (
          <span className="text-[11px] font-mono text-white/40 tabular-nums truncate max-w-[140px]">
            {value}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
