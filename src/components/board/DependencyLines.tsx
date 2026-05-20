"use client";

import { useState, useEffect, useCallback, type RefObject } from "react";
import type { DependencyModel } from "@/generated/prisma/models";

type CardBox = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type ColumnGap = {
  center: number;
};

type RoutedLine = {
  id: string;
  x1: number;
  y1: number;
  vx1: number;
  clearY: number;
  vx2: number;
  x2: number;
  y2: number;
  colorIndex: number;
};

const HOP_RADIUS = 5;
const CARD_PADDING = 2;

const DEP_COLORS = [
  "#f43f5e", // rose
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#fb923c", // orange
  "#34d399", // emerald
  "#facc15", // yellow
  "#f472b6", // pink
  "#22d3ee", // cyan
];

function findColumnGaps(cardBoxes: CardBox[]): ColumnGap[] {
  if (cardBoxes.length === 0) return [];
  const sorted = [...cardBoxes].sort((a, b) => a.left - b.left);
  const columns: { left: number; right: number }[] = [];
  for (const box of sorted) {
    if (columns.length === 0 || box.left > columns[columns.length - 1].right + 10) {
      columns.push({ left: box.left, right: box.right });
    } else {
      columns[columns.length - 1].right = Math.max(columns[columns.length - 1].right, box.right);
    }
  }
  const gaps: ColumnGap[] = [];
  for (let i = 0; i < columns.length - 1; i++) {
    gaps.push({ center: (columns[i].right + columns[i + 1].left) / 2 });
  }
  return gaps;
}

function findClearY(
  preferredY: number,
  xMin: number,
  xMax: number,
  obstacles: CardBox[],
  excludeIds: Set<string>,
): number {
  const relevant = obstacles.filter(
    (box) =>
      !excludeIds.has(box.id) &&
      box.left < xMax &&
      box.right > xMin,
  );
  if (relevant.length === 0) return preferredY;

  const blocked = relevant.some(
    (box) => preferredY > box.top - CARD_PADDING && preferredY < box.bottom + CARD_PADDING,
  );
  if (!blocked) return preferredY;

  relevant.sort((a, b) => a.top - b.top);
  const candidates: number[] = [];

  if (relevant[0].top - CARD_PADDING > 0) {
    candidates.push(relevant[0].top - CARD_PADDING - 2);
  }
  for (let i = 0; i < relevant.length - 1; i++) {
    const gapTop = relevant[i].bottom + CARD_PADDING;
    const gapBottom = relevant[i + 1].top - CARD_PADDING;
    if (gapBottom - gapTop >= 2) {
      candidates.push((gapTop + gapBottom) / 2);
    }
  }
  candidates.push(relevant[relevant.length - 1].bottom + CARD_PADDING + 2);

  if (candidates.length === 0) return preferredY;
  candidates.sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));
  return candidates[0];
}

