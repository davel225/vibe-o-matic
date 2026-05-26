"use client";

interface ModeBtnProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export default function ModeBtn({ active, onClick, children }: ModeBtnProps) {
  return (
    <button
      onClick={onClick}
      className={
        "py-2 rounded-lg flex items-center justify-center gap-2 text-[11px] font-body uppercase tracking-[0.18em] transition " +
        (active
          ? "bg-gvc-gold text-gvc-black font-semibold"
          : "text-white/55 hover:text-white hover:bg-white/[0.04]")
      }
    >
      {children}
    </button>
  );
}
