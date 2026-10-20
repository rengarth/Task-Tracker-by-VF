import { useEffect, useRef, useState, type PointerEvent } from "react";
import { uiScale } from "./uiScale";

export function useWindowDrag(initialLayer = 0) {
  const ref = useRef<HTMLElement>(null),
    [position, setPosition] = useState({ x: (initialLayer % 4) * 28, y: (initialLayer % 4) * 6 });
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const reset = () => {
    drag.current = null;
    setPosition({ x: 0, y: 0 });
  };
  useEffect(() => {
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);
  return {
    ref,
    style: { transform: `translate(${position.x}px, ${position.y}px)` },
    reset,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (
          e.button !== 0 ||
          (e.target as HTMLElement).closest("button,input,select,textarea,a")
        )
          return;
        const rect = ref.current!.getBoundingClientRect();
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          offsetX: position.x,
          offsetY: position.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (!d) return;
        const left = Math.max(
          8,
          Math.min(window.innerWidth - d.width - 8, d.left + e.clientX - d.x),
        );
        const top = Math.max(
          8,
          Math.min(window.innerHeight - d.height - 8, d.top + e.clientY - d.y),
        );
        setPosition({
          x: d.offsetX + (left - d.left) / uiScale(),
          y: d.offsetY + (top - d.top) / uiScale(),
        });
      },
      onPointerUp: () => {
        drag.current = null;
      },
      onPointerCancel: () => {
        drag.current = null;
      },
      onLostPointerCapture: () => {
        drag.current = null;
      },
    },
  };
}
