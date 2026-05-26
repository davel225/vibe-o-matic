"use client";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

export default function Slider({ value, min, max, step, onChange }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full cursor-pointer appearance-none gvc-slider"
      style={{
        background: `linear-gradient(to right, #FFE048 0%, #FFE048 ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`,
        height: "4px",
        borderRadius: "2px",
      }}
    />
  );
}
