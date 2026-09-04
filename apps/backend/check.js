const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

async function main() {
  const p = new PrismaClient();
  const s = await p.whatsappSettings.findUnique({where: {id: 'default'}});
  if (!s) {
    console.log("No settings found");
    return;
  }
  
  const payload = {
    messaging_product: 'whatsapp',
    to: '917727038430',
    type: 'template',
    template: {
      name: 'rakhi_special_offer',
      language: { code: 'en' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'image',
              image: { link: 'https://cdn.pixabay.com/photo/2015/04/23/22/00/tree-736885_1280.jpg' }
            }
          ]
        }
      ]
    }
  };
  
  try {
    const r = await axios.post(
      'https://graph.facebook.com/v20.0/' + s.phoneNumberId + '/messages',
      payload,
      {
        headers: {
          Authorization: 'Bearer ' + s.accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('API SUCCESS. Message ID:', r.data.messages[0].id);
  } catch (e) {
    console.error('API ERROR:', e.response?.data || e.message);
  }
  await p.$disconnect();
}

main();
