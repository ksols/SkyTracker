"use client";

import { useState, useEffect, useCallback, type RefObject } from "react";
import type { DependencyModel } from "@/generated/prisma/models";

type LineCoords = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  routing: "right-left" | "left-right" | "same-column";
};

export function DependencyLines({
  dependencies,
  containerRef,
}: {
  dependencies: DependencyModel[];
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const [lines, setLines] = useState<LineCoords[]>([]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container || dependencies.length === 0) {
      setLines([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const result: LineCoords[] = [];

    for (const dep of dependencies) {
      const blockerEl = container.querySelector(`[data-card-id="${dep.blockerCardId}"]`);
      const blockedEl = container.querySelector(`[data-card-id="${dep.blockedCardId}"]`);
      if (!blockerEl || !blockedEl) continue;

      const blockerRect = blockerEl.getBoundingClientRect();
      const blockedRect = blockedEl.getBoundingClientRect();

      const y1 = blockerRect.top + blockerRect.height / 2 - containerRect.top;
      const y2 = blockedRect.top + blockedRect.height / 2 - containerRect.top;

      let x1: number, x2: number, routing: LineCoords["routing"];

      const blockedIsRight = blockedRect.left > blockerRect.right - 10;
      const blockedIsLeft = blockedRect.right < blockerRect.left + 10;

      if (blockedIsRight) {
        x1 = blockerRect.right - containerRect.left;
        x2 = blockedRect.left - containerRect.left;
        routing = "right-left";
      } else if (blockedIsLeft) {
        x1 = blockerRect.left - containerRect.left;
        x2 = blockedRect.right - containerRect.left;
        routing = "left-right";
      } else {
        x1 = blockerRect.right - containerRect.left;
        x2 = blockedRect.right - containerRect.left;
        routing = "same-column";
      }

      result.push({ id: dep.id, x1, y1, x2, y2, routing });
    }

    setLines(result);
  }, [dependencies, containerRef]);

  useEffect(() => {
    measure();
    const observer = new MutationObserver(measure);
    if (containerRef.current) {
      observer.observe(containerRef.current, { childList: true, subtree: true, attributes: true });
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, containerRef]);

  if (lines.length === 0) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none overflow-visible" style={{ zIndex: 10 }}>
      <defs>
        <marker
          id="dep-arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-rose-500" />
        </marker>
      </defs>
      {lines.map((line) => {
        const dx = Math.abs(line.x2 - line.x1);
        const dy = Math.abs(line.y2 - line.y1);
        let path: string;

        if (line.routing === "same-column") {
          const gap = 18;
          const midX = Math.max(line.x1, line.x2) + gap;
          const midY = (line.y1 + line.y2) / 2;
          path = `M ${line.x1} ${line.y1} Q ${midX} ${line.y1}, ${midX} ${midY} Q ${midX} ${line.y2}, ${line.x2} ${line.y2}`;
        } else if (line.routing === "left-right") {
          const cpOffset = Math.max(dx * 0.3, 30);
          path = `M ${line.x1} ${line.y1} C ${line.x1 - cpOffset} ${line.y1}, ${line.x2 + cpOffset} ${line.y2}, ${line.x2} ${line.y2}`;
        } else {
          const cpOffset = Math.max(dx * 0.3, 30);
          path = `M ${line.x1} ${line.y1} C ${line.x1 + cpOffset} ${line.y1}, ${line.x2 - cpOffset} ${line.y2}, ${line.x2} ${line.y2}`;
        }

        return (
          <path
            key={line.id}
            d={path}
            className="stroke-rose-500"
            strokeWidth={2}
            fill="none"
            strokeDasharray="6 3"
            markerEnd="url(#dep-arrow)"
          />
        );
      })}
    </svg>
  );
}