export function DependencyLines({
  dependencies,
  containerRef,
}: {
  dependencies: DependencyModel[];
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const [lines, setLines] = useState<RoutedLine[]>([]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container || dependencies.length === 0) {
      setLines([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();

    const cardEls = container.querySelectorAll("[data-card-id]");
    const cardBoxes: CardBox[] = [];
    cardEls.forEach((el) => {
      const id = el.getAttribute("data-card-id")!;
      const rect = el.getBoundingClientRect();
      cardBoxes.push({
        id,
        left: rect.left - containerRect.left,
        right: rect.right - containerRect.left,
        top: rect.top - containerRect.top,
        bottom: rect.bottom - containerRect.top,
      });
    });

    const columnGaps = findColumnGaps(cardBoxes);

    const blockedIds = [...new Set(dependencies.map((d) => d.blockedCardId))];
    const groupColorMap = new Map<string, number>();
    blockedIds.forEach((id, i) => groupColorMap.set(id, i % DEP_COLORS.length));

    const result: RoutedLine[] = [];

    for (const dep of dependencies) {
      const blockerEl = container.querySelector(`[data-card-id="${dep.blockerCardId}"]`);
      const blockedEl = container.querySelector(`[data-card-id="${dep.blockedCardId}"]`);
      if (!blockerEl || !blockedEl) continue;

      const blockerRect = blockerEl.getBoundingClientRect();
      const blockedRect = blockedEl.getBoundingClientRect();

      const y1 = blockerRect.top + blockerRect.height / 2 - containerRect.top;
      const y2 = blockedRect.top + blockedRect.height / 2 - containerRect.top;

      const blockedIsRight = blockedRect.left > blockerRect.right - 10;
      const blockedIsLeft = blockedRect.right < blockerRect.left + 10;

      let x1: number, x2: number, vx1: number, vx2: number, clearY: number;

      if (!blockedIsRight && !blockedIsLeft) {
        x1 = blockerRect.right - containerRect.left;
        x2 = blockedRect.right - containerRect.left;
        const vx = Math.max(x1, x2) + 18;
        vx1 = vx;
        vx2 = vx;
        clearY = y1;
      } else {
        if (blockedIsRight) {
          x1 = blockerRect.right - containerRect.left;
          x2 = blockedRect.left - containerRect.left;
        } else {
          x1 = blockerRect.left - containerRect.left;
          x2 = blockedRect.right - containerRect.left;
        }

        const xMin = Math.min(x1, x2);
        const xMax = Math.max(x1, x2);
        const gapsBetween = columnGaps.filter((g) => g.center > xMin && g.center < xMax);

        if (gapsBetween.length <= 1) {
          const vx = gapsBetween.length === 1 ? gapsBetween[0].center : (x1 + x2) / 2;
          vx1 = vx;
          vx2 = vx;
          clearY = y1;
        } else {
          const nearSource = [...gapsBetween].sort(
            (a, b) => Math.abs(a.center - x1) - Math.abs(b.center - x1),
          );
          const nearTarget = [...gapsBetween].sort(
            (a, b) => Math.abs(a.center - x2) - Math.abs(b.center - x2),
          );
          vx1 = nearSource[0].center;
          vx2 = nearTarget[0].center;

          const excludeIds = new Set([dep.blockerCardId, dep.blockedCardId]);
          const midXMin = Math.min(vx1, vx2);
          const midXMax = Math.max(vx1, vx2);
          clearY = findClearY(y1, midXMin, midXMax, cardBoxes, excludeIds);
        }
      }

      result.push({
        id: dep.id,
        x1, y1, vx1, clearY, vx2, x2, y2,
        colorIndex: groupColorMap.get(dep.blockedCardId) ?? 0,
      });
    }

    setLines(result);
  }, [dependencies, containerRef]);

  useEffect(() => {
    measure();
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const debouncedMeasure = () => {
      if (timerId !== null) clearTimeout(timerId);
      timerId = setTimeout(measure, 150);
    };
    const observer = new MutationObserver(debouncedMeasure);
    if (containerRef.current) {
      observer.observe(containerRef.current, { childList: true, subtree: true, attributes: true });
    }
    window.addEventListener("resize", measure);
    return () => {
      if (timerId !== null) clearTimeout(timerId);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, containerRef]);

  if (lines.length === 0) return null;

  const hopsMap = new Map<string, { vx1Hops: number[]; vx2Hops: number[] }>();

  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      const a = lines[i];
      const b = lines[j];

      const bHSegs = [
        { y: b.y1, xMin: Math.min(b.x1, b.vx1), xMax: Math.max(b.x1, b.vx1) },
        { y: b.clearY, xMin: Math.min(b.vx1, b.vx2), xMax: Math.max(b.vx1, b.vx2) },
        { y: b.y2, xMin: Math.min(b.vx2, b.x2), xMax: Math.max(b.vx2, b.x2) },
      ];

      if (!hopsMap.has(a.id)) hopsMap.set(a.id, { vx1Hops: [], vx2Hops: [] });
      const hops = hopsMap.get(a.id)!;

      if (Math.abs(a.clearY - a.y1) > 1) {
        const min = Math.min(a.y1, a.clearY);
        const max = Math.max(a.y1, a.clearY);
        for (const seg of bHSegs) {
          if (seg.xMin < a.vx1 && a.vx1 < seg.xMax && min < seg.y && seg.y < max) {
            hops.vx1Hops.push(seg.y);
          }
        }
      }

      if (Math.abs(a.y2 - a.clearY) > 1) {
        const min = Math.min(a.clearY, a.y2);
        const max = Math.max(a.clearY, a.y2);
        for (const seg of bHSegs) {
          if (seg.xMin < a.vx2 && a.vx2 < seg.xMax && min < seg.y && seg.y < max) {
            hops.vx2Hops.push(seg.y);
          }
        }
      }
    }
  }

  const usedColors = new Set(lines.map((l) => l.colorIndex));

  return (
    <svg className="absolute inset-0 pointer-events-none overflow-visible" style={{ zIndex: 10 }}>
      <defs>
        {[...usedColors].map((ci) => (
          <marker
            key={ci}
            id={`dep-arrow-${ci}`}
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DEP_COLORS[ci]} />
          </marker>
        ))}
      </defs>
      {lines.map((line) => {
        const hops = hopsMap.get(line.id) ?? { vx1Hops: [], vx2Hops: [] };
        const color = DEP_COLORS[line.colorIndex];
        return (
          <path
            key={line.id}
            d={buildPath(line, hops.vx1Hops, hops.vx2Hops)}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
            markerEnd={`url(#dep-arrow-${line.colorIndex})`}
          />
        );
      })}
    </svg>
  );
}

function buildVerticalSegment(
  vx: number,
  fromY: number,
  toY: number,
  hops: number[],
): string {
  if (Math.abs(toY - fromY) < 0.5) return "";

  const r = HOP_RADIUS;
  const goingDown = toY >= fromY;

  const filtered = hops
    .filter((cy) =>
      goingDown ? cy > fromY + r && cy < toY - r : cy < fromY - r && cy > toY + r,
    )
    .sort((a, b) => (goingDown ? a - b : b - a));

  const deduped: number[] = [];
  for (const cy of filtered) {
    if (deduped.length === 0 || Math.abs(cy - deduped[deduped.length - 1]) > 2 * r) {
      deduped.push(cy);
    }
  }

  let d = "";
  if (deduped.length === 0) {
    d += ` V ${toY}`;
  } else {
    for (const cy of deduped) {
      const beforeY = goingDown ? cy - r : cy + r;
      const afterY = goingDown ? cy + r : cy - r;
      const sweep = goingDown ? 1 : 0;
      d += ` V ${beforeY} A ${r} ${r} 0 0 ${sweep} ${vx} ${afterY}`;
    }
    d += ` V ${toY}`;
  }

  return d;
}

function buildPath(
  line: RoutedLine,
  vx1Hops: number[],
  vx2Hops: number[],
): string {
  const { x1, y1, vx1, clearY, vx2, x2, y2 } = line;

  let d = `M ${x1} ${y1}`;

  if (Math.abs(vx1 - x1) > 0.5) d += ` H ${vx1}`;

  d += buildVerticalSegment(vx1, y1, clearY, vx1Hops);

  if (Math.abs(vx2 - vx1) > 0.5) d += ` H ${vx2}`;

  d += buildVerticalSegment(vx2, clearY, y2, vx2Hops);

  if (Math.abs(x2 - vx2) > 0.5) d += ` H ${x2}`;

  return d;
}
