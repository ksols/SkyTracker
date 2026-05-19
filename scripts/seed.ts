import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type CardData = {
  title: string;
  description?: string;
  taskType?: "FEATURE" | "WORK_ITEM" | "BUG" | "MAINTENANCE" | "OTHER";
  estimateType: "HARD_DATE" | "WEEKS" | "SCOPES" | "NONE";
  estimate?: string;
  estimateDate?: string;
  estimateWeeks?: number;
  isGap?: boolean;
  codeReview?: boolean;
  backend: boolean;
  frontend: boolean;
};

const columns: { title: string; cards: CardData[] }[] = [
  {
    title: "THM",
    cards: [
      { title: "Gap", isGap: true, estimateType: "NONE", backend: true, frontend: true },
      { title: "Gap", isGap: true, estimateType: "NONE", backend: true, frontend: true },
      { title: "Gap", isGap: true, estimateType: "NONE", backend: true, frontend: true },
      { title: "RN Catch-up", estimateType: "HARD_DATE", estimateDate: "2026-06-24", estimate: "24. juni", backend: true, frontend: true },
      { title: "Kryptering", estimateType: "WEEKS", estimateWeeks: 4, estimate: "4 uker", backend: true, frontend: true },
      { title: "FileVault", estimateType: "WEEKS", estimateWeeks: 3, estimate: "3 uker", backend: true, frontend: true },
      { title: "Kart", estimateType: "WEEKS", estimateWeeks: 5, estimate: "5 uker", backend: true, frontend: true },
      { title: "Post Quantum Roadmap", estimateType: "WEEKS", estimateWeeks: 2, estimate: "2 uker", backend: true, frontend: true },
    ],
  },
  {
    title: "KSO",
    cards: [
      { title: "S3 Scality → NetApp", estimateType: "HARD_DATE", estimateDate: "2026-05-21", estimate: "21. mai", backend: true, frontend: false },
      { title: "Oppgradering Backend", description: "Monolith, SigR, GPRC, Otel, Validator ++", estimateType: "HARD_DATE", estimateDate: "2026-05-22", estimate: "22. mai", backend: true, frontend: false },
      { title: "Backend Skalering", estimateType: "HARD_DATE", estimateDate: "2026-06-10", estimate: "10. juni", backend: true, frontend: false },
      { title: "Gap", isGap: true, estimateType: "NONE", backend: true, frontend: true },
      { title: "Threads + Reply", estimateType: "WEEKS", estimateWeeks: 1, estimate: "1 uke", backend: true, frontend: true },
      { title: "Markdown", estimateType: "WEEKS", estimateWeeks: 1, estimate: "1 uke", backend: true, frontend: true },
      { title: "Call Rework", estimateType: "WEEKS", estimateWeeks: 3, estimate: "3 uker", backend: true, frontend: true },
      { title: "Notification Rework", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: true },
      { title: "Wipe Device", description: "Nuke", estimateType: "WEEKS", estimateWeeks: 1, estimate: "1 uke", backend: true, frontend: true },
      { title: "Opprydding av endepukter", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: true },
      { title: "Deling av historiske data i en chat", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: true },
    ],
  },
  {
    title: "GO",
    cards: [
      { title: "Error Reporting System", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: true },
      { title: "PTT Del 2", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: true },
    ],
  },
  {
    title: "Dev X",
    cards: [
      { title: "Proxy Del 1", description: "Dagens plattform", estimateType: "WEEKS", estimateWeeks: 1, estimate: "1 uke", backend: true, frontend: true },
      { title: "BKS → MKS", description: "k8s migrering", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: false },
      { title: "DB Rework", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: false },
      { title: "Flytte VM-er inn i k8S", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: false },
      { title: "Proxy Del 2", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: true },
      { title: "API-integrasjonsklient", estimateType: "SCOPES", estimate: "Q3 - Scopes", backend: true, frontend: false },
      { title: "Backend Sikkerhetsherding", description: "SOAR mm.", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: false },
      { title: "Oppetidsovervåking", description: "Dashboard", estimateType: "SCOPES", estimate: "Scopes", backend: true, frontend: false },
    ],
  },
  {
    title: "Åpne Issues",
    cards: [
      { title: "QR Onboarding", estimateType: "WEEKS", estimateWeeks: 12, estimate: "12 uker", backend: true, frontend: true },
    ],
  },
];

async function main() {
  // Get or create the board
  let board = await prisma.board.findFirst();
  if (!board) {
    board = await prisma.board.create({ data: { name: "SkyTracker" } });
    console.log("Created board:", board.id);
  } else {
    console.log("Using existing board:", board.id);
  }

  // Clear existing data (cards first due to FK, then columns)
  const deleted = await prisma.card.deleteMany({ where: { boardId: board.id } });
  console.log(`Deleted ${deleted.count} existing cards`);
  const deletedCols = await prisma.column.deleteMany({ where: { boardId: board.id } });
  console.log(`Deleted ${deletedCols.count} existing columns`);

  // Create columns and cards
  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const colDef = columns[colIdx];
    const column = await prisma.column.create({
      data: {
        boardId: board.id,
        title: colDef.title,
        position: colIdx,
      },
    });
    console.log(`Created column: ${colDef.title} (${column.id})`);

    for (let cardIdx = 0; cardIdx < colDef.cards.length; cardIdx++) {
      const c = colDef.cards[cardIdx];
      await prisma.card.create({
        data: {
          boardId: board.id,
          columnId: column.id,
          title: c.title,
          description: c.description ?? null,
          taskType: c.taskType ?? "OTHER",
          estimateType: c.estimateType,
          estimate: c.estimate ?? null,
          estimateDate: c.estimateDate ? new Date(c.estimateDate) : null,
          estimateWeeks: c.estimateWeeks ?? null,
          isGap: c.isGap ?? false,
          codeReview: c.codeReview ?? false,
          position: cardIdx,
          tags: [
            { name: "Backend", applicable: c.backend },
            { name: "Frontend", applicable: c.frontend },
          ],
        },
      });
    }
    console.log(`  Created ${colDef.cards.length} cards`);
  }

  console.log("\nDone! Seeded 5 columns with all cards from the sketch.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
