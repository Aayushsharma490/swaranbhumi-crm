import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import axios from 'axios';
import { prisma } from '../db';
import { addLeadToQueue } from '../queues/lead.queue';
import { metaLogger, errorLogger } from '../services/logger.service';
import { MetaService } from '../services/meta.service';
import { SocketService } from '../services/socket.service';
import { LeadService } from '../services/lead.service';

export async function metaRoutes(fastify: FastifyInstance) {
  // GET /meta/webhook
  // Handshake for Webhook Verification with Facebook Meta Developer Portal
  fastify.get('/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };

    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe') {
        const settings = await prisma.systemSettings.findUnique({
          where: { id: 'meta_settings' }
        });

        const configuredToken = settings?.verifyToken || process.env.DEFAULT_VERIFY_TOKEN || 'swaranbhumi_meta_verify_token';

        if (token === configuredToken) {
          console.log('WEBHOOK_VERIFIED');
          return reply.status(200).send(challenge);
        } else {
          console.warn('Webhook verification token mismatch');
          return reply.status(403).send({ error: 'Verification token mismatch' });
        }
      }
    }
    return reply.status(400).send({ error: 'Missing parameters' });
  });

  // GET /meta/status
  // Returns in-memory calculated Meta sync and permission health status
  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    return {
      status: MetaService.currentStatus,
      message: MetaService.statusMessage
    };
  });

  // POST /meta/webhook
  // Handles incoming Lead Ad generation events in real time
  fastify.post('/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;

    // Immediately return HTTP 200 OK to satisfy Meta webhook response requirements
    reply.status(200).send('EVENT_RECEIVED');

    // Run enqueue process asynchronously to never block Meta request thread
    setImmediate(() => {
      try {
        if (body && body.object === 'page') {
          const entries = body.entry || [];
          for (const entry of entries) {
            const changes = entry.changes || [];
            for (const change of changes) {
              if (change.field === 'leadgen') {
                const { leadgen_id, page_id, form_id, ad_id, created_time } = change.value;
                metaLogger.info(`Incoming webhook: leadgen_id=${leadgen_id}, form_id=${form_id}`);
                
                addLeadToQueue(leadgen_id, page_id, form_id, ad_id, created_time).catch((err) => {
                  errorLogger.error(`Failed to push webhook payload to BullMQ queue: ${err.message}`, { stack: err.stack });
                });
              }
            }
          }
        }
      } catch (err: any) {
        errorLogger.error(`Error processing webhook async body: ${err.message}`, { stack: err.stack });
      }
    });
  });

  // POST /meta/import
  // Triggers historical facebook leads import in the background
  fastify.post('/import', async (request: any, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const currentUser = request.user;
    
    // Start historical import loop asynchronously
    runHistoricalImport(currentUser.id).catch((err) => {
      errorLogger.error(`Asynchronous Facebook Leads Import failed: ${err.message}`, { stack: err.stack });
    });

    return reply.status(200).send({ success: true, message: 'Historical leads import started in background.' });
  });

  // POST /meta/clean-sandbox
  // Deletes all temporary sandbox dummy leads from database
  fastify.post('/clean-sandbox', async (request: any, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Delete all Facebook leads (cascade deletes bookings and payments)
    const { count } = await prisma.lead.deleteMany({
      where: {
        leadSource: 'FACEBOOK'
      }
    });

    metaLogger.info(`Cleaned up ${count} Facebook and CSV leads.`);
    SocketService.broadcast('LEAD_DELETED', { all: true }); // Notify grid views to reload
    return { success: true, count, message: `Successfully removed ${count} Facebook leads.` };
  });

  // POST /meta/import-csv
  // Receives Facebook Leads CSV exports and parses them into PostgreSQL
  fastify.post('/import-csv', async (request: any, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const fileData = await request.file();
    if (!fileData) {
      return reply.status(400).send({ error: 'No CSV file uploaded' });
    }

    try {
      const buffer = await fileData.toBuffer();
      
      let csvContent = '';
      if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        // UTF-16LE BOM detected
        csvContent = buffer.toString('utf16le');
      } else if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
        // UTF-16BE BOM detected - swap bytes for Little Endian conversion
        const swapped = Buffer.from(buffer);
        swapped.swap16();
        csvContent = swapped.toString('utf16le');
      } else {
        // Run statistical check for raw null bytes (common in UTF-16 without BOM)
        let nullCount = 0;
        const checkLimit = Math.min(buffer.length, 100);
        for (let i = 0; i < checkLimit; i++) {
          if (buffer[i] === 0) nullCount++;
        }
        if (nullCount > checkLimit * 0.25) {
          csvContent = buffer.toString('utf16le');
        } else {
          csvContent = buffer.toString('utf8');
        }
      }
      
      const parsedRows = parseFacebookCSV(csvContent);
      if (parsedRows.length === 0) {
        return reply.status(400).send({ error: 'The uploaded CSV file is empty or formatted incorrectly' });
      }

      metaLogger.info(`CSV uploaded successfully. Parsed ${parsedRows.length} rows. Starting import...`);
      if (parsedRows.length > 0) {
        metaLogger.info(`Parsed CSV Columns (clean keys): ${JSON.stringify(Object.keys(parsedRows[0]))}`);
        metaLogger.info(`Parsed CSV First Row Data: ${JSON.stringify(parsedRows[0])}`);
      }

      let importedCount = 0;
      let duplicateCount = 0;

      for (const row of parsedRows) {
        // Helper to find a column by pattern matching
        const getValueByPattern = (patterns: string[]): string | null => {
          // 1. Check for exact matches
          for (const pat of patterns) {
            if (row[pat] !== undefined) {
              return row[pat]?.trim();
            }
          }
          // 2. Check for sub-word inclusion
          const matchKey = Object.keys(row).find(key => 
            patterns.some(pat => key.includes(pat))
          );
          return matchKey ? row[matchKey]?.trim() : null;
        };

        const fbLeadId = getValueByPattern(['leadid', 'facebookleadid', 'id']) || `csv_lead_${Math.random().toString(36).substr(2, 9)}`;
        const name = getValueByPattern(['fullname', 'full_name', 'name', 'naam', 'yourname']) || 'Facebook CSV Lead';
        let phone = getValueByPattern(['phonenumber', 'phone_number', 'phoneoflead', 'phone', 'contact', 'mobile', 'whatsapp']) || 'N/A';
        const email = getValueByPattern(['emailaddress', 'email', 'mail']) || null;
        // 'which_district_are_you_from' normalized to 'whichdistrictareyoufrom' by parseFacebookCSV cleaner
        const city = getValueByPattern(['whichdistrictareyoufrom', 'district', 'cityoflead', 'city', 'location', 'town', 'place']) || null;
        const state = getValueByPattern(['stateoflead', 'state', 'region', 'province']) || null;
        const budget = getValueByPattern(['budgetoflead', 'budget', 'price', 'investment', 'range']) || null;
        const project = getValueByPattern(['projectoflead', 'project', 'property', 'residency', 'phase', 'villa', 'plot', 'flat']) || null;
        // Extract Facebook ad tracking metadata from CSV columns
        const formName = getValueByPattern(['formname', 'form_name', 'facebookformname']) || 'Facebook CSV Form';
        const campaignName = getValueByPattern(['campaignname', 'campaign_name']) || null;
        const adSetName = getValueByPattern(['adsetname', 'adset_name']) || null;
        const adName = getValueByPattern(['adname', 'ad_name']) || null;
        
        const platform = getValueByPattern(['platform']) || 'fb';
        const isOrganic = getValueByPattern(['isorganic', 'is_organic']) === 'true';

        const rawTime = getValueByPattern(['createdtime', 'created_time', 'time', 'date']);
        const createdTime = rawTime && !isNaN(Date.parse(rawTime)) ? new Date(rawTime) : new Date();

        phone = phone.replace(/^p:/i, '').replace(/\s+/g, ''); // Clean prefix p: and spacing

        // Check if lead ID already exists in DB
        const existingById = await prisma.lead.findUnique({
          where: { facebookLeadId: fbLeadId }
        });

        if (existingById) {
          duplicateCount++;
          continue;
        }

        // Check duplicate status locally
        const existingLocal = await prisma.lead.findFirst({
          where: {
            OR: [
              { phone: phone !== 'N/A' ? phone : undefined },
              { email: email || undefined }
            ]
          }
        });

        let status = 'NEW';
        let assignedId = null;

        if (existingLocal) {
          status = 'DUPLICATE';
        } else {
          assignedId = await LeadService.autoAssignLead();
        }

        const newLead = await prisma.lead.create({
          data: {
            name,
            phone,
            email,
            city,
            state,
            budget,
            project,
            leadSource: 'FACEBOOK',
            facebookFormName: formName,
            facebookCampaign: campaignName,
            facebookAdSet: adSetName,
            facebookAd: adName,
            facebookLeadId: fbLeadId,
            priority: 'MEDIUM',
            status: status as any,
            assignedEmployeeId: assignedId,
            createdAt: createdTime
          },
          include: {
            assignedEmployee: {
              select: { id: true, name: true }
            }
          }
        });

        // Save the "district/message" as a note since users type actual messages there
        if (city) {
          await prisma.leadNote.create({
            data: {
              leadId: newLead.id,
              authorId: request.user.id,
              content: `Customer Message / District Info: ${city}`,
              createdAt: createdTime
            }
          });
        }

        // Timeline Audit
        await prisma.leadTimeline.create({
          data: {
            leadId: newLead.id,
            actionType: 'CREATE',
            description: `Lead imported via Facebook CSV (${platform.toUpperCase()}${isOrganic ? ', Organic' : ', Ad'}). Form: ${formName}. Assigned to ${newLead.assignedEmployee?.name || 'Unassigned'}.`,
            createdById: request.user.id
          }
        });

        if (assignedId && status !== 'DUPLICATE') {
          await prisma.leadTimeline.create({
            data: {
              leadId: newLead.id,
              actionType: 'ASSIGN',
              description: `Automatically assigned to ${newLead.assignedEmployee?.name || 'Sales Representative'}.`,
              createdById: request.user.id
            }
          });
        }

        importedCount++;
        SocketService.broadcast('LEAD_CREATED', newLead);
      }

      return {
        success: true,
        message: `Import complete. Imported ${importedCount} leads successfully. Skipped ${duplicateCount} duplicates.`,
        imported: importedCount,
        skipped: duplicateCount
      };
    } catch (err: any) {
      errorLogger.error(`Failed to parse CSV file: ${err.message}`);
      return reply.status(500).send({ error: 'Failed to process CSV file', details: err.message });
    }
  });

  // POST /meta/sync
  // Triggers offline lead synchronization in the background
  fastify.post('/sync', async (request: any, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const currentUser = request.user;
    
    // Start lead synchronization loop asynchronously
    runLeadSynchronization(currentUser.id).catch((err) => {
      errorLogger.error(`Asynchronous Lead Synchronization failed: ${err.message}`, { stack: err.stack });
    });

    return reply.status(200).send({ success: true, message: 'Lead synchronization started in background.' });
  });
}

