/**
 * Options page script for SlackSnap extension
 */

// DOM elements
const form = document.getElementById('optionsForm');
const statusDiv = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');

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
        
        // Save defaults
        await saveConfig(defaultConfig);
        showStatus('Settings reset to defaults', 'success');
        
    } catch (error) {
        console.error('Failed to reset settings:', error);
        showStatus('Failed to reset settings', 'error');
    }
});

/**
 * Show status message
 * @param {string} message - Status message
 * @param {string} type - Message type ('success' or 'error')
 */
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    // Hide after 3 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 3000);
} 