import axios from 'axios';
import { prisma } from '../db';
import { CryptoService } from './crypto.service';
import { LeadService } from './lead.service';
import { metaLogger, errorLogger } from './logger.service';
import { SocketService } from './socket.service';
import { getMetaFieldValue } from '../routes/meta';

export class MetaService {
  // In-memory calculated status and message indicators
  public static currentStatus: 'GREEN' | 'YELLOW' | 'RED' = 'RED';
  public static statusMessage = 'Meta integration not configured';

  /**
   * Startup and periodic validation of Page Access Token health and webhook permissions.
   */
  public static async checkMetaApiHealth(): Promise<{ status: 'GREEN' | 'YELLOW' | 'RED', message: string }> {
    try {
      const settings = await this.getMetaSettings() as any;
      if (!settings || !settings.pageAccessToken) {
        this.currentStatus = 'RED';
        this.statusMessage = 'Meta Page Access Token is not configured in settings.';
        return { status: 'RED', message: this.statusMessage };
      }

      const baseUrl = settings.apiUrl || 'https://graph.facebook.com/v25.0';

      // 1. Resolve Target Page ID and validated Page Token
      let targetPageAccessToken = settings.pageAccessToken;
      let targetPageId = '';

      try {
        const accountsResponse = await axios.get(`${baseUrl}/me/accounts?access_token=${settings.pageAccessToken}`);
        const pages = accountsResponse.data?.data || [];
        if (pages.length > 0) {
          const targetPage = pages[0];
          targetPageId = targetPage.id;
          targetPageAccessToken = targetPage.access_token;
        }
      } catch (err) {
        // Direct query fallback
      }

      if (!targetPageId) {
        try {
          const meResponse = await axios.get(`${baseUrl}/me?access_token=${settings.pageAccessToken}`);
          targetPageId = meResponse.data?.id;
        } catch (meErr: any) {
          const errorMsg = meErr.response?.data?.error?.message || meErr.message;
          this.currentStatus = 'RED';
          this.statusMessage = `Token validation failed: ${errorMsg}`;
          metaLogger.error(`Meta Token Check: Red (Expired/Invalid). Details: ${errorMsg}`);
          return { status: 'RED', message: this.statusMessage };
        }
      }

      if (!targetPageId) {
        this.currentStatus = 'RED';
        this.statusMessage = 'Could not resolve a Page ID from the Page Access Token.';
        metaLogger.error(`Meta Token Check: Red. Details: ${this.statusMessage}`);
        return { status: 'RED', message: this.statusMessage };
      }

      // 2. Check for leads_retrieval permission status via /permissions Graph endpoint
      let hasLeadsRetrieval = false;
      try {
        const permissionsResponse = await axios.get(`${baseUrl}/me/permissions?access_token=${targetPageAccessToken}`);
        const perms = permissionsResponse.data?.data || [];
        const leadsRetrievalPerm = perms.find((p: any) => p.permission === 'leads_retrieval');
        if (leadsRetrievalPerm && leadsRetrievalPerm.status === 'granted') {
          hasLeadsRetrieval = true;
        }
      } catch (permErr: any) {
        metaLogger.warn(`Permissions check query failed: ${permErr.message}. Defaulting to false.`);
      }

      const oldStatus = this.currentStatus;
      if (hasLeadsRetrieval) {
        this.currentStatus = 'GREEN';
        this.statusMessage = 'Webhook active & leads_retrieval permission verified.';
      } else {
        this.currentStatus = 'YELLOW';
        this.statusMessage = 'Webhook active, but waiting for leads_retrieval permission approval (App Review required).';
      }

      metaLogger.info(`Meta Token Check Status: ${this.currentStatus} (${this.statusMessage})`);

      // Broadcast changes to desktop clients immediately if status updated
      if (oldStatus !== this.currentStatus) {
        SocketService.broadcast('meta:status_change', {
          status: this.currentStatus,
          message: this.statusMessage
        });
      }

      return { status: this.currentStatus, message: this.statusMessage };
    } catch (e: any) {
      let errorMsg = e.message;
      if (e.code === 'ENOTFOUND' || e.message.includes('ENOTFOUND')) {
        errorMsg = 'Network connectivity issue: Unable to resolve graph.facebook.com. Please check your internet connection.';
      }
      this.currentStatus = 'RED';
      this.statusMessage = `Error verifying token: ${errorMsg}`;
      metaLogger.error(`Meta Health Validation Exception: ${errorMsg}`, { stack: e.stack });
      return { status: 'RED', message: this.statusMessage };
    }
  }
  /**
   * Fetches decrypted settings from database.
   */
  public static async getMetaSettings() {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'meta_settings' }
    });

    if (!settings) {
      return null;
    }

    try {
      const appId = settings.encryptedAppId ? CryptoService.decrypt(settings.encryptedAppId) : null;
      const appSecret = settings.encryptedAppSecret ? CryptoService.decrypt(settings.encryptedAppSecret) : null;
      const pageAccessToken = settings.encryptedPageAccessToken ? CryptoService.decrypt(settings.encryptedPageAccessToken) : null;

      return {
        appId,
        appSecret,
        pageAccessToken,
        verifyToken: settings.verifyToken,
        apiUrl: settings.apiUrl,
        lastSyncAt: (settings as any).lastSyncAt,
        lastSyncCount: (settings as any).lastSyncCount,
        lastSyncLeadName: (settings as any).lastSyncLeadName
      };
    } catch (error) {
      console.error('Failed to decrypt settings:', error);
      throw new Error('Encryption error reading Meta settings');
    }
  }

  /**
   * Fetches Meta Lead Details from Meta Graph API using leadgenId.
   */
  public static async fetchMetaLeadDetails(leadgenId: string): Promise<any> {
    const settings = await this.getMetaSettings() as any;
    if (!settings || !settings.pageAccessToken) {
      throw new Error('Meta Page Access Token is not configured');
    }

    // Default graph API URL (force v25.0 compliance)
    const baseUrl = settings.apiUrl || 'https://graph.facebook.com/v25.0';
    const requestUrl = `${baseUrl}/${leadgenId}`;

    const response = await axios.get(requestUrl, {
      params: {
        access_token: settings.pageAccessToken
      }
    });

    return response.data;
  }

  /**
   * Processes incoming Webhook lead payload.
   */
  public static async processWebhookLead(
    leadgenId: string,
    pageId: string,
    formId: string,
    adId?: string,
    createdTime?: number
  ): Promise<any> {
    const startTime = Date.now();
    try {
      metaLogger.info(`Worker starting lead retrieval for LeadgenID: ${leadgenId}`);
      
      // 1. Fetch from Meta Graph API
      const rawLeadData = await this.fetchMetaLeadDetails(leadgenId);
      const latency = Date.now() - startTime;
      metaLogger.info(`Meta Graph API latency for LeadgenID ${leadgenId}: ${latency}ms`);
      
      const fieldData = rawLeadData.field_data || [];

      // 2. Extract and Normalize details using fuzzy matching
      // Exact patterns match the Swarnbhumi Dealership Form field names
      const name = getMetaFieldValue(fieldData, ['fullname', 'full_name', 'name', 'naam', 'yourname']) || 'Facebook Lead';
      let phone = getMetaFieldValue(fieldData, ['phonenumber', 'phone_number', 'phoneoflead', 'phone', 'contact', 'mobile', 'whatsapp']);
      const email = getMetaFieldValue(fieldData, ['emailaddress', 'email', 'mail']) || null;
      // 'which_district_are_you_from' is the exact question key from the Dealership Form
      const city = getMetaFieldValue(fieldData, ['whichdistrictareyoufrom', 'which_district_are_you_from', 'district', 'cityoflead', 'city', 'location', 'town', 'place', 'message', 'comments']) || null;

      phone = phone.replace(/^p:/i, '').replace(/\s+/g, ''); // Strip p: prefix and spaces

      if (!phone || phone === 'N/A') {
        metaLogger.warn(`Leadgen ID ${leadgenId} does not contain a valid phone number. Skipping database save.`);
        return null;
      }

      // Find any system/admin user to attribute system auto-actions to
      const systemUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' }
      });
      const systemUserId = systemUser ? systemUser.id : 'system';

      // 3. Check duplicate phone
      const duplicate = await prisma.lead.findFirst({
        where: { phone }
      });

      if (duplicate) {
        // If duplicate phone, append note to lead timeline rather than creating a new record
        const timeline = await prisma.leadTimeline.create({
          data: {
            leadId: duplicate.id,
            actionType: 'NOTE_ADD',
            description: `New duplicate Facebook Lead Ads form submission received (Form: ${formId}, Ad ID: ${adId || 'N/A'}).`,
            createdById: systemUserId
          }
        });

        metaLogger.info(`Duplicate phone detected. Appended note to existing Lead ID: ${duplicate.id} | Worker Success`);

        // Dispatch real-time update event notifications to Electron clients
        SocketService.broadcast('LEAD_UPDATED', duplicate);
        SocketService.broadcast('lead:update', duplicate);
        SocketService.broadcast('dashboard:update', {});
        return duplicate;
      } else {
        // Create new lead using LeadService
        const newLead = await LeadService.createLead({
          name,
          phone,
          email: email || undefined,
          city: city || undefined,
          leadSource: 'FACEBOOK',
          facebookLeadId: leadgenId,
          facebookFormName: rawLeadData.form_id ? `Form ID: ${rawLeadData.form_id}` : `Form ID: ${formId}`,
          facebookCampaign: adId ? `Ad: ${adId}` : undefined,
          createdById: systemUserId,
          createdAt: createdTime ? new Date(createdTime * 1000) : new Date()
        });

        metaLogger.info(`Successfully created new Lead ID ${newLead.id} from Webhook LeadgenID ${leadgenId} | Worker Success`);

        // Dispatch real-time creation event notifications to Electron clients
        SocketService.broadcast('LEAD_CREATED', newLead);
        SocketService.broadcast('lead:new', newLead);
        SocketService.broadcast('dashboard:update', {});
        return newLead;
      }
    } catch (error: any) {
      let errorMsg = error?.response?.data?.error?.message || error.message;
      if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
        errorMsg = 'Network connectivity issue: Unable to resolve graph.facebook.com. Please check your internet connection.';
      }
      errorLogger.error(`Meta Graph API details retrieval error for LeadgenID ${leadgenId}: ${errorMsg}`, { stack: error.stack });
      throw new Error(errorMsg);
    }
  }
}
