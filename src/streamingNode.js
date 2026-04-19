const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior, StreamType, getVoiceConnection } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const nodeName = process.env.NODE_NAME || 'UNKNOWN_NODE';
const nodeSuffix = nodeName.split('_').pop().toLowerCase();
const symbolMap = { alpha: '!', beta: '?', gamma: '~', delta: '$', epsilon: '%', zeta: '^' };
const sym = symbolMap[nodeSuffix] || '!';
const polishedName = `SJ ${nodeSuffix.toUpperCase()}`;
const token = process.env.NODE_TOKEN;

if (!token) {
    console.error("FATAL: No cryptographic token supplied to node container.");
    process.exit(1);
}

const DJ_ROLE_ID = '1486257818427330610';

function isAuthorizedDJ(member) {
    if (!member) return false;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    if (member.roles.cache.has(DJ_ROLE_ID)) return true;
    return false;
}

function setupConnectionTrap(connection, guildId) {
    if (!connection._hasSpaceJamzTraps) {
        connection._hasSpaceJamzTraps = true;
        connection.on('stateChange', (oldState, newState) => {
            if (newState.status === VoiceConnectionStatus.Disconnected) {
                setTimeout(() => {
                    if (connection.state.status === VoiceConnectionStatus.Disconnected) {
                        try { connection.destroy(); } catch(e){}
                        globalQueues.delete(guildId);
                    }
                }, 3000);
            }
        });
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// ZERO-DOWNLOAD PASS-THROUGH ARCHITECTURE WITH GLOBAL QUEUE MAP
const globalQueues = new Map();

client.once('clientReady', () => {
    console.log(`=== ${nodeName} Online & Secured. Logged in as ${client.user.tag} ===`);
});

// ==========================================
// INTERACTIVE GUI BUTTON OVERRIDE LAYER
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('btn_')) return;

    const serverQueue = globalQueues.get(interaction.guildId);
    if (!serverQueue) {
        return interaction.reply({ content: `Matrix Protocol: No active audio stream mounted to this Node.`, ephemeral: true });
    }

    const memberVC = interaction.member?.voice?.channel;
    if (!memberVC || memberVC.id !== serverQueue.voiceChannel.id) {
        return interaction.reply({ content: `🚫 **Matrix Security:** You must physically occupy the same Voice Channel as **${polishedName}** to execute GUI overrides.`, ephemeral: true });
    }

    const { customId } = interaction;
    const activeSong = serverQueue.songs[0];
    const title = activeSong ? activeSong.title : "Unknown Artifact";

    if (customId === 'btn_voldown') {
        serverQueue.volume = Math.max(0.1, serverQueue.volume - 0.2);
        if (serverQueue.currentResource && serverQueue.currentResource.volume) {
            serverQueue.currentResource.volume.setVolume(serverQueue.volume);
        }
        return interaction.reply({ content: `🔉 **${polishedName} Gain:** Rendered down to ${(serverQueue.volume * 100).toFixed(0)}%`, ephemeral: true });
    }

    if (customId === 'btn_volup') {
        serverQueue.volume = Math.min(2.0, serverQueue.volume + 0.2);
        if (serverQueue.currentResource && serverQueue.currentResource.volume) {
            serverQueue.currentResource.volume.setVolume(serverQueue.volume);
        }
        return interaction.reply({ content: `🔊 **${polishedName} Gain:** Spiked up to ${(serverQueue.volume * 100).toFixed(0)}%`, ephemeral: true });
    }

    if (customId === 'btn_back') {
        if (serverQueue.history.length === 0) return interaction.reply({ content: `Matrix Engineering: History buffer is currently empty.`, ephemeral: true });
        const lastSong = serverQueue.history.pop();
        serverQueue.songs.unshift(lastSong); 
        serverQueue.forceBack = true;
        serverQueue.player.stop();
        return interaction.update({ content: `⏮️ **${polishedName}** rewound the timeline matrix.`, components: [] });
    }

    if (customId === 'btn_pause') {
        const stateStatus = serverQueue.player.state.status;
        if (stateStatus === AudioPlayerStatus.Paused || stateStatus === AudioPlayerStatus.AutoPaused) {
            serverQueue.player.unpause();
            return interaction.reply({ content: `▶️ **${polishedName}** dynamically streaming -> **${title}**`, ephemeral: true });
        } else {
            serverQueue.player.pause();
            return interaction.reply({ content: `⏸️ **${polishedName}** physically paused -> **${title}**`, ephemeral: true });
        }
    }

    if (customId === 'btn_skip') {
        serverQueue.forceSkip = true;
        serverQueue.player.stop();
        return interaction.update({ content: `⏭️ **${polishedName}** securely bypassed the track.`, embeds: interaction.message.embeds, components: [] });
    }

    if (customId === 'btn_stop') {
        if (!isAuthorizedDJ(interaction.member)) {
            return interaction.reply({ content: `🚫 **Access Denied:** Only a **DJ** can physically detach the Cypher Node.`, ephemeral: true });
        }
        
        serverQueue.player.stop();
        const conn = getVoiceConnection(interaction.guildId);
        if (conn) conn.destroy();
        globalQueues.delete(interaction.guildId);
        return interaction.update({ content: `🔌 **${polishedName}** detached from the main network.`, embeds: interaction.message.embeds, components: [] });
    }

    if (customId === 'btn_playlist' || customId === 'btn_queue') {
        if (serverQueue.songs.length === 0) return interaction.reply({ content: `🗂️ **Buffer:** Empty.`, ephemeral: true });
        
        const totalSongs = serverQueue.songs.length;
        const displayLimit = 15;
        let qArray = serverQueue.songs.slice(0, displayLimit).map((song, i) => `${i === 0 ? "▶️" : `*[${i}]*`} ${song.title}`);
        
        let extra = totalSongs > displayLimit ? `\n\n...and **${totalSongs - displayLimit}** more artifacts in hidden memory.` : "";
        let replyString = `🗂️ **${polishedName} Memory Queue** [Loop: \`${serverQueue.loopMode}\`] 🗂️\n\n${qArray.join('\n')}${extra}`;
        
        return interaction.reply({ content: replyString, ephemeral: true });
    }

    if (customId === 'btn_shuffle') {
        if (serverQueue.songs.length <= 1) return interaction.reply({ content: `Matrix Engineering: Array must contain > 1 artifacts.`, ephemeral: true });
        let upcoming = serverQueue.songs.slice(1);
        for (let i = upcoming.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
        }
        serverQueue.songs = [serverQueue.songs[0], ...upcoming];
        return interaction.reply({ content: `🔀 **${polishedName}** mathematically scrambled the upcoming timeline!`, ephemeral: true });
    }

    if (customId === 'btn_loop') {
        const flow = { 'none': 'song', 'song': 'queue', 'queue': 'none' };
        serverQueue.loopMode = flow[serverQueue.loopMode];
        return interaction.reply({ content: `♾️ **${polishedName} Auto-Loop:** Matrix core sequence set to \`${serverQueue.loopMode}\`.`, ephemeral: true });
    }

    if (customId === 'btn_autoplay') {
        serverQueue.autoplay = !serverQueue.autoplay;
        const msg = serverQueue.autoplay ? `✅ Sub-Neural **AutoPlay** Engine Engaged.` : `⛔ Sub-Neural **AutoPlay** Engine Disengaged.`;
        return interaction.reply({ content: msg, ephemeral: true });
    }
});

