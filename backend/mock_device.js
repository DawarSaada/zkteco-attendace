const axios = require('axios');

const TARGET_URL = 'http://localhost:8088/iclock/cdata';
const DEVICE_SN = 'ZK123456789';

async function sendMockHandshake() {
    try {
        const res = await axios.get(`${TARGET_URL}?SN=${DEVICE_SN}`);
        console.log('Handshake response:', res.data);
    } catch (err) {
        console.error('Handshake error:', err.message);
    }
}

async function sendMockPunch(pin) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    // Format: PIN \t TIMESTAMP \t STATUS \t VERIFY_MODE
    const rawData = `${pin}\t${timestamp}\t0\t1\n`;

    try {
        const res = await axios.post(`${TARGET_URL}?SN=${DEVICE_SN}&table=ATTLOG`, rawData, {
            headers: { 'Content-Type': 'text/plain' }
        });
        console.log(`Punch response for PIN ${pin}:`, res.data);
    } catch (err) {
        console.error('Punch error:', err.message);
    }
}

async function run() {
    console.log('--- Sending Handshake ---');
    await sendMockHandshake();

    console.log('\n--- Sending Mock Punches ---');
    await sendMockPunch('101');
    setTimeout(() => sendMockPunch('102'), 1000);
}

run();
