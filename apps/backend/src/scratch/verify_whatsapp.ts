import axios from 'axios';
import * as readline from 'readline';

// Ye Phone Number ID aapke screenshot se li gayi hai
const PHONE_NUMBER_ID = '1293226850537910'; 

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));

async function main() {
    console.log("=========================================");
    console.log("Meta API UI Bug Bypass - WhatsApp OTP Tool");
    console.log("=========================================\n");

    const token = await askQuestion("Meta Developer Console se Access Token copy karke yahan paste karein aur Enter dabayein: ");
    
    if (!token) {
        console.log("Token dalna zaroori hai bhai!");
        process.exit(1);
    }

    console.log("\nKarna kya hai?");
    console.log("[1] Naye Number par OTP (SMS) bhejna hai");
    console.log("[2] OTP aagaya hai, verify karke Registration complete karna hai");
    const choice = await askQuestion("\nApna option chuniye (1 ya 2): ");

    if (choice === '1') {
        console.log("\nOTP bhej rahe hain... wait karein...");
        try {
            const response = await axios.post(
                `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/request_code`,
                {
                    code_method: 'SMS',
                    language: 'en' // English language template for OTP
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token.trim()}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log("\n✅ SUCCESS! OTP aapke naye number par bhej diya gaya hai.");
            console.log("Meta Response:", response.data);
            console.log("\nAb isi command ko dobara run karein aur Option [2] select karke OTP daalein!");
        } catch (error: any) {
            console.error("\n❌ ERROR OTP Bhejne mein:", JSON.stringify(error.response?.data || error.message, null, 2));
            console.log("Agar error 'Permissions' ka hai, toh ensure karein ki token 'whatsapp_business_management' permission wala ho.");
        }
    } else if (choice === '2') {
        const pin = await askQuestion("\nPhone par jo 6-digit OTP aaya hai wo daalein: ");
        console.log("\nVerify kar rahe hain... wait karein...");
        try {
            const response = await axios.post(
                `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/register`,
                {
                    messaging_product: 'whatsapp',
                    pin: pin.trim()
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token.trim()}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log("\n🎉 SUCCESS! Aapka number officially WhatsApp Cloud API par register ho chuka hai.");
            console.log("Meta Response:", response.data);
            console.log("\nAb aap CRM mein jaakar apne messages bhej sakte hain!");
        } catch (error: any) {
            console.error("\n❌ ERROR OTP Verify karne mein:", JSON.stringify(error.response?.data || error.message, null, 2));
        }
    } else {
        console.log("\nGalat option chuna aapne. Phir se run karein.");
    }
    
    rl.close();
}

main();
