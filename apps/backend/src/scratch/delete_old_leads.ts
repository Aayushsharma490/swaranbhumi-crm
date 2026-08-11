import { prisma } from '../db';

async function main() {
  const cutoffDate = new Date('2026-07-30T00:00:00Z');
  
  const result = await prisma.lead.deleteMany({
    where: {
      createdAt: {
        lt: cutoffDate,
      },
    },
  });

  console.log(`Deleted ${result.count} leads created before ${cutoffDate.toISOString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