/**
 * Detects whether a CSV uses commas, semicolons, or tabs as a delimiter.
 */
function detectDelimiter(firstLine: string): string {
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  
  if (semicolonCount > commaCount && semicolonCount > tabCount) {
    return ';';
  }
  if (tabCount > commaCount && tabCount > semicolonCount) {
    return '\t';
  }
  return ',';
}

/**
 * Extracts and fuzzy matches values from Meta Graph API field_data array.
 */
export function getMetaFieldValue(fieldData: any[], patterns: string[]): string {
  if (!fieldData || !Array.isArray(fieldData)) return '';
  
  // 1. Try exact matches on cleaned name
  for (const pattern of patterns) {
    const matched = fieldData.find((f: any) => {
      if (!f || !f.name) return false;
      const cleanName = f.name.toLowerCase().replace(/[\s_\-\.\/\?]+/g, '');
      return cleanName === pattern;
    });
    if (matched && matched.values && matched.values.length > 0) {
      return matched.values[0]?.trim() || '';
    }
  }
  
  // 2. Try substring inclusion matches
  const matchedSubstring = fieldData.find((f: any) => {
    if (!f || !f.name) return false;
    const cleanName = f.name.toLowerCase().replace(/[\s_\-\.\/\?]+/g, '');
    return patterns.some(pat => cleanName.includes(pat));
  });
  
  if (matchedSubstring && matchedSubstring.values && matchedSubstring.values.length > 0) {
    return matchedSubstring.values[0]?.trim() || '';
  }
  
  return '';
}

