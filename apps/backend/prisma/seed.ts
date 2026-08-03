import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Clean Database
  await prisma.payment.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.leadTimeline.deleteMany();
  await prisma.leadNote.deleteMany();
  await prisma.leadAttachment.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.user.deleteMany();
  await prisma.systemSettings.deleteMany();

  // 2. Create Users
  const salt = await bcrypt.genSalt(10);
  const adminPassword = await bcrypt.hash('admin123', salt);
  const managerPassword = await bcrypt.hash('manager123', salt);
  const executive1Password = await bcrypt.hash('executive123', salt);
  const executive2Password = await bcrypt.hash('executive456', salt);

  const admin = await prisma.user.create({
    data: {
      name: 'Aditya Vardhan (Admin)',
      email: 'admin@swaranbhumi.com',
      passwordHash: adminPassword,
      role: 'ADMIN',
      status: 'ACTIVE'
    }
  });

  const manager = await prisma.user.create({
    data: {
      name: 'Rohan Gupta (Manager)',
      email: 'manager@swaranbhumi.com',
      passwordHash: managerPassword,
      role: 'MANAGER',
      status: 'ACTIVE'
    }
  });

  const executive1 = await prisma.user.create({
    data: {
      name: 'Simran Kaur (Sales Executive)',
      email: 'executive@swaranbhumi.com',
      passwordHash: executive1Password,
      role: 'EXECUTIVE',
      status: 'ACTIVE'
    }
  });

  const executive2 = await prisma.user.create({
    data: {
      name: 'Rahul Mishra (Sales Executive)',
      email: 'executive2@swaranbhumi.com',
      passwordHash: executive2Password,
      role: 'EXECUTIVE',
      status: 'ACTIVE'
    }
  });

  console.log('Users created successfully.');

  // 3. Create Settings Default
  await prisma.systemSettings.create({
    data: {
      id: 'meta_settings',
      verifyToken: 'swaranbhumi_meta_verify_token',
      apiUrl: 'https://graph.facebook.com/v20.0'
    }
  });

  // 4. Create Leads
  const lead1 = await prisma.lead.create({
    data: {
      name: 'Aarav Sharma',
      phone: '+919876543210',
      email: 'aarav.sharma@gmail.com',
      city: 'Raipur',
      state: 'Chhattisgarh',
      budget: '75L - 1Cr',
      project: 'Swaranbhumi Highlands',
      propertyType: '3 BHK Villa',
      leadSource: 'DIRECT',
      priority: 'HIGH',
      status: 'NEW',
      assignedEmployeeId: executive1.id,
      followUpDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
    }
  });

  const lead2 = await prisma.lead.create({
    data: {
      name: 'Neha Verma',
      phone: '+918765432109',
      email: 'neha.v@yahoo.com',
      city: 'Bhilai',
      state: 'Chhattisgarh',
      budget: '50L - 75L',
      project: 'Swaranbhumi Residency',
      propertyType: '2 BHK Apartment',
      leadSource: 'FACEBOOK',
      facebookFormName: 'Highlands Enquiries',
      priority: 'MEDIUM',
      status: 'CONTACTED',
      assignedEmployeeId: executive1.id,
      followUpDate: new Date() // Today
    }
  });

  const lead3 = await prisma.lead.create({
    data: {
      name: 'Kabir Mehta',
      phone: '+917654321098',
      email: 'kabir.mehta@gmail.com',
      city: 'Delhi',
      state: 'Delhi',
      budget: '1.5Cr - 2Cr',
      project: 'Swaranbhumi Smart Villas',
      propertyType: '4 BHK Luxury Villa',
      leadSource: 'WEBSITE',
      priority: 'HIGH',
      status: 'INTERESTED',
      assignedEmployeeId: executive2.id,
      followUpDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) // 2 days later
    }
  });

  const lead4 = await prisma.lead.create({
    data: {
      name: 'Vikram Malhotra',
      phone: '+919999888877',
      email: 'vikram.m@gmail.com',
      city: 'Raipur',
      state: 'Chhattisgarh',
      budget: '75L - 1Cr',
      project: 'Swaranbhumi Highlands',
      propertyType: '3 BHK Villa',
      leadSource: 'DIRECT',
      priority: 'HIGH',
      status: 'BOOKED',
      assignedEmployeeId: executive1.id
    }
  });

  const lead5 = await prisma.lead.create({
    data: {
      name: 'Riya Sen',
      phone: '+916666555544',
      email: 'riya.sen@outlook.com',
      city: 'Bilaspur',
      state: 'Chhattisgarh',
      budget: '40L - 50L',
      project: 'Swaranbhumi Heights',
      propertyType: '2 BHK Apartment',
      leadSource: 'FACEBOOK',
      facebookFormName: 'Residency Enquiries',
      priority: 'LOW',
      status: 'LOST',
      assignedEmployeeId: executive2.id
    }
  });

  console.log('Leads created successfully.');

  // 5. Create Notes & Timeline
  await prisma.leadNote.create({
    data: {
      leadId: lead1.id,
      authorId: executive1.id,
      content: 'Called customer, expressed interest in 3 BHK plots. Asked to arrange site visit this weekend.'
    }
  });

  await prisma.leadTimeline.create({
    data: {
      leadId: lead1.id,
      actionType: 'CREATE',
      description: 'Lead registered by system.',
      createdById: admin.id
    }
  });

  await prisma.leadTimeline.create({
    data: {
      leadId: lead1.id,
      actionType: 'NOTE_ADD',
      description: 'Note added by Simran Kaur.',
      createdById: executive1.id
    }
  });

  // 6. Create Booking & Payments for Lead 4 (Vikram Malhotra)
  const booking = await prisma.booking.create({
    data: {
      leadId: lead4.id,
      propertyDetails: 'Swaranbhumi Highlands, Plot No. A-24',
      agreementNumber: 'SB-2026-H-0024',
      totalAmount: 8500000.0, // 85 Lakhs
      status: 'CONFIRMED'
    }
  });

  // Booking payment
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      amount: 1000000.0, // 10 Lakhs Booking amount
      paymentMode: 'BANK_TRANSFER',
      referenceNumber: 'TXN10023490234',
      status: 'PAID'
    }
  });

  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      amount: 250000.0, // 2.5 Lakhs GST
      paymentMode: 'ONLINE',
      referenceNumber: 'TXN10023490235',
      status: 'PAID'
    }
  });

  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      amount: 1500000.0, // Next installment scheduled
      paymentMode: 'CHEQUE',
      referenceNumber: 'CHQ9980112',
      status: 'PENDING'
    }
  });

  await prisma.leadTimeline.create({
    data: {
      leadId: lead4.id,
      actionType: 'BOOKING_CREATE',
      description: 'Booking confirmed for Swaranbhumi Highlands Plot A-24. Value: 85L.',
      createdById: executive1.id
    }
  });

  console.log('Bookings and Payments seeded.');
  console.log('Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
