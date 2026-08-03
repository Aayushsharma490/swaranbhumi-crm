import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up non-Admin staff accounts...');
  
  const { count } = await prisma.user.deleteMany({
    where: {
      role: {
        not: 'ADMIN'
      }
    }
  });

  console.log(`Cleaned up ${count} staff accounts. Only the primary administrator account remains.`);
}

main()
  .catch((e) => {
    console.error('Failed to clean staff accounts:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