/**
 * Standard CSV Parser that accounts for commas/semicolons within double-quoted fields.
 */
function parseFacebookCSV(csvText: string): any[] {
  // Clean UTF-8 BOM if present
  if (csvText.startsWith('\ufeff')) {
    csvText = csvText.slice(1);
  }

  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0) return [];
  
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter);
  const leads: any[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line, delimiter);
    const row: any = {};
    headers.forEach((header, index) => {
      // Clean header keys to normalize lookup matching
      const cleanedKey = header.toLowerCase().replace(/[\s_\-\.\/\?]+/g, '');
      row[cleanedKey] = values[index] || '';
    });
    
    leads.push(row);
  }
  return leads;
}

function parseCSVLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map(val => val.replace(/^"|"$/g, ''));
}

/**
 * Iterates through Meta Form Leads, filtering out existing database matches and saving new leads.
 */
async function runHistoricalImport(userId: string) {
  try {
    metaLogger.info(`Starting Facebook historical lead import triggered by user ID: ${userId}`);
    
    const settings = await MetaService.getMetaSettings();
    if (!settings || !settings.pageAccessToken) {
      SocketService.broadcast('LEAD_IMPORT_ERROR', { error: 'Meta Page Access Token is not configured in settings.' });
      return;
    }

    const baseUrl = settings.apiUrl || 'https://graph.facebook.com/v25.0'; 
    
    // 1. Resolve Target Page ID and Page Access Token dynamically (supports both User and Page tokens!)
    let targetPageId = '';
    let targetPageAccessToken = settings.pageAccessToken;

    try {
      metaLogger.info('Querying /me/accounts to check for managed pages...');
      const accountsResponse = await axios.get(`${baseUrl}/me/accounts?access_token=${settings.pageAccessToken}`);
      const pages = accountsResponse.data?.data || [];
      if (pages.length > 0) {
        const targetPage = pages[0];
        targetPageId = targetPage.id;
        targetPageAccessToken = targetPage.access_token;
        metaLogger.info(`Resolved Page ID: ${targetPageId} and Page Access Token from managed accounts list.`);
      }
    } catch (err) {
      metaLogger.info('Token does not support /me/accounts. Assuming it is already a Page Access Token.');
    }

    if (!targetPageId) {
      metaLogger.info('Resolving Page ID from token directly...');
      const meResponse = await axios.get(`${baseUrl}/me?access_token=${settings.pageAccessToken}`);
      targetPageId = meResponse.data?.id;
      if (!targetPageId) {
        throw new Error('Failed to resolve Page ID from the Page Access Token.');
      }
      metaLogger.info(`Successfully resolved Page ID: ${targetPageId}`);
    }

    // 2. Fetch connected leadgen forms using resolved Page ID
    metaLogger.info('Fetching connected lead forms...');
    let forms: any[] = [];
    let formsUrl: string | null = `${baseUrl}/${targetPageId}/leadgen_forms?access_token=${targetPageAccessToken}`;
    
    while (formsUrl) {
      const formsResponse: any = await axios.get(formsUrl as string);
      const data = formsResponse.data.data || [];
      forms = [...forms, ...data];
      formsUrl = formsResponse.data.paging?.next || null;
    }

    if (forms.length === 0) {
      SocketService.broadcast('LEAD_IMPORT_COMPLETE', { message: 'Import complete. No Facebook Lead Forms found connected to this Page.' });
      return;
    }

    metaLogger.info(`Found ${forms.length} Facebook Forms. Loading leads...`);
    
    // 3. Fetch all leads across all forms
    const allLeads: any[] = [];
    for (const form of forms) {
      let leadsUrl: string | null = `${baseUrl}/${form.id}/leads?access_token=${targetPageAccessToken}`;
      
      while (leadsUrl) {
        try {
          const leadsResponse: any = await axios.get(leadsUrl as string);
          const data = leadsResponse.data.data || [];
          for (const item of data) {
            allLeads.push({
              ...item,
              formName: form.name
            });
          }
          leadsUrl = leadsResponse.data.paging?.next || null;
        } catch (leadsErr: any) {
          const errData = leadsErr?.response?.data?.error || {};
          const errMessage = errData.message || '';
          if (
            errMessage.includes('leads_retrieval') ||
            errData.code === 200 ||
            leadsErr.response?.status === 403
          ) {
            SocketService.broadcast('LEAD_IMPORT_ERROR', {
              error: 'requires_app_review',
              message: 'Historical Lead Import requires Meta App Review approval. Realtime lead synchronization is already active.'
            });
            metaLogger.warn(`Historical leads import aborted: leads_retrieval permission is missing (App Review required).`);
            return;
          }
          throw leadsErr;
        }
      }
    }

    if (allLeads.length === 0) {
      SocketService.broadcast('LEAD_IMPORT_COMPLETE', { message: 'Import complete. No leads found inside Facebook forms.' });
      return;
    }

    metaLogger.info(`Collected ${allLeads.length} leads in total from Meta API. Filtering existing leads...`);

    const existingLeads = await prisma.lead.findMany({
      where: {
        facebookLeadId: {
          in: allLeads.map(l => l.id)
        }
      },
      select: { facebookLeadId: true }
    });

    const existingIds = new Set(existingLeads.map(l => l.facebookLeadId));
    const leadsToImport = allLeads.filter(l => !existingIds.has(l.id));

    if (leadsToImport.length === 0) {
      SocketService.broadcast('LEAD_IMPORT_COMPLETE', { 
        message: `Import complete. Checked ${allLeads.length} leads, but they were all already imported.` 
      });
      return;
    }

    metaLogger.info(`Found ${leadsToImport.length} new leads to import. Starting sequential writes...`);

    let count = 0;
    const total = leadsToImport.length;

    for (const item of leadsToImport) {
      count++;
      
      const fieldData = item.field_data || [];
      const name = getMetaFieldValue(fieldData, ['fullname', 'name', 'naam', 'yourname']) || 'Facebook Lead';
      let phone = getMetaFieldValue(fieldData, ['phonenumber', 'phoneoflead', 'phone', 'contact', 'mobile', 'whatsapp']) || 'N/A';
      const email = getMetaFieldValue(fieldData, ['emailaddress', 'emailoflead', 'email', 'mail']) || null;
      const city = getMetaFieldValue(fieldData, ['cityoflead', 'city', 'location', 'town', 'address', 'place', 'district', 'message', 'comments']) || null;
      const state = getMetaFieldValue(fieldData, ['stateoflead', 'state', 'region', 'province']) || null;
      const budget = getMetaFieldValue(fieldData, ['budgetoflead', 'budget', 'price', 'investment', 'range']) || null;
      const project = getMetaFieldValue(fieldData, ['projectoflead', 'project', 'property', 'residency', 'phase', 'villa', 'plot', 'flat']) || null;

      phone = phone.replace(/^p:/i, '').replace(/\s+/g, '');

      const localDuplicate = await prisma.lead.findFirst({
        where: {
          OR: [
            { phone: phone !== 'N/A' ? phone : undefined },
            { email: email || undefined }
          ]
        }
      });

      let status = 'NEW';
      let assignedId = null;

      if (localDuplicate) {
        status = 'DUPLICATE';
      } else {
        assignedId = await LeadService.autoAssignLead();
      }

      const newLead = await prisma.lead.create({
        data: {
          name,
          phone,
          email,
          city,
          state,
          budget,
          project,
          leadSource: 'FACEBOOK',
          facebookFormName: item.formName,
          facebookLeadId: item.id,
          priority: 'MEDIUM',
          status: status as any,
          assignedEmployeeId: assignedId,
          createdAt: new Date(item.created_time)
        },
        include: {
          assignedEmployee: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      await prisma.leadTimeline.create({
        data: {
          leadId: newLead.id,
          actionType: 'CREATE',
          description: `Lead imported from Facebook Form: ${item.formName}. Assigned to ${newLead.assignedEmployee?.name || 'Unassigned'}.`,
          createdById: userId
        }
      });

      if (assignedId && status !== 'DUPLICATE') {
        await prisma.leadTimeline.create({
          data: {
            leadId: newLead.id,
            actionType: 'ASSIGN',
            description: `Automatically assigned to ${newLead.assignedEmployee?.name || 'Sales Representative'}.`,
            createdById: userId
          }
        });
      }

      SocketService.broadcast('LEAD_IMPORT_PROGRESS', {
        current: count,
        total,
        message: `Imported ${count}/${total}`
      });

      SocketService.broadcast('LEAD_CREATED', newLead);

      await new Promise(resolve => setTimeout(resolve, 80));
    }

    SocketService.broadcast('LEAD_IMPORT_COMPLETE', {
      message: `Imported ${total} Leads Successfully.`
    });
    
    metaLogger.info(`Successfully finished historical Facebook leads import: ${total} records added.`);
  } catch (err: any) {
    if (err.response?.data) {
      errorLogger.error(`Meta API Error Response Body: ${JSON.stringify(err.response.data)}`);
    }
    errorLogger.error(`Error during historical Facebook import execution: ${err.message}`, { stack: err.stack });
    
    let metaErrorMsg = err.response?.data?.error?.message || err.message;
    if (err.code === 'ENOTFOUND' || err.message.includes('ENOTFOUND')) {
      metaErrorMsg = 'Network connectivity issue: Unable to resolve graph.facebook.com. Please check your internet connection.';
    }
    SocketService.broadcast('LEAD_IMPORT_ERROR', { error: `Failed to import leads: ${metaErrorMsg}` });
  }
}

/**
 * Automatically syncs newest leads since lastSyncAt from Meta Graph API
 */
async function runLeadSynchronization(userId: string) {
  try {
    metaLogger.info(`Starting Facebook lead synchronization triggered by user ID: ${userId}`);
    SocketService.broadcast('LEAD_SYNC_STATUS', { status: 'SYNCING', message: 'Syncing Facebook Leads...' });

    const settings = await MetaService.getMetaSettings() as any;
    if (!settings || !settings.pageAccessToken) {
      throw new Error('Meta Page Access Token is not configured.');
    }

    const baseUrl = settings.apiUrl || 'https://graph.facebook.com/v25.0';
    
    // Resolve Page ID
    let targetPageId = '';
    let targetPageAccessToken = settings.pageAccessToken;

    try {
      const accountsResponse = await axios.get(`${baseUrl}/me/accounts?access_token=${settings.pageAccessToken}`);
      const pages = accountsResponse.data?.data || [];
      if (pages.length > 0) {
        const targetPage = pages[0];
        targetPageId = targetPage.id;
        targetPageAccessToken = targetPage.access_token;
      }
    } catch (err) {
      // Ignore and fallback to direct Page ID
    }

    if (!targetPageId) {
      const meResponse = await axios.get(`${baseUrl}/me?access_token=${settings.pageAccessToken}`);
      targetPageId = meResponse.data?.id;
      if (!targetPageId) {
        throw new Error('Failed to resolve Page ID.');
      }
    }

    // Fetch forms
    let forms: any[] = [];
    let formsUrl: string | null = `${baseUrl}/${targetPageId}/leadgen_forms?access_token=${targetPageAccessToken}`;
    
    while (formsUrl) {
      const formsResponse: any = await axios.get(formsUrl as string);
      const data = formsResponse.data.data || [];
      forms = [...forms, ...data];
      formsUrl = formsResponse.data.paging?.next || null;
    }

    if (forms.length === 0) {
      const updatedSettings: any = await (prisma.systemSettings as any).update({
        where: { id: 'meta_settings' },
        data: {
          lastSyncAt: new Date(),
          lastSyncCount: 0,
          lastSyncLeadName: 'No Forms Found'
        }
      });
      SocketService.broadcast('LEAD_SYNC_COMPLETE', {
        count: 0,
        lastSyncAt: updatedSettings.lastSyncAt,
        lastSyncLeadName: 'No Forms Found',
        message: '0 new Facebook leads synchronized.'
      });
      return;
    }

    // Fetch leads created after lastSyncAt
    const allLeads: any[] = [];
    const lastSyncTime = settings.lastSyncAt ? new Date(settings.lastSyncAt).getTime() : 0;

    for (const form of forms) {
      let leadsUrl: string | null = `${baseUrl}/${form.id}/leads?access_token=${targetPageAccessToken}`;
      
      while (leadsUrl) {
        const leadsResponse: any = await axios.get(leadsUrl as string);
        const data = leadsResponse.data.data || [];
        let hitOlderLead = false;

        for (const item of data) {
          const leadCreatedTime = new Date(item.created_time).getTime();
          // Stop if the lead is older than or equal to lastSyncAt
          if (lastSyncTime > 0 && leadCreatedTime <= lastSyncTime) {
            hitOlderLead = true;
            break;
          }
          allLeads.push({
            ...item,
            formName: form.name
          });
        }

        if (hitOlderLead) {
          break;
        }
        leadsUrl = leadsResponse.data.paging?.next || null;
      }
    }

    if (allLeads.length === 0) {
      const updatedSettings: any = await (prisma.systemSettings as any).update({
        where: { id: 'meta_settings' },
        data: {
          lastSyncAt: new Date(),
          lastSyncCount: 0
        }
      });
      SocketService.broadcast('LEAD_SYNC_COMPLETE', {
        count: 0,
        lastSyncAt: updatedSettings.lastSyncAt,
        lastSyncLeadName: settings.lastSyncLeadName || 'No new leads',
        message: '0 new Facebook leads synchronized.'
      });
      return;
    }

    // Filter duplicates
    const existingLeads = await prisma.lead.findMany({
      where: {
        facebookLeadId: {
          in: allLeads.map(l => l.id)
        }
      },
      select: { facebookLeadId: true }
    });

    const existingIds = new Set(existingLeads.map(l => l.facebookLeadId));
    const leadsToImport = allLeads.filter(l => !existingIds.has(l.id));

    if (leadsToImport.length === 0) {
      const updatedSettings: any = await (prisma.systemSettings as any).update({
        where: { id: 'meta_settings' },
        data: {
          lastSyncAt: new Date(),
          lastSyncCount: 0
        }
      });
      SocketService.broadcast('LEAD_SYNC_COMPLETE', {
        count: 0,
        lastSyncAt: updatedSettings.lastSyncAt,
        lastSyncLeadName: settings.lastSyncLeadName || 'No new leads',
        message: '0 new Facebook leads synchronized.'
      });
      return;
    }

    let count = 0;
    let lastImportedLeadName = '';

    for (const item of leadsToImport) {
      const fieldData = item.field_data || [];
      const name = getMetaFieldValue(fieldData, ['fullname', 'name', 'naam', 'yourname']) || 'Facebook Lead';
      let phone = getMetaFieldValue(fieldData, ['phonenumber', 'phoneoflead', 'phone', 'contact', 'mobile', 'whatsapp']) || 'N/A';
      const email = getMetaFieldValue(fieldData, ['emailaddress', 'emailoflead', 'email', 'mail']) || null;
      const city = getMetaFieldValue(fieldData, ['cityoflead', 'city', 'location', 'town', 'address', 'place', 'district', 'message', 'comments']) || null;
      const state = getMetaFieldValue(fieldData, ['stateoflead', 'state', 'region', 'province']) || null;
      const budget = getMetaFieldValue(fieldData, ['budgetoflead', 'budget', 'price', 'investment', 'range']) || null;
      const project = getMetaFieldValue(fieldData, ['projectoflead', 'project', 'property', 'residency', 'phase', 'villa', 'plot', 'flat']) || null;

      phone = phone.replace(/\s+/g, '');

      const localDuplicate = await prisma.lead.findFirst({
        where: {
          OR: [
            { phone: phone !== 'N/A' ? phone : undefined },
            { email: email || undefined }
          ]
        }
      });

      let status = 'NEW';
      let assignedId = null;

      if (localDuplicate) {
        status = 'DUPLICATE';
      } else {
        assignedId = await LeadService.autoAssignLead();
      }

      const newLead = await prisma.lead.create({
        data: {
          name,
          phone,
          email,
          city,
          state,
          budget,
          project,
          leadSource: 'FACEBOOK',
          facebookFormName: item.formName,
          facebookLeadId: item.id,
          priority: 'MEDIUM',
          status: status as any,
          assignedEmployeeId: assignedId,
          createdAt: new Date(item.created_time)
        },
        include: {
          assignedEmployee: {
            select: { id: true, name: true }
          }
        }
      });

      await prisma.leadTimeline.create({
        data: {
          leadId: newLead.id,
          actionType: 'CREATE',
          description: `Lead synchronized from Facebook: ${item.formName}. Assigned to ${newLead.assignedEmployee?.name || 'Unassigned'}.`,
          createdById: userId
        }
      });

      if (assignedId && status !== 'DUPLICATE') {
        await prisma.leadTimeline.create({
          data: {
            leadId: newLead.id,
            actionType: 'ASSIGN',
            description: `Automatically assigned to ${newLead.assignedEmployee?.name || 'Sales Representative'}.`,
            createdById: userId
          }
        });
      }

      lastImportedLeadName = name;
      count++;
      SocketService.broadcast('LEAD_CREATED', newLead);
    }

    // Update settings with last sync metadata
    const updatedSettings: any = await (prisma.systemSettings as any).update({
      where: { id: 'meta_settings' },
      data: {
        lastSyncAt: new Date(),
        lastSyncCount: count,
        lastSyncLeadName: lastImportedLeadName
      }
    });

    SocketService.broadcast('LEAD_SYNC_COMPLETE', {
      count,
      lastSyncAt: updatedSettings.lastSyncAt,
      lastSyncLeadName: updatedSettings.lastSyncLeadName,
      message: `${count} new Facebook leads synchronized.`
    });
  } catch (err: any) {
    const errData = err.response?.data?.error || {};
    let errMessage = errData.message || err.message;
    if (err.code === 'ENOTFOUND' || err.message.includes('ENOTFOUND')) {
      errMessage = 'Network connectivity issue: Unable to resolve graph.facebook.com. Please check your internet connection.';
    }
    const isPermissionError = errMessage.includes('leads_retrieval') || errData.code === 200 || err.response?.status === 403;

    if (isPermissionError) {
      metaLogger.warn(`Facebook leads sync bypassed: leads_retrieval permission is pending Meta App Review. (Message: ${errMessage})`);
      SocketService.broadcast('LEAD_SYNC_ERROR', { 
        error: `requires_app_review`,
        message: 'Historical Lead Import requires Meta App Review approval. Realtime lead synchronization is active.' 
      });
    } else {
      if (err.response?.data) {
        errorLogger.error(`Meta API Sync Error Response Body: ${JSON.stringify(err.response.data)}`);
      }
      errorLogger.error(`Meta sync failed: ${err.message}`, { stack: err.stack });
      SocketService.broadcast('LEAD_SYNC_ERROR', { error: `Unable to sync Facebook Leads: ${errMessage}` });
    }
  }
}
