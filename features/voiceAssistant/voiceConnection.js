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
     *
     * @param {import('discord.js').VoiceBasedChannel} voiceChannel
     * @returns {Promise<import('@discordjs/voice').VoiceConnection>}
     */
    async join(voiceChannel) {
        if (!voiceChannel) {
            throw new Error('No voice channel provided.');
        }

        this.channel = voiceChannel;
        this.guildId = voiceChannel.guild.id;

        // Check for existing connection in guild
        let existing = getVoiceConnection(this.guildId);
        if (existing) {
            if (existing.joinConfig.channelId === voiceChannel.id) {
                this.connection = existing;
                return existing;
            }
            existing.destroy();
        }

        // Establish connection
        this.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: this.guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: false, // Must be false to listen to audio!
            selfMute: false
        });

        this._setupStateHandlers();

        // Wait for connection to transition to Ready (up to 20 seconds)
        try {
            await entersState(this.connection, VoiceConnectionStatus.Ready, 20000);
            return this.connection;
        } catch (error) {
            this.leave();
            throw new Error(`Failed to establish voice connection within 20s: ${error.message}`);
        }
    }

    _setupStateHandlers() {
        if (!this.connection) return;

        this.connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`✓ Voice connection ready in channel: ${this.channel?.name}`);
            this.emit('ready');
        });

        this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
            console.warn(`Voice disconnected from channel: ${this.channel?.name}. Attempting reconnect...`);
            try {
                // Try reconnection with exponential backoff / timeout
                await Promise.race([
                    entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(this.connection, VoiceConnectionStatus.Connecting, 5000)
                ]);
            } catch (error) {
                console.error('Reconnection failed, cleaning up voice connection.');
                this.leave();
            }
        });

        this.connection.on(VoiceConnectionStatus.Destroyed, () => {
            this.emit('destroyed');
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

