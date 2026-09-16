import os
import pandas as pd

def create_batches():
    print("[*] Processing and deduplicating contacts...")
    
    # 1. Read boss numbers
    boss_df = pd.read_csv('boss_numbers.csv')
    boss_list = []
    seen_phones = set()

    for _, row in boss_df.iterrows():
        p_raw = str(row['Phone']).strip()
        p_digits = ''.join(c for c in p_raw if c.isdigit())
        if len(p_digits) >= 10:
            phone_10 = p_digits[-10:]
            if phone_10 not in seen_phones:
                seen_phones.add(phone_10)
                boss_list.append({
                    'Name': str(row['Name']).strip(),
                    'Country Code': '+91',
                    'Phone Number': phone_10,
                    'Number Status': 'Available',
                    'Role': 'Board/Boss'
                })

    # 2. Read final merged sheet
    df = pd.read_csv('final_merged_sheet.csv', encoding='utf-8')

    all_records = list(boss_list) # Board members first

    for _, row in df.iterrows():
        name = str(row.get('Name', '')).strip()
        raw_p = str(row.get('Phone Number', '')).strip()
        p_digits = ''.join(c for c in raw_p if c.isdigit())
        if len(p_digits) >= 10:
            phone_10 = p_digits[-10:]
            if phone_10 not in seen_phones:
                seen_phones.add(phone_10)
                role = str(row.get('Role', 'Member')).strip()
                c_code = str(row.get('Country Code', '+91')).strip()
                if not c_code or c_code == 'nan':
                    c_code = '+91'
                status = str(row.get('Number Status', 'Available')).strip()
                if not status or status == 'nan':
                    status = 'Available'
                all_records.append({
                    'Name': name,
                    'Country Code': c_code,
                    'Phone Number': phone_10,
                    'Number Status': status,
                    'Role': role
                })

    print(f"[OK] Total clean, unique contacts: {len(all_records)}")

    # 3. Split into 1400 batch files
    batch_size = 1400
    os.makedirs('whatsapp_batches', exist_ok=True)
    total_batches = (len(all_records) + batch_size - 1) // batch_size
    cols_to_export = ['Name', 'Country Code', 'Phone Number', 'Number Status', 'Role']

    for i in range(total_batches):
        start_idx = i * batch_size
        end_idx = min((i + 1) * batch_size, len(all_records))
        batch_records = all_records[start_idx:end_idx]
        batch_df = pd.DataFrame(batch_records)
        
        out_path = f'whatsapp_batches/batch_{i+1}_of_{total_batches}.csv'
        batch_df[cols_to_export].to_csv(out_path, index=False, encoding='utf-8')
        print(f"[+] Batch {i+1}/{total_batches}: Saved {len(batch_df)} contacts -> {out_path}")

    print("\n[DONE] All batches ready in folder: whatsapp_batches/")

if __name__ == '__main__':
    create_batches()