// ==========================================
// STRING / URL COMMAND PARSER LAYER
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === `${sym}status`) {
        return message.reply(`📡 **${polishedName}** is fully operational and awaiting Voice Channel insertion.`);
    }

    if (message.content === `${sym}help`) {
        return message.reply(`🎶 **${polishedName} Cypher Array Menu** 🎶\n\n• \`${sym}play <url/search>\` / \`${sym}p\` — YouTube, SoundCloud, BandLab, or Discord attachments.\n• \`${sym}join\` — Mount the matrix quietly.\n• \`${sym}skip\` / \`${sym}s\` — Skip the current track.\n• \`${sym}pause\` / \`${sym}resume\` — Halt/Restore UDP traffic.\n• \`${sym}volume <1-100>\` / \`${sym}vol\` — Adjust temporal bandwidth gain.\n• \`${sym}loop <none|song|queue>\` — Infinite loop sequencing.\n• \`${sym}remove <index>\` / \`${sym}rm\` — Delete a specific queue index.\n• \`${sym}queue\` / \`${sym}q\` — Inspect the active playlist array.\n• \`${sym}np\` — Now Playing metadata.\n• \`${sym}clear\` — Purge the queue memory entirely.\n• \`${sym}stop\` / \`${sym}leave\` / \`${sym}dc\` — Detach connection.\n\n*SpaceJamz Studio V3 Cluster Engine*`);
    }

    const commandStr = message.content.toLowerCase().trim();
    const isStop = commandStr === `${sym}leave` || commandStr === `${sym}stop` || commandStr === `${sym}disconnect` || commandStr === `${sym}dc`;
    const isSkip = commandStr === `${sym}skip` || commandStr === `${sym}s`;
    const isClear = commandStr === `${sym}clear`;
    const isQueue = commandStr === `${sym}queue` || commandStr === `${sym}q`;
    const isNp = commandStr === `${sym}np`;
    const isShuffle = commandStr === `${sym}shuffle` || commandStr === `${sym}sh`;
    let isPlay = commandStr.startsWith(`${sym}play `) || commandStr === `${sym}play` || commandStr.startsWith(`${sym}p `) || commandStr === `${sym}p`;
    
    // Playnext Protocol
    const isPlaynext = commandStr.startsWith(`${sym}playnext `) || commandStr === `${sym}playnext` || commandStr.startsWith(`${sym}pn `) || commandStr === `${sym}pn`;
    let isPlaynextFlag = false;
    if (isPlaynext) {
        isPlaynextFlag = true;
        isPlay = true;
    }
    
    const isJoin = commandStr === `${sym}join`;
    const isPause = commandStr === `${sym}pause`;
    const isResume = commandStr === `${sym}resume`;
    const isRm = commandStr.startsWith(`${sym}rm `) || commandStr.startsWith(`${sym}remove `);
    const isVolume = commandStr.startsWith(`${sym}volume `) || commandStr.startsWith(`${sym}v `) || commandStr.startsWith(`${sym}vol `);
    const isLoop = commandStr.startsWith(`${sym}loop `) || commandStr === `${sym}loop`;

    // Initialize or Fetch Server Queue
    let serverQueue = globalQueues.get(message.guild.id);

    const requiresVC = isStop || isSkip || isClear || isPause || isResume || isRm || isVolume || isLoop || isShuffle || isPlay || isJoin;
    if (requiresVC) {
        const memberVC = message.member?.voice?.channel;
        if (!memberVC) {
            return message.reply(`🚫 **Matrix Security:** You must physically occupy a Voice Channel to interface with the Node.`);
        }
        if (!isJoin && serverQueue && memberVC.id !== serverQueue.voiceChannel.id) {
            if (isAuthorizedDJ(message.member) && (isStop || isClear)) {
                // Allow DJs to brutally force-stop or force-clear a trapped Cypher Node from anywhere!
            } else {
                return message.reply(`🚫 **Network Breach:** You must be connected to the exact Voice Channel operated by **${polishedName}**.`);
            }
        }
    }

    if (isStop) {
        if (!isAuthorizedDJ(message.member)) return message.reply(`🚫 **Access Denied:** Only a **DJ** can physically detach the Cypher Node.`);
        
        if (serverQueue && serverQueue.inactivityTimer) clearTimeout(serverQueue.inactivityTimer);
        globalQueues.delete(message.guild.id);
        const connection = getVoiceConnection(message.guild.id);
        if (connection) {
            connection.destroy();
            return message.reply(`🔌 **${polishedName}** has fully detached from the Matrix and purged its memory cache.`);
        } else {
            return message.reply(`Matrix Protocol: **${polishedName}** is not occupying a Voice Channel.`);
        }
    }

    if (isJoin) {
        const voiceChannel = message.member?.voice?.channel;
        
        if (!serverQueue) {
            serverQueue = createEmptyQueue(message, voiceChannel);
            globalQueues.set(message.guild.id, serverQueue);
            try {
                serverQueue.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: voiceChannel.guild.id, adapterCreator: voiceChannel.guild.voiceAdapterCreator });
                serverQueue.connection.subscribe(serverQueue.player);
                setupConnectionTrap(serverQueue.connection, message.guild.id);
                return message.reply(`🔗 **${polishedName}** has securely mounted the VC. Awaiting telemetry.`);
            } catch (err) {
                globalQueues.delete(message.guild.id);
                return message.channel.send("System Error: Could not penetrate the target VC.");
            }
        } else {
            if (serverQueue.voiceChannel.id === voiceChannel.id) {
                return message.reply(`Matrix Protocol: **${polishedName}** is already occupying this exact VC.`);
            }
            if (serverQueue.songs.length > 0) {
                return message.reply(`🚫 **Access Denied:** **${polishedName}** is currently executing an active timeline in another Voice Channel. You must deploy a dormant Cypher Node.`);
            }
            
            try {
                serverQueue.voiceChannel = voiceChannel;
                serverQueue.textChannel = message.channel; 
                serverQueue.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: voiceChannel.guild.id, adapterCreator: voiceChannel.guild.voiceAdapterCreator });
                serverQueue.connection.subscribe(serverQueue.player);
                setupConnectionTrap(serverQueue.connection, message.guild.id);
                return message.reply(`🔗 **${polishedName} Matrix Relocation:** Successfully bypassed security and translated dormant Cypher Node seamlessly to **${voiceChannel.name}**.`);
            } catch (err) {
                return message.channel.send("System Error: Matrix Relocation Sequence failed.");
            }
        }
    }

    if (isSkip) {
        if (!serverQueue || !serverQueue.playing) return message.reply(`Matrix Protocol: Local queue is currently empty.`);
        message.reply(`⏭️ **${polishedName}** skipping injected artifact...`);
        serverQueue.forceSkip = true;
        serverQueue.player.stop();
        return;
    }

    if (isPause) {
        if (!serverQueue) return message.reply(`Matrix Protocol: No active buffer to pause.`);
        const stateStatus = serverQueue.player.state.status;
        if (stateStatus === AudioPlayerStatus.Paused || stateStatus === AudioPlayerStatus.AutoPaused) return message.reply(`Matrix Protocol: Buffer is already paused.`);
        
        serverQueue.player.pause();
        return message.reply(`⏸️ **${polishedName}** audio sequencer physically halted.`);
    }

    if (isResume) {
        if (!serverQueue) return message.reply(`Matrix Protocol: No active buffer to resume.`);
        serverQueue.player.unpause();
        return message.reply(`▶️ **${polishedName}** UDP flow restored.`);
    }

    if (isClear) {
        if (!isAuthorizedDJ(message.member)) return message.reply(`🚫 **Access Denied:** Purging the global queue memory requires the **DJ** Role.`);
        if (!serverQueue) return message.reply(`Matrix Protocol: No active buffer to purge.`);
        serverQueue.songs.splice(1); 
        serverQueue.forceSkip = true; 
        serverQueue.player.stop();
        return message.reply(`💥 **${polishedName}** has violently purged its global audio cache.`);
    }

    if (isQueue) {
        if (!serverQueue || serverQueue.songs.length === 0) return message.reply(`🗂️ **${polishedName} Buffer:** Empty.`);
        
        const totalSongs = serverQueue.songs.length;
        const displayLimit = 15;
        let qArray = serverQueue.songs.slice(0, displayLimit).map((song, i) => `${i === 0 ? "▶️" : `*[${i}]*`} ${song.title}`);
        
        let extra = totalSongs > displayLimit ? `\n\n...and **${totalSongs - displayLimit}** more artifacts in hidden memory.` : "";
        let replyString = `🗂️ **${polishedName} Memory Queue** [Loop: \`${serverQueue.loopMode}\`] 🗂️\n\n${qArray.join('\n')}${extra}`;
        
        return message.reply(replyString);
    }

    if (isNp) {
        if (!serverQueue || serverQueue.songs.length === 0) return message.reply(`🗂️ **${polishedName} Buffer:** Empty.`);
        return message.reply(`📻 **Now Playing natively in ${polishedName}:**\n\n${serverQueue.songs[0].title} | \`${serverQueue.songs[0].url}\``);
    }

    if (isShuffle) {
        if (!serverQueue || serverQueue.songs.length <= 1) return message.reply(`🗂️ **${polishedName} Buffer:** Not enough artifacts to shuffle.`);
        let upcoming = serverQueue.songs.slice(1);
        for (let i = upcoming.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
        }
        serverQueue.songs = [serverQueue.songs[0], ...upcoming];
        return message.reply(`🔀 **${polishedName} Cache:** The timeline has been physically rearranged.`);
    }

    if (isLoop) {
        if (!serverQueue) return;
        const args = message.content.trim().split(/ +/);
        const mode = args[1];
        if (mode === 'song' || mode === 'queue' || mode === 'none') {
            serverQueue.loopMode = mode;
            return message.reply(`♾️ **${polishedName} Loop Core:** Configured to \`${mode}\`.`);
        } else {
            return message.reply(`Matrix Protocol: Invalid loop mode. Usage: \`${sym}loop <none|song|queue>\``);
        }
    }

    if (isVolume) {
        if (!serverQueue) return;
        const args = message.content.trim().split(/ +/);
        const vol = parseInt(args[1]);
        if (isNaN(vol) || vol < 1 || vol > 200) return message.reply(`Matrix Protocol: Provide target bandwidth (1-200).`);
        
        serverQueue.volume = vol / 100;
        if (serverQueue.currentResource && serverQueue.currentResource.volume) {
            serverQueue.currentResource.volume.setVolume(serverQueue.volume);
        }
        return message.reply(`🔊 **${polishedName} Gain:** Target locked at ${(serverQueue.volume * 100).toFixed(0)}%`);
    }

    if (isRm) {
        if (!serverQueue || serverQueue.songs.length <= 1) return message.reply(`Matrix Protocol: Array too shallow to delete indices.`);
        const args = message.content.trim().split(/ +/);
        const index = parseInt(args[1]);
        if (isNaN(index) || index < 1 || index >= serverQueue.songs.length) return message.reply(`Matrix Protocol: Execute with a valid Queue Index (Type \`${sym}q\` to inspect array).`);
        
        const removedItem = serverQueue.songs.splice(index, 1)[0];
        return message.reply(`🗑️ **${polishedName} Memory:** Safely extracted \`${removedItem.title}\` from Sequence [${index}].`);
    }

    if (isPlay) {
        const args = message.content.trim().split(/ +/);
        let url = args.slice(1).join(' '); // Capture entire query string

        // Discord Native Attachment Extraction Pipeline
        if (!url && message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment.url.match(/\.(mp3|wav|m4a|ogg|flac)(\?|$)/i)) {
                url = attachment.url;
            } else {
                return message.reply(`Matrix Protocol: Uploaded artifact must be a valid audio file type (.mp3, .wav, .m4a).`);
            }
        }

        if (!url || url.trim() === '') return message.reply(`Matrix Protocol: Submit valid payload. Example: \`${sym}play <url>\` or upload a file.`);

        const voiceChannel = message.member?.voice?.channel;

        // Custom Extraction Overrides
        let customTitleOverride = null;
        if ((url.includes('suno.com') || url.includes('suno.ai')) && !url.includes('/playlist/')) {
            const m = await message.reply(`⏱️ **${polishedName}** is bypassing Suno Neural Firewalls...`);
            try {
                const res = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                });
                const html = await res.text();
                
                const titleMatch = html.match(/<title>(.*?)<\/title>/i);
                if (titleMatch && titleMatch[1]) {
                    customTitleOverride = titleMatch[1].replace(' | Suno', '').replace(' - Suno', '').trim();
                }

                const finalUrl = res.url || url;
                const uuidMatch = finalUrl.match(/\/song\/([a-f0-9-]+)/i) || html.match(/\/song\/([a-f0-9-]+)/i);
                
                if (uuidMatch && uuidMatch[1]) {
                    const uuid = uuidMatch[1];
                    url = `https://cdn1.suno.ai/${uuid}.mp3`;
                    m.edit(`🔓 **Suno Extracted:** Neural link established.`);
                } else {
                    return m.edit("Matrix Protocol: Suno extraction failed. UUID not discovered.");
                }
            } catch (err) {
                return m.edit("Matrix Protocol: Suno redirect layer timed out.");
            }
        }

        // Custom Spotify Semantic Extraction Override
        if (url.includes('spotify.com/track/')) {
            const m = await message.reply(`⏱️ **${polishedName}** is decrypting Spotify track matrix...`);
            try {
                const res = await fetch(url);
                const html = await res.text();
                
                const titleMatch = html.match(/<title>(.*?)<\/title>/i);
                if (titleMatch && titleMatch[1]) {
                    // Extract track name and artist while stripping Spotify branding. Result format: "TrackName Artist"
                    const spotifyTitleOverride = titleMatch[1].replace(/ - song and lyrics by /gi, ' ').replace(/ \| Spotify/gi, '').trim();
                    url = spotifyTitleOverride;
                    m.edit(`🔓 **Spotify Decrypted:** Rerouting natively via youtube search -> \`${url}\``);
                } else {
                    return m.edit("Matrix Protocol: Spotify extraction failed. Anti-Bot Firewall intact.");
                }
            } catch (err) {
                return m.edit("Matrix Protocol: Spotify redirect layer timed out. Node disconnected.");
            }
        }

        // Custom BandLab Extraction Override
        if (url.includes('bandlab.com/track/') || url.includes('bandlab.com/post/')) {
            const m = await message.reply(`⏱️ **${polishedName}** is accessing BandLab archives...`);
            try {
                const match = url.match(/\/(track|post)\/([a-f0-9-]+)/i);
                if (match && match[2]) {
                    const trackId = match[2];
                    const apiUrl = `https://www.bandlab.com/api/v1.3/posts/${trackId}`;
                    const res = await fetch(apiUrl);
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.revision && data.revision.audioUrl) {
                            url = data.revision.audioUrl;
                            if (data.revision.title) {
                                customTitleOverride = data.revision.title;
                            }
                            m.edit(`🔓 **BandLab Extracted:** Neural link established -> \`${customTitleOverride || 'Unknown Track'}\``);
                        } else {
                            return m.edit("Matrix Protocol: BandLab extraction failed. Audio URL not found.");
                        }
                    } else if (res.status === 403) {
                        return m.edit("Matrix Protocol: BandLab Access Denied (403). This track might be private.");
                    } else {
                        return m.edit(`Matrix Protocol: BandLab API Error (${res.status}).`);
                    }
                } else {
                    return m.edit("Matrix Protocol: Invalid BandLab link structure.");
                }
            } catch (err) {
                return m.edit("Matrix Protocol: BandLab extraction layer encountered a fatal error.");
            }
        }

        // Generate Metadata asynchronously without freezing event loop
        let isDirectUrl = false;
        try { new URL(url); isDirectUrl = true; } catch (e) {}
        
        // Native YouTube Semantic Search Override
        if (!isDirectUrl && !url.match(/\.(mp3|wav|m4a|ogg|flac)(\?|$)/i)) {
            url = `ytsearch1:${url}`;
        }

        let titleBlock = customTitleOverride || url.split('/').pop().split('?')[0]; 
        const isDirectAudio = url.match(/\.(mp3|wav|m4a|ogg|flac)(\?|$)/i);
        
        try {
            const infoMsg = await message.reply(`📡 Traversing node metadata...`);
            
            let info = null;
            if (!isDirectAudio) {
                info = await youtubedl(url, { dumpSingleJson: true, noWarnings: true, noCallHome: true, noCheckCertificate: true, flatPlaylist: true }).catch(()=>null);
            }
            
            // ==========================================
            // PLAYLIST ARRAY EXTRACTION PROTOCOL
            // ==========================================
            if (info && info.entries && Array.isArray(info.entries)) {
                if (!isAuthorizedDJ(message.member)) {
                    return infoMsg.edit(`🚫 **Access Denied:** Mass Playlist Injection requires the **DJ** Role.`);
                }

                if (info.entries.length === 0) {
                    return infoMsg.edit(`⚠️ **Matrix Protocol:** Search query yielded 0 results.`);
                }
                
                infoMsg.edit(`🗂️ **Artifact Discovered:** Injecting temporal coordinates...`).catch(()=>null);
                
                const tracks = info.entries.map(e => ({
                    url: e.url || e.webpage_url || `https://youtube.com/watch?v=${e.id}`,
                    title: e.title || "ENCRYPTED MATRIX ARTIFACT",
                    requester: message.author.tag
                }));

                if (!serverQueue) {
                    serverQueue = createEmptyQueue(message, voiceChannel);
                    globalQueues.set(message.guild.id, serverQueue);
                    serverQueue.songs = tracks;

                    try {
                        serverQueue.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: voiceChannel.guild.id, adapterCreator: voiceChannel.guild.voiceAdapterCreator });
                        serverQueue.connection.subscribe(serverQueue.player);
                        setupConnectionTrap(serverQueue.connection, message.guild.id);
                        executeQueueEngine(message.guild.id);
                    } catch (err) {
                        globalQueues.delete(message.guild.id);
                        return message.channel.send("System Error: Could not penetrate the target VC.");
                    }
                } else {
                    if (isPlaynextFlag) {
                        serverQueue.songs.splice(1, 0, ...tracks);
                        message.channel.send(`⚡ **${polishedName} Cache Override:** Priority injected [${tracks.length}] new artifacts.`);
                    } else {
                        serverQueue.songs.push(...tracks);
                        message.channel.send(`✅ **${polishedName} Cache:** Mass-injected [${tracks.length}] new artifacts.`);
                    }

                    if (!serverQueue.playing) executeQueueEngine(message.guild.id);
                }
                return; // Completely bypass single-track execution below
            }

            // STANDARD SINGLE TRACK PROTOCOL
            if (info && info.title) titleBlock = info.title;
            infoMsg.delete().catch(()=>null);
        } catch(e) {}

        const trackPayload = { url: url, title: titleBlock, requester: message.author.tag };

        if (!serverQueue) {
            serverQueue = createEmptyQueue(message, voiceChannel);
            globalQueues.set(message.guild.id, serverQueue);
            serverQueue.songs.push(trackPayload);

            try {
                serverQueue.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: voiceChannel.guild.id, adapterCreator: voiceChannel.guild.voiceAdapterCreator  });
                serverQueue.connection.subscribe(serverQueue.player);
                setupConnectionTrap(serverQueue.connection, message.guild.id);
                executeQueueEngine(message.guild.id);
            } catch (err) {
                globalQueues.delete(message.guild.id);
                return message.channel.send("System Error: Could not penetrate the target VC.");
            }
        } else {
            // Queue Append
            if (isPlaynextFlag) {
                if (!isAuthorizedDJ(message.member)) return message.reply(`🚫 **Access Denied:** The \`${sym}playnext\` timeline override requires the **DJ** Role.`);
                serverQueue.songs.splice(1, 0, trackPayload);
                message.reply(`⚡ **${polishedName} Cache Override:** Priority Injection accepted -> _${trackPayload.title}_`);
            } else {
                serverQueue.songs.push(trackPayload);
                message.reply(`✅ **${polishedName} Cache:** Injection accepted -> _${trackPayload.title}_`);
            }
            
            if (!serverQueue.playing) {
                executeQueueEngine(message.guild.id);
            }
            return;
        }
    }
});

