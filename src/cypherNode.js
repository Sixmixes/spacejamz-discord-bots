const { Client, GatewayIntentBits, VoiceChannel } = require('discord.js');
const { joinVoiceChannel, EndBehaviorType } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

// Note: For a true production Cypher Node, we integrate `@discordjs/opus` and `prism-media` 
// to decode the raw Discord UDP payload into standard `.wav` files before Firebase transmission.

const nodeName = process.env.NODE_NAME || 'CYPHER_CORE';
const token = process.env.NODE_TOKEN;

if (!token) {
    console.error("FATAL: No cryptographic token supplied to Cypher container.");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.once('clientReady', () => {
    console.log(`🎙️ [${nodeName}] Vocal Extraction Suite Online -> ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Summoning the Cypher Bot
    if (message.content === '!cypher mount') {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) return message.reply("Matrix Denied: You must be securely locked into a VC to mount.");

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false, // Critical: We MUST be able to hear to record!
            });

            message.reply(`🎤 **${nodeName}** has breached the VC. Awaiting Vocal Telemetry... say \`!cypher record\``);
            
            // State tracking for the connection to attach to recording instances
            connection.receiver.speaking.on('start', (userId) => {
                // Future Implementation: Auto-clip isolation based on Voice Activation (VAD)
                // console.log(`[VAD DETECTED] Packet burst incoming from ${userId}`);
            });
            
        } catch (e) {
            console.error(e);
            message.reply("Transmission Failure: Could not establish a secure UDP pipeline.");
        }
    }

    // Manual Recording Protocol
    if (message.content.startsWith('!cypher record')) {
        const connection = client.voice.adapters.get(message.guild.id);
        if (!connection) return message.reply("I am not mounted to any VC in this Sector.");

        // We fetch the voice connection via internal map due to discordjs/voice abstracting it
        const receiver = connection.receiver;
        
        // Target the specific user who asked to record
        const targetUser = message.author.id;
        
        message.reply(`🔴 **RECORDING INITIATED** -> Drop the bars, <@${targetUser}>! I'm capturing your stream.`);

        try {
            const opusStream = receiver.subscribe(targetUser, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 5000, // Wait for 5 seconds of total silence before cutting the recording
                },
            });

            // Write raw Opus packets directly to disk (Phase 1)
            // Phase 2: Pipe through prism-media transcoder into standard PCM .wav
            const timestamp = Date.now();
            const outputPath = path.join(__dirname, `../recordings/cypher_${targetUser}_${timestamp}.pcm`);
            
            const writeStream = fs.createWriteStream(outputPath);

            // Establish the pipeline
            pipeline(opusStream, writeStream).then(() => {
                console.log(`[${nodeName}] Successfully captured and sealed vocal artifact for ${targetUser}.`);
                message.reply(`✅ **RECORDING SEALED**. Vocal Artifact captured and awaiting Firebase ingestion. (Total Silence detected)`);
                
                // FUTURE STEP: Automatically upload `outputPath` to Google Cloud SpaceJamz/users/${targetUser}/cyphers/
                // const bucket = admin.storage().bucket();
                // bucket.upload(outputPath, { destination: `...` })

            }).catch(e => {
                console.error("Vocal extraction pipeline corrupted:", e);
                message.reply("⚠️ Matrix Failure: Pipeline corrupted during vocal extraction.");
            });

        } catch (e) {
             console.error("Recording protocol rejected:", e);
             message.reply("⚠️ Matrix Failure: Could not establish recording receiver buffer.");
        }
    }
});

client.login(token);
