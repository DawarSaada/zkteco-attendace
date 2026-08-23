require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 8088;

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_SUPABASE_SERVICE_ROLE_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());

// ADMS pushes data using text/plain or application/octet-stream, so we need raw body parsing
app.use(express.text({ type: '*/*' })); 
app.use(express.json());

// -------------------------------------------------------------
// ADMS Endpoints (Standard ZKTeco ADMS paths)
// -------------------------------------------------------------

// 1. Device Handshake / Get Request
app.get('/iclock/cdata', (req, res) => {
    console.log('[ADMS Handshake]', req.query);
    // Respond with ok to let the device know the server is ready
    res.status(200).send("OK\n");
});

// 2. Device Pushes Data (Attendance logs, user data, etc.)
app.post('/iclock/cdata', async (req, res) => {
    const { SN, table } = req.query; // SN is device serial number, table indicates data type (e.g., ATTLOG)
    console.log(`[ADMS POST] SN: ${SN}, Table: ${table}`);
    
    // Update device last active status
    if (SN) {
        await supabase
            .from('devices')
            .upsert({ sn: SN, last_active: new Date().toISOString() }, { onConflict: 'sn' });
    }

    if (table === 'ATTLOG') {
        const rawData = req.body;
        // Example rawData: "1\t2023-10-25 09:00:00\t0\t1\n2\t2023-10-25 09:05:00\t0\t1"
        const lines = typeof rawData === 'string' ? rawData.trim().split('\n') : [];
        
        for (const line of lines) {
            if (!line) continue;
            // Common ADMS format: PIN \t TIMESTAMP \t STATUS \t VERIFY_MODE
            const parts = line.split('\t');
            if (parts.length >= 2) {
                const pin = parts[0];
                const timestamp = parts[1];
                const status = parts[2] || '0';
                const verifyMode = parts[3] || '0';

                // Insert into Supabase
                const { error } = await supabase
                    .from('attendance_logs')
                    .insert([{
                        sn: SN,
                        pin: pin,
                        timestamp: new Date(timestamp).toISOString(),
                        status: status,
                        verify_mode: verifyMode
                    }])
                    .select();

                if (error && error.code !== '23505') { // ignore unique violation (duplicate log)
                    console.error('Error inserting log:', error.message);
                }
            }
        }
    } else if (table === 'USERINFO') {
        const rawData = req.body;
        const lines = typeof rawData === 'string' ? rawData.trim().split('\n') : [];
        for (const line of lines) {
            if (!line) continue;
            // Format: PIN \t Name \t Password \t Card \t Privilege ...
            const parts = line.split('\t');
            if (parts.length >= 2) {
                const pin = parts[0];
                const name = parts[1] || `User ${pin}`;
                
                await supabase
                    .from('employees')
                    .upsert({ pin: pin, full_name: name }, { onConflict: 'pin' });
            }
        }
    }

    res.status(200).send("OK\n");
});

app.get('/iclock/getrequest', (req, res) => {
    const { SN } = req.query;
    console.log(`[ADMS GetRequest] SN: ${SN}`);
    
    // Queue commands to force the device to sync its local data to the server
    // Format: C:<Command ID>:<Command String>
    let commands = "";
    
    // Command 1: Request all new attendance logs
    commands += "C:1:DATA QUERY ATTLOG\n";
    // Command 2: Request all user information (names/pins)
    commands += "C:2:DATA QUERY USERINFO\n";
    
    res.status(200).send(commands || "OK\n");
});

// -------------------------------------------------------------
// Helper / Health Endpoints
// -------------------------------------------------------------
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date() });
});

app.listen(PORT, () => {
    console.log(`ZKTeco ADMS Listener running on port ${PORT}`);
});
