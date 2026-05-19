import type { CardModel } from "@/generated/prisma/models";

export type CardWithEstimatedDone = {
  cardId: string;
  estimatedDone: Date | null;
};

export function computeEstimatedDates(cards: CardModel[]): Map<string, Date | null> {
  const result = new Map<string, Date | null>();
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  for (const card of cards) {
    if (card.isGap) {
      if (card.estimateType === "HARD_DATE" && card.estimateDate) {
        const hard = new Date(card.estimateDate);
        hard.setHours(0, 0, 0, 0);
        cursor = hard;
        result.set(card.id, hard);
      } else if (card.estimateWeeks) {
        const done = addWeeks(cursor, card.estimateWeeks);
        cursor = done;
        result.set(card.id, done);
      } else {
        result.set(card.id, null);
      }
      continue;
    }

    switch (card.estimateType) {
      case "HARD_DATE": {
        if (card.estimateDate) {
          const hard = new Date(card.estimateDate);
          hard.setHours(0, 0, 0, 0);
          result.set(card.id, hard);
          cursor = hard;
        } else {
          result.set(card.id, null);
        }
        break;
      }
      case "WEEKS": {
        if (card.estimateWeeks) {
          const done = addWeeks(cursor, card.estimateWeeks);
          result.set(card.id, done);
          cursor = done;
        } else {
          result.set(card.id, null);
        }
        break;
      }
      case "SCOPES":
      case "NONE":
      default:
        result.set(card.id, null);
        break;
    }
  }

  return result;
}

function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + weeks * 7);
  return result;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}
