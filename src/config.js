/**
 * Default configuration for SlackSnap extension
 */
const DEFAULT_CONFIG = {
  downloadDirectory: "slack-exports",
  fileNameFormat: "YYYYMMDD-HHmm-{channel}.md",
  includeTimestamps: true,
  includeThreadReplies: true,
  historyDays: 7,

  // Batch export configuration
  channels: [],              // Array of channel config objects
  lastExportTimestamps: {},  // { channelId: unixTimestamp }
  combinedExport: false      // Whether to also produce a combined file
};

/**
 * Example channel list for batch export.
 *
 * To use your own channels, create a `channels.local.json` file in the project
 * root with your real channel data (same format as below). That file is
 * gitignored so it won't be committed. Alternatively, configure channels via
 * the Settings page after installing the extension.
 *
 * Channel IDs can be found in the Slack URL when viewing a channel
 * (e.g. the "C0123456789" segment), or by using the Quick-add button in the popup.
 */
const INITIAL_CHANNELS = [
  // Tier 1 — High priority
  { name: "team-general", channelId: "", tier: 1, type: "channel", enabled: true },
  { name: "team-leads", channelId: "", tier: 1, type: "channel", enabled: true },
  { name: "DM: Alice", channelId: "", tier: 1, type: "dm", enabled: true },
  { name: "DM: Bob", channelId: "", tier: 1, type: "dm", enabled: true },

  // Tier 2 — Medium priority
  { name: "project-alpha", channelId: "", tier: 2, type: "channel", enabled: true },
  { name: "DM: Charlie", channelId: "", tier: 2, type: "dm", enabled: true },

  // Tier 3 — Low priority
  { name: "announcements", channelId: "", tier: 3, type: "channel", enabled: true },
];

/**
 * Get configuration from Chrome storage, fallback to defaults
 * @returns {Promise<Object>} Configuration object
 */
async function getConfig() {
  try {
    const result = await chrome.storage.sync.get(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG, ...result };
  } catch (error) {
    console.error('Failed to load config:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Save configuration to Chrome storage
 * @param {Object} config - Configuration object to save
 * @returns {Promise<void>}
 */
async function saveConfig(config) {
  try {
    await chrome.storage.sync.set(config);
  } catch (error) {
    console.error('Failed to save config:', error);
    throw error;
  }
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.getConfig = getConfig;
  window.saveConfig = saveConfig;
  window.DEFAULT_CONFIG = DEFAULT_CONFIG;
  window.INITIAL_CHANNELS = INITIAL_CHANNELS;
} 