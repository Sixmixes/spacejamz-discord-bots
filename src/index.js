require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

// ==========================================
// SPACEJAMZ VORTEX: The 7-Node Discord Cluster
// ==========================================
// Deploying 6 stream-only pass-through bots (Jockie-clones)
// Deploying 1 dedicated VC Audio Recording Bot (The Cypher)

const nodes = [
    { name: 'STREAM_NODE_ALPHA', token: process.env.TOKEN_NODE_1, type: 'streaming' },
    { name: 'STREAM_NODE_BETA', token: process.env.TOKEN_NODE_2, type: 'streaming' },
    { name: 'STREAM_NODE_GAMMA', token: process.env.TOKEN_NODE_3, type: 'streaming' },
    { name: 'STREAM_NODE_DELTA', token: process.env.TOKEN_NODE_4, type: 'streaming' },
    { name: 'STREAM_NODE_EPSILON', token: process.env.TOKEN_NODE_5, type: 'streaming' },
    { name: 'STREAM_NODE_ZETA', token: process.env.TOKEN_NODE_6, type: 'streaming' },
    { name: 'CYPHER_RECORDING_CORE', token: process.env.TOKEN_CYPHER, type: 'recording' }
];

console.log("///////////////////////////////////////////////");
console.log("/// SPACEJAMZ DISCORD CLUSTER INITIALIZING ///");
console.log("///////////////////////////////////////////////\n");

nodes.forEach((nodeConfig, index) => {
    if (!nodeConfig.token) {
        console.warn(`[WARNING] Skipping ${nodeConfig.name} - No Token found in .env`);
        return;
    }

    const scriptName = nodeConfig.type === 'streaming' ? 'streamingNode.js' : 'cypherNode.js';
    const scriptPath = path.join(__dirname, scriptName);

    console.log(`[BOOT] Initiating ${nodeConfig.name} via ${scriptName}...`);

    const child = spawn('node', [scriptPath], {
        env: { ...process.env, NODE_NAME: nodeConfig.name, NODE_TOKEN: nodeConfig.token }
    });

    child.stdout.on('data', (data) => console.log(`[${nodeConfig.name}] ${data.toString().trim()}`));
    child.stderr.on('data', (data) => console.error(`[${nodeConfig.name} ERROR] ${data.toString().trim()}`));
    child.on('close', (code) => console.log(`[${nodeConfig.name}] Terminated with code ${code}`));
});
