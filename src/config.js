/**
 * Default configuration for SlackSnap extension
 */
const DEFAULT_CONFIG = {
  downloadDirectory: "slack-exports",
  fileNameFormat: "YYYYMMDD-HHmm-{channel}.md",
  includeTimestamps: true,
  includeThreadReplies: true,
  historyDays: 7
};

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
} 