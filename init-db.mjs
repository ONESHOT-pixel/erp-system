import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
const regions = ['eu-central-1', 'ap-southeast-1', 'eu-west-1', 'eu-west-2'];
async function run() {
  let connected = false;
  for (const region of regions) {
    console.log('Trying region:', region);
    const client = new Client({
      host: 'aws-0-' + region + '.pooler.supabase.com',
      port: 6543,
      database: 'postgres',
      user: 'postgres.nxwldcpmwdvlbxukysuv',
      password: 'شمهةشفاثة111059@',
      ssl: { rejectUnauthorized: false }
    });
    try {
      await client.connect();
      connected = true;
      console.log('Connected to Supabase via', region);
      const sql = fs.readFileSync('C:/Users/ONE SHOT/.gemini/antigravity/brain/1340a4fc-88f6-4452-819f-31a48ead3910/schema.sql', 'utf8');
      await client.query(sql);
      console.log('Tables created successfully!');
      await client.end();
      break;
    } catch (err) {
      console.log('Failed for region', region);
    }
  }
  if (!connected) console.log('Could not connect to any region.');
}
run();
