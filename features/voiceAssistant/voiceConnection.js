/**
 * voiceConnection.js
 * Manages the Discord voice connection lifecycle, permissions check,
 * reconnection handling, and connection state transitions.
 */

const {
    joinVoiceChannel,
    getVoiceConnection,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const { PermissionFlagsBits } = require('discord.js');
const EventEmitter = require('events');

class VoiceConnectionManager extends EventEmitter {
    constructor() {
        super();
        this.connection = null;
        this.channel = null;
        this.guildId = null;
    }

    /**
     * Checks if the client bot has Connect and Speak permissions in the target channel.
     *
     * @param {import('discord.js').VoiceBasedChannel} voiceChannel
     * @param {import('discord.js').Client} client
     * @returns {{ hasPermissions: boolean, missing: string[] }}
     */
    checkPermissions(voiceChannel, client) {
        const permissions = voiceChannel.permissionsFor(client.user);
        const missing = [];

        if (!permissions.has(PermissionFlagsBits.Connect)) {
            missing.push('Connect');
        }
        if (!permissions.has(PermissionFlagsBits.Speak)) {
            missing.push('Speak');
        }

        return {
            hasPermissions: missing.length === 0,
            missing
        };
    }

    /**
     * Joins a voice channel and waits for the connection to become Ready.
     * Includes automatic retry with clean gateway state resets.
     *
     * @param {import('discord.js').VoiceBasedChannel} voiceChannel
     * @param {number} maxRetries Maximum connection attempts (default 2)
     * @returns {Promise<import('@discordjs/voice').VoiceConnection>}
     */
    async join(voiceChannel, maxRetries = 2) {
        if (!voiceChannel) {
            throw new Error('No voice channel provided.');
        }

        this.channel = voiceChannel;
        this.guildId = voiceChannel.guild.id;

        // Check for existing connection in guild
        let existing = getVoiceConnection(this.guildId);
        if (existing) {
            if (existing.joinConfig.channelId === voiceChannel.id && existing.state.status === VoiceConnectionStatus.Ready) {
                this.connection = existing;
                return existing;
            }
            try {
                console.log(`[VoiceConnection] Resetting existing voice connection in guild ${this.guildId}...`);
                existing.destroy();
            } catch (e) {}
            // Allow Discord Gateway to process the state cleanup
            await new Promise(r => setTimeout(r, 600));
        }

        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[VoiceConnection] Attempting connection to #${voiceChannel.name} (Attempt ${attempt}/${maxRetries})...`);

                this.connection = joinVoiceChannel({
                    channelId: String(voiceChannel.id),
                    guildId: String(this.guildId),
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: false, // Must be false to listen to audio!
                    selfMute: false
                });

                this._setupStateHandlers();

                // Wait up to 20s for connection to transition to Ready
                await entersState(this.connection, VoiceConnectionStatus.Ready, 20000);
                console.log(`✓ Voice connection ready in channel: #${voiceChannel.name}`);
                return this.connection;
            } catch (error) {
                lastError = error;
                console.warn(`[VoiceConnection] Attempt ${attempt} failed for #${voiceChannel.name}: ${error.message}`);
                
                try {
                    this.connection?.destroy();
                } catch (e) {}
                this.connection = null;

                if (attempt < maxRetries) {
                    console.log('[VoiceConnection] Retrying connection in 1.5 seconds...');
                    await new Promise(r => setTimeout(r, 1500));
                }
            }
        }

        this.leave();
        throw new Error(`Failed to establish voice connection after ${maxRetries} attempts: ${lastError?.message || 'Connection timed out'}`);
    }

    _setupStateHandlers() {
        if (!this.connection) return;

        this.connection.on('stateChange', (oldState, newState) => {
            if (oldState.status === newState.status) return;
            console.log(`[VoiceConnection] #${this.channel?.name || 'VC'} state: ${oldState.status} -> ${newState.status}`);
        });

        this.connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`✓ Voice connection ready in channel: ${this.channel?.name}`);
            this.emit('ready');
        });

        this.connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
            // Only handle unexpected disconnects if the connection was previously Ready.
            // During initial connection handshakes, Discord may briefly transition states;
            // prematurely destroying the connection here aborts the initial join!
            if (oldState.status !== VoiceConnectionStatus.Ready) {
                return;
            }

            console.warn(`Voice disconnected from channel: ${this.channel?.name}. Attempting reconnect...`);
            try {
                // If disconnected due to Discord voice server rotation, wait for Signalling/Connecting
                await Promise.race([
                    entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(this.connection, VoiceConnectionStatus.Connecting, 5000)
                ]);
                // If it transitioned to reconnecting, wait for Ready
                await entersState(this.connection, VoiceConnectionStatus.Ready, 15000);
                console.log(`✓ Voice reconnected successfully in channel: ${this.channel?.name}`);
            } catch (error) {
                console.error('Reconnection failed, cleaning up voice connection.');
                this.leave();
            }
        });

        this.connection.on(VoiceConnectionStatus.Destroyed, () => {
            this.emit('destroyed');
        });

        this.connection.on('error', (err) => {
            // Suppress benign internal UDP socket teardown notifications during reconnects/disconnects
            if (err.message && err.message.includes('Cannot perform IP discovery - socket closed')) {
                return;
            }
            console.warn(`Voice connection notice in channel ${this.channel?.name}:`, err.message);
        });
    }

    /**
     * Disconnects from the voice channel and releases resources.
     */
    leave() {
        if (this.connection) {
            try {
                this.connection.destroy();
            } catch (e) {
                console.warn('Error destroying voice connection:', e.message);
            }
            this.connection = null;
        }
        this.channel = null;
    }

    /**
     * Returns detailed status of the connection.
     * @returns {object}
     */
    getStatus() {
        if (!this.connection) {
            return {
                isConnected: false,
                status: 'disconnected',
                channelId: null,
                channelName: null
            };
        }

        return {
            isConnected: this.connection.state.status === VoiceConnectionStatus.Ready,
            status: this.connection.state.status,
            channelId: this.channel?.id || null,
            channelName: this.channel?.name || null,
            ping: this.connection.ping?.ws || null
        };
    }
}

module.exports = { VoiceConnectionManager };

