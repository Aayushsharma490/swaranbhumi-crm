import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../../../../apps/backend/.env') });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Step 1: Clear all leads
  console.log('Clearing existing leads...');
  await prisma.leadTimeline.deleteMany({});
  await prisma.leadNote.deleteMany({});
  await prisma.leadAttachment.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.lead.deleteMany({});
  console.log('Database cleared.');

  // Step 2: Read CSV
  const filePath = 'C:\\crm_swarnbhumi\\Swarnbhumi Dealership Form_Leads_2026-06-26_2026-07-28.csv';
  console.log('Reading CSV...');
  const content = fs.readFileSync(filePath, 'utf16le');
  const lines = content.split(/\r?\n/);

  const headers = lines[0].split('\t').map(h => h.trim().replace(/^"|"$/g, ''));
  console.log('Headers:', headers);

  const systemUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const systemUserId = systemUser!.id;

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split('\t').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

    const name = row['full_name'] || 'Facebook Lead';
    let phone = (row['phone_number'] || '').replace(/^p:/i, '').replace(/\s+/g, '');
    const email = row['email'] || null;
    const city = row['which_district_are_you_from'] || null;
    const campaignName = row['campaign_name'] || null;
    const adSetName = row['adset_name'] || null;
    const adName = row['ad_name'] || null;
    const formName = row['form_name'] || 'Swarnbhumi Dealership Form';
    const leadId = row['id'] || null;
    const createdTime = row['created_time'] ? new Date(row['created_time']) : new Date();

    if (!phone) { skipped++; continue; }

    const existing = await prisma.lead.findFirst({ where: { phone } });
    if (existing) { skipped++; continue; }

    const newLead = await prisma.lead.create({
      data: {
        name,
        phone,
        email: email || null,
        city: city || null,
        leadSource: 'FACEBOOK',
        facebookLeadId: leadId,
        facebookFormName: formName,
        facebookCampaign: campaignName,
        facebookAdSet: adSetName,
        facebookAd: adName,
        priority: 'MEDIUM',
        status: 'NEW',
        assignedEmployeeId: systemUserId,
        createdAt: createdTime
      }
    });

    // Save the "district/message" as a note since users type actual messages there
    if (city) {
      await prisma.leadNote.create({
        data: {
          leadId: newLead.id,
          authorId: systemUserId,
          content: `Customer Message / District Info: ${city}`,
          createdAt: createdTime
        }
      });
    }

    // Add timeline log including platform and organic status
    const isOrganic = row['is_organic'] === 'true';
    const platform = row['platform'] || 'fb';
    await prisma.leadTimeline.create({
      data: {
        leadId: newLead.id,
        createdById: systemUserId,
        actionType: 'CREATE',
        description: `Lead imported from Facebook CSV (${platform.toUpperCase()}${isOrganic ? ', Organic' : ', Ad'}). Form: ${formName}.`,
        createdAt: createdTime
      }
    });

    imported++;
  }

  // Step 3: Verify
  const sample = await prisma.lead.findFirst({ orderBy: { createdAt: 'desc' } });
  console.log(`\n✅ Import complete: ${imported} leads added, ${skipped} skipped.`);
  console.log('Sample lead:', JSON.stringify({
    name: sample?.name,
    phone: sample?.phone,
    email: sample?.email,
    city: sample?.city,
    campaign: sample?.facebookCampaign,
    adSet: sample?.facebookAdSet,
    adName: sample?.facebookAd,
    form: sample?.facebookFormName
  }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
