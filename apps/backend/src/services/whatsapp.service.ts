import axios from 'axios';
import { prisma } from '../db';
import { errorLogger, metaLogger } from './logger.service';

export class WhatsappService {
  /**
   * Fetch WhatsApp settings from the database.
   */
  public static async getSettings() {
    return prisma.whatsappSettings.findUnique({
      where: { id: 'default' }
    });
  }

  /**
   * Fetch all approved templates for the WhatsApp Business Account.
   */
  public static async fetchTemplates() {
    try {
      const settings = await this.getSettings();
      if (!settings || !settings.wabaId || !settings.accessToken) {
        throw new Error('WhatsApp settings not configured properly.');
      }

      const response = await axios.get(
        `https://graph.facebook.com/v20.0/${settings.wabaId}/message_templates`,
        {
          params: { access_token: settings.accessToken }
        }
      );

      // Filter only approved/active templates
      const approvedTemplates = response.data.data.filter(
        (t: any) => t.status === 'APPROVED' || t.status === 'ACTIVE'
      );

      return approvedTemplates;
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message;
      errorLogger.error(`Failed to fetch WhatsApp templates: ${msg}`);
      throw new Error(`Failed to fetch templates: ${msg}`);
    }
  }

  /**
   * Sends a template message via Meta Cloud API.
   * @param toPhone Phone number with country code (no '+')
   * @param templateName The name of the template to send
   * @param templateLang Language code (e.g., 'en', 'hi')
   */
  public static async sendTemplateMessage(
    toPhone: string,
    templateName: string,
    templateLang: string = 'en',
    imageUrl?: string
  ) {
    try {
      const settings = await this.getSettings();
      if (!settings || !settings.phoneNumberId || !settings.accessToken) {
        throw new Error('WhatsApp settings not configured properly.');
      }

      // Ensure phone is clean and has country code
      let cleanPhone = toPhone.replace(/\D/g, '');
      if (cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone; // Default to India if only 10 digits
      }

      const payload: any = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: templateLang
          }
        }
      };

      if (imageUrl) {
        payload.template.components = [
          {
            type: 'header',
            parameters: [
              {
                type: 'image',
                image: {
                  link: imageUrl
                }
              }
            ]
          }
        ];
      }

      const response = await axios.post(
        `https://graph.facebook.com/v20.0/${settings.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${settings.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        messageId: response.data.messages?.[0]?.id
      };
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message;
      metaLogger.error(`Failed to send WhatsApp message to ${toPhone}: ${msg}`);
      throw new Error(msg);
    }
  }
}