function createEmptyQueue(message, voiceChannel) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    
    const queueObj = {
        textChannel: message.channel,
        voiceChannel: voiceChannel,
        connection: null,
        player: player,
        songs: [],
        history: [], // Historical buffer for back rewinds
        playing: false,
        inactivityTimer: null,
        forceSkip: false,
        forceBack: false,
        volume: 1.0,
        autoplay: false,
        loopMode: 'none',
        currentResource: null
    };

    player.on(AudioPlayerStatus.Playing, () => {
        queueObj.playing = true;
        if (queueObj.inactivityTimer) clearTimeout(queueObj.inactivityTimer);
    });

    player.on(AudioPlayerStatus.Idle, () => {
        queueObj.playing = false;
        const prevSong = queueObj.songs[0];
        
        if (queueObj.forceBack) {
            queueObj.forceBack = false;
            // The array has already been prepended internally by the interaction handler
        } else if (queueObj.forceSkip) {
            queueObj.forceSkip = false;
            queueObj.history.push(queueObj.songs.shift()); 
        } else {
            if (queueObj.loopMode === 'song') {
                // Do not alter index 0
            } else if (queueObj.loopMode === 'queue') {
                queueObj.history.push(queueObj.songs.shift());
                if (prevSong) queueObj.songs.push(prevSong);
            } else {
                queueObj.history.push(queueObj.songs.shift()); 
            }
        }
        executeQueueEngine(message.guild.id); 
    });

    player.on('error', error => {
        console.error(`Player Error: ${error.message}`);
        queueObj.textChannel.send(`⚠️ **${polishedName}** encountered a playback error. Skipping corrupt track...`);
        queueObj.forceSkip = true;
        queueObj.player.stop(); 
    });

    return queueObj;
}

