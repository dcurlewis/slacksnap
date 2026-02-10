/**
 * Options page script for SlackSnap extension
 */

// DOM elements
const form = document.getElementById('optionsForm');
const statusDiv = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');

// Channel management elements
const channelsJsonEl = document.getElementById('channelsJson');
const channelStatusDiv = document.getElementById('channelStatus');
const saveChannelsBtn = document.getElementById('saveChannelsBtn');
const resetChannelsBtn = document.getElementById('resetChannelsBtn');
const addChannelBtn = document.getElementById('addChannelBtn');

/**
 * Load saved settings when page loads
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const config = await getConfig();
        
        // Populate form fields
        document.getElementById('downloadDirectory').value = config.downloadDirectory;
        document.getElementById('fileNameFormat').value = config.fileNameFormat;
        document.getElementById('includeTimestamps').checked = config.includeTimestamps;
        document.getElementById('includeThreadReplies').checked = config.includeThreadReplies;
        document.getElementById('historyDays').value = config.historyDays;

        // Populate channel JSON editor
        const channels = config.channels || [];
        channelsJsonEl.value = JSON.stringify(channels, null, 2);
        
    } catch (error) {
        console.error('Failed to load settings:', error);
        showStatus('Failed to load settings', 'error');
    }
});

/**
 * Handle form submission
 */
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    try {
        const formData = new FormData(form);
        
        const config = {
            downloadDirectory: formData.get('downloadDirectory') || 'slack-exports',
            fileNameFormat: formData.get('fileNameFormat') || 'YYYYMMDD-HHmm-{channel}.md',
            includeTimestamps: document.getElementById('includeTimestamps').checked,
            includeThreadReplies: document.getElementById('includeThreadReplies').checked,
            historyDays: parseInt(document.getElementById('historyDays').value) || 7
        };
        
        await saveConfig(config);
        showStatus('Settings saved successfully!', 'success');
        
    } catch (error) {
        console.error('Failed to save settings:', error);
        showStatus('Failed to save settings', 'error');
    }
});

/**
 * Handle reset to defaults
 */
resetBtn.addEventListener('click', async () => {
    try {
        const defaultConfig = window.DEFAULT_CONFIG;
        
        // Update form fields
        document.getElementById('downloadDirectory').value = defaultConfig.downloadDirectory;
        document.getElementById('fileNameFormat').value = defaultConfig.fileNameFormat;
        document.getElementById('includeTimestamps').checked = defaultConfig.includeTimestamps;
        document.getElementById('includeThreadReplies').checked = defaultConfig.includeThreadReplies;
        document.getElementById('historyDays').value = defaultConfig.historyDays;
        
        // Save defaults (only general settings, preserve channels)
        await saveConfig({
            downloadDirectory: defaultConfig.downloadDirectory,
            fileNameFormat: defaultConfig.fileNameFormat,
            includeTimestamps: defaultConfig.includeTimestamps,
            includeThreadReplies: defaultConfig.includeThreadReplies,
            historyDays: defaultConfig.historyDays
        });
        showStatus('Settings reset to defaults', 'success');
        
    } catch (error) {
        console.error('Failed to reset settings:', error);
        showStatus('Failed to reset settings', 'error');
    }
});

// ── Channel management ─────────────────────────────────────────────

/**
 * Save channels from JSON editor
 */
saveChannelsBtn.addEventListener('click', async () => {
    try {
        const parsed = JSON.parse(channelsJsonEl.value);
        if (!Array.isArray(parsed)) {
            throw new Error('Channels must be a JSON array');
        }

        // Validate each channel
        for (const ch of parsed) {
            if (!ch.name || typeof ch.name !== 'string') {
                throw new Error(`Invalid channel: missing or invalid "name" field`);
            }
            if (ch.tier !== undefined && ![1, 2, 3].includes(Number(ch.tier))) {
                throw new Error(`Invalid tier for "${ch.name}": must be 1, 2, or 3`);
            }
            if (ch.type !== undefined && !['channel', 'dm', 'group'].includes(ch.type)) {
                throw new Error(`Invalid type for "${ch.name}": must be channel, dm, or group`);
            }
        }

        await saveConfig({ channels: parsed });
        showChannelStatus(`Saved ${parsed.length} channels`, 'success');

        // Re-format the JSON for consistency
        channelsJsonEl.value = JSON.stringify(parsed, null, 2);
    } catch (error) {
        showChannelStatus(`Error: ${error.message}`, 'error');
    }
});

/**
 * Reset channels to initial defaults
 */
resetChannelsBtn.addEventListener('click', async () => {
    try {
        const initial = window.INITIAL_CHANNELS || [];
        channelsJsonEl.value = JSON.stringify(initial, null, 2);
        await saveConfig({ channels: initial });
        showChannelStatus(`Reset to ${initial.length} default channels`, 'success');
    } catch (error) {
        showChannelStatus(`Error: ${error.message}`, 'error');
    }
});

/**
 * Add a single channel via the form
 */
addChannelBtn.addEventListener('click', async () => {
    const name = document.getElementById('newChannelName').value.trim();
    const channelId = document.getElementById('newChannelId').value.trim();
    const tier = parseInt(document.getElementById('newChannelTier').value);
    const type = document.getElementById('newChannelType').value;

    if (!name) {
        showChannelStatus('Please enter a channel name', 'error');
        return;
    }

    try {
        let channels = [];
        try {
            channels = JSON.parse(channelsJsonEl.value);
        } catch (e) {
            channels = [];
        }

        const newChannel = {
            name,
            channelId: channelId || '',
            tier,
            type,
            enabled: true
        };

        channels.push(newChannel);
        channelsJsonEl.value = JSON.stringify(channels, null, 2);
        await saveConfig({ channels });

        // Clear form
        document.getElementById('newChannelName').value = '';
        document.getElementById('newChannelId').value = '';

        showChannelStatus(`Added "${name}"`, 'success');
    } catch (error) {
        showChannelStatus(`Error: ${error.message}`, 'error');
    }
});

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Show status message for general settings
 */
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 3000);
}

/**
 * Show status message for channel management
 */
function showChannelStatus(message, type) {
    channelStatusDiv.textContent = message;
    channelStatusDiv.className = `status ${type}`;
    channelStatusDiv.style.display = 'block';
    
    setTimeout(() => {
        channelStatusDiv.style.display = 'none';
    }, 3000);
} 