interface SectionHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
}

export default function SectionHeader({ icon, title, subtitle }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between -mb-2">
      <div className="flex items-center gap-2">
        {icon && <span className="text-gvc-gold/80">{icon}</span>}
        <span className="font-display font-bold text-sm uppercase tracking-[0.22em] text-white/85">
          {title}
        </span>
      </div>
      {subtitle && (
        <span className="text-[11px] font-body text-white/35 truncate max-w-[180px]">
          {subtitle}
        </span>
      )}
    </div>
  );
}