// Primary Recursive Physics Engine
function executeQueueEngine(guildId) {
    const queue = globalQueues.get(guildId);
    if (!queue || !queue.connection) return;

    if (queue.songs.length === 0) {
        queue.playing = false;
        queue.textChannel.send(`🗂️ **Buffer Exhausted:** The SpaceJamz Memory Array is currently empty. Node will detach in 3 minutes.`);
        queue.inactivityTimer = setTimeout(() => {
            const conn = getVoiceConnection(guildId);
            if (conn) conn.destroy();
            globalQueues.delete(guildId);
            queue.textChannel.send(`🔌 **${polishedName}** sequence detached due to cache exhaustion and 3 minutes of inactivity.`);
        }, 180000);
        return;
    }

    if (queue.inactivityTimer) clearTimeout(queue.inactivityTimer);

    const activeTrack = queue.songs[0];
    
    // GUI Button Generator Architecture
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_voldown').setLabel('Down').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_back').setLabel('Back').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_pause').setLabel('Pause').setEmoji('⏯️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_skip').setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_volup').setLabel('Up').setEmoji('🔊').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_shuffle').setLabel('Shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_loop').setLabel('Loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_stop').setLabel('Stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('btn_autoplay').setLabel('AutoPlay').setEmoji('💽').setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_playlist').setLabel('Playlist').setEmoji('📋').setStyle(ButtonStyle.Secondary)
    );

    // Search the active guild caches for the spinning disk emoji
    const playingEmoji = client.emojis.cache.find(e => e.name === 'playing');
    const authorIconUrl = playingEmoji ? playingEmoji.url : null; 

    // If no icon found, just prepend a standard CD emoji to the title string
    const authorNameLabel = authorIconUrl ? activeTrack.title : `💿 ${activeTrack.title}`;

    const embed = new EmbedBuilder()
        .setColor('#161618')
        .setAuthor({ name: authorNameLabel, iconURL: authorIconUrl || undefined })
        .addFields(
            { name: '🙋 Requested By', value: `${activeTrack.requester || '@SpaceJamz'}`, inline: true },
            { name: '🎧 Music Author', value: `Unknown Artifact`, inline: true },
            { name: '🔄 Queue length', value: `${queue.songs.length} songs`, inline: true },
            { name: '⏱️ Music Duration', value: `Live Stream`, inline: true }
        );
        
    if (activeTrack.thumbnail) embed.setThumbnail(activeTrack.thumbnail);

    queue.textChannel.send({
        embeds: [embed],
        components: [row1, row2, row3]
    });

    const subprocess = youtubedl.exec(activeTrack.url, {
        output: '-', quiet: true, format: 'bestaudio', limitRate: '1M',
        noWarnings: true, noCallHome: true, noCheckCertificate: true,
    }, { stdio: ['ignore', 'pipe', 'ignore'] });
    
    subprocess.catch((err) => {
        // Suppress Execa Exit Code Errors & physical EPIPE exceptions natively
        // This prevents the UnhandledRejection module from executing 3MB binary FFMPEG stdout dumps into console.error
    });
    
    // Transcode to PCM s16le for software volume scaling
    const transcoder = spawn(ffmpegPath, [
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    subprocess.stdout.pipe(transcoder.stdin);

    const resource = createAudioResource(transcoder.stdout, { 
        inputType: StreamType.Raw,
        inlineVolume: true
    });
    
    if (resource.volume) {
        resource.volume.setVolume(queue.volume);
    }

    queue.currentResource = resource;
    queue.player.play(resource);
}

process.on('unhandledRejection', error => {
    // If it's a binary dump or spawn error, do not completely freeze the VM
    if (error && error.stdout && error.stdout.length > 5000) {
        console.error(`[${nodeName} UNHANDLED REJECTION] Structural Binary Subprocess Exited (EPIPE)`);
    } else {
        console.error(`[${nodeName} UNHANDLED REJECTION]`, error);
    }
});
process.on('uncaughtException', error => console.error(`[${nodeName} UNCAUGHT EXCEPTION]`, error));

client.login(token);
