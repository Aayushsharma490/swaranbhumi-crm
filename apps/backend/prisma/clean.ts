import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up all mock and dummy database records (Leads, Bookings, Payments)...');
  
  // Deleting leads will cascade delete all bookings and payment records due to onDelete: Cascade rules
  const { count } = await prisma.lead.deleteMany({});
  
  console.log(`Cleaned up ${count} leads, along with all associated bookings and payments.`);
  console.log('Database clean-up finished successfully. Database is now ready for production leads imports!');
}

main()
  .catch((e) => {
    console.error('Failed to clean database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
