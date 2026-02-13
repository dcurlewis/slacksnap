/**
 * SlackSnap Batch Export Popup
 * Orchestrates multi-channel export via the content script running on the Slack page.
 */

// ── State ──────────────────────────────────────────────────────────

let channels = [];
let config = {};
let lastExportTimestamps = {};
let activeTab = null;
let isExporting = false;

// ── DOM references ─────────────────────────────────────────────────

const channelListEl = document.getElementById('channelList');
const noChannelsEl = document.getElementById('noChannels');
const notOnSlackEl = document.getElementById('notOnSlack');
const exportBtn = document.getElementById('exportBtn');
const combinedExportCb = document.getElementById('combinedExport');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const summarySection = document.getElementById('summarySection');
const exportControls = document.getElementById('exportControls');
const settingsBtn = document.getElementById('settingsBtn');
const quickAddBtn = document.getElementById('quickAddBtn');
const quickAddSection = document.getElementById('quickAddSection');
const openOptionsLink = document.getElementById('openOptionsLink');

// ── Initialisation ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    // Check if we're on a Slack page
    if (!tab.url || !tab.url.includes('slack.com')) {
      notOnSlackEl.style.display = 'block';
      channelListEl.style.display = 'none';
      exportControls.style.display = 'none';
      quickAddSection.style.display = 'none';
      return;
    }

    // Load config
    config = await getConfig();
    lastExportTimestamps = config.lastExportTimestamps || {};
    channels = config.channels || [];

    // If no channels configured, seed from local config file or example defaults
    if (channels.length === 0) {
      channels = await loadLocalChannels() || INITIAL_CHANNELS;
      await saveConfig({ channels });
    }

    // Load combined export preference
    combinedExportCb.checked = config.combinedExport || false;

    renderChannels();
    updateExportButton();
  } catch (error) {
    console.error('Popup init error:', error);
  }
});

// ── Event listeners ────────────────────────────────────────────────

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

openOptionsLink && openOptionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

exportBtn.addEventListener('click', () => {
  if (!isExporting) exportSelected();
});

combinedExportCb.addEventListener('change', async () => {
  await saveConfig({ combinedExport: combinedExportCb.checked });
});

quickAddBtn.addEventListener('click', quickAddCurrentChannel);

// ── Render ─────────────────────────────────────────────────────────

function renderChannels() {
  channelListEl.innerHTML = '';

  const enabledChannels = channels.filter(c => c.enabled);
  if (enabledChannels.length === 0 && channels.length === 0) {
    noChannelsEl.style.display = 'block';
    channelListEl.style.display = 'none';
    exportControls.style.display = 'none';
    return;
  }

  noChannelsEl.style.display = 'none';
  channelListEl.style.display = 'block';
  exportControls.style.display = 'block';

  // Group by tier
  const tiers = {};
  for (const ch of channels) {
    const tier = ch.tier || 1;
    if (!tiers[tier]) tiers[tier] = [];
    tiers[tier].push(ch);
  }

  const sortedTiers = Object.keys(tiers).sort((a, b) => Number(a) - Number(b));

  for (const tier of sortedTiers) {
    const tierChannels = tiers[tier];
    const group = document.createElement('div');
    group.className = 'tier-group';

    // Tier header with select-all checkbox
    const header = document.createElement('div');
    header.className = 'tier-header';

    const tierCb = document.createElement('input');
    tierCb.type = 'checkbox';
    tierCb.id = `tier-${tier}`;
    tierCb.dataset.tier = tier;

    const tierLabel = document.createElement('label');
    tierLabel.htmlFor = `tier-${tier}`;
    tierLabel.textContent = `Tier ${tier} (${tierChannels.length})`;

    header.appendChild(tierCb);
    header.appendChild(tierLabel);
    group.appendChild(header);

    // Channel items
    for (const ch of tierChannels) {
      const item = document.createElement('div');
      item.className = 'channel-item';
      item.dataset.channelId = ch.channelId;
      if (!ch.enabled) item.classList.add('disabled');
      if (!ch.channelId) item.classList.add('no-id');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'channel-cb';
      cb.dataset.channelId = ch.channelId;
      cb.dataset.tier = ch.tier;
      cb.disabled = !ch.enabled || !ch.channelId;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'channel-name';
      const typeIcon = ch.type === 'dm' ? '💬 ' : ch.type === 'group' ? '👥 ' : '# ';
      nameSpan.innerHTML = `<span class="type-icon">${typeIcon}</span>${escapeHtml(ch.name)}`;

      const metaSpan = document.createElement('span');
      metaSpan.className = 'channel-meta';
      if (!ch.channelId) {
        metaSpan.textContent = 'no ID';
        metaSpan.style.color = '#e01e5a';
      } else {
        metaSpan.textContent = formatLastExported(ch.channelId);
      }

      const statusSpan = document.createElement('span');
      statusSpan.className = 'channel-status';
      statusSpan.id = `status-${ch.channelId}`;

      item.appendChild(cb);
      item.appendChild(nameSpan);
      item.appendChild(metaSpan);
      item.appendChild(statusSpan);
      group.appendChild(item);

      cb.addEventListener('change', () => {
        updateTierCheckbox(ch.tier);
        updateExportButton();
      });
    }

    // Tier checkbox behaviour
    tierCb.addEventListener('change', () => {
      const cbs = group.querySelectorAll('.channel-cb:not(:disabled)');
      cbs.forEach(cb => { cb.checked = tierCb.checked; });
      updateExportButton();
    });

    channelListEl.appendChild(group);
  }
}

// ── Selection helpers ──────────────────────────────────────────────

function getSelectedChannels() {
  const selected = [];
  const cbs = channelListEl.querySelectorAll('.channel-cb:checked');
  cbs.forEach(cb => {
    const ch = channels.find(c => c.channelId === cb.dataset.channelId);
    if (ch) selected.push(ch);
  });
  return selected;
}

function updateExportButton() {
  const count = getSelectedChannels().length;
  exportBtn.textContent = `Export Selected (${count} channel${count !== 1 ? 's' : ''})`;
  exportBtn.disabled = count === 0 || isExporting;
}

function updateTierCheckbox(tier) {
  const tierCb = document.getElementById(`tier-${tier}`);
  if (!tierCb) return;
  const tierCbs = channelListEl.querySelectorAll(`.channel-cb[data-tier="${tier}"]:not(:disabled)`);
  const checkedCbs = channelListEl.querySelectorAll(`.channel-cb[data-tier="${tier}"]:not(:disabled):checked`);
  tierCb.checked = tierCbs.length > 0 && checkedCbs.length === tierCbs.length;
  tierCb.indeterminate = checkedCbs.length > 0 && checkedCbs.length < tierCbs.length;
}

// ── Batch export orchestration ─────────────────────────────────────

async function exportSelected() {
  const selected = getSelectedChannels();
  if (selected.length === 0) return;

  isExporting = true;
  exportBtn.disabled = true;
  progressSection.style.display = 'block';
  summarySection.style.display = 'none';
  exportControls.style.display = 'none';

  // Disable all checkboxes during export
  channelListEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = true; });

  const results = [];
  let combinedMarkdown = '';

  for (let i = 0; i < selected.length; i++) {
    const channel = selected[i];
    updateProgress(i, selected.length, channel.name);
    setChannelStatus(channel.channelId, 'active');

    try {
      // Calculate oldestTimestamp based on historyDays from now
      // Always respect historyDays by going back from current time
      const historyDaysMs = (config.historyDays || 7) * 86400 * 1000;
      const oldestTimestamp = Date.now() - historyDaysMs;

      const response = await chrome.tabs.sendMessage(activeTab.id, {
        action: 'BATCH_EXPORT_CHANNEL',
        channelId: channel.channelId,
        channelName: channel.name,
        oldestTimestamp: oldestTimestamp
      });

      if (response && response.success) {
        // Always download markdown file, regardless of message count
        // Ensure markdown exists - generate fallback if missing
        let markdownToDownload = response.markdown;
        if (!markdownToDownload || !markdownToDownload.trim()) {
          console.warn(`⚠️ No markdown content for ${channel.name}, generating fallback...`);
          const now = new Date();
          const exportTime = now.toLocaleString();
          markdownToDownload = `# SlackSnap Export: ${channel.name}\n*Exported: ${exportTime}*\n\n---\n\n*Note: No messages found or export encountered errors*\n\n`;
        }

        console.log(`💾 Downloading markdown for ${channel.name} (${response.messageCount || 0} messages, ${markdownToDownload.length} chars)`);

        // If content script already saved markdown, avoid duplicate file.
        if (response.markdownSavedByContent) {
          console.log(`✅ Markdown already saved by content script for ${channel.name}`);
        } else {
          // Trigger download via background script - always create file
          // Retry download if it fails
          let downloadSuccess = false;
          let downloadError = null;
          for (let retry = 0; retry < 3; retry++) {
            try {
              const downloadResponse = await chrome.runtime.sendMessage({
                action: 'DOWNLOAD_FILE',
                data: {
                  filename: generateFilename(channel.name),
                  content: markdownToDownload,
                  directory: config.downloadDirectory || 'slack-exports'
                }
              });

              if (downloadResponse && downloadResponse.success) {
                downloadSuccess = true;
                break;
              } else {
                downloadError = downloadResponse?.error || 'Download failed';
                if (retry < 2) {
                  console.warn(`⚠️ Download attempt ${retry + 1} failed, retrying...`);
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            } catch (downloadErr) {
              downloadError = downloadErr.message;
              if (retry < 2) {
                console.warn(`⚠️ Download attempt ${retry + 1} threw error, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }

          if (!downloadSuccess) {
            console.error(`❌ Download failed for ${channel.name} after 3 attempts:`, downloadError);
            setChannelStatus(channel.channelId, 'error');
            results.push({ channel: channel.name, success: false, error: downloadError || 'Download failed' });
            continue;
          }

          console.log(`✅ Successfully downloaded markdown for ${channel.name}`);
        }

        // Accumulate for combined file (only if there are messages)
        if (combinedExportCb.checked && response.messageCount > 0) {
          combinedMarkdown += `\n\n---\n\n## ${channel.name}\n\n` + response.markdown.split('\n').slice(3).join('\n');
        }

        // Update last exported timestamp
        lastExportTimestamps[channel.channelId] = Date.now();
        await saveConfig({ lastExportTimestamps });

        setChannelStatus(channel.channelId, 'success');
        results.push({ channel: channel.name, success: true, count: response.messageCount });
      } else {
        setChannelStatus(channel.channelId, 'error');
        results.push({ channel: channel.name, success: false, error: response?.error || 'Unknown error' });
      }
    } catch (error) {
      setChannelStatus(channel.channelId, 'error');
      results.push({ channel: channel.name, success: false, error: error.message });
    }

    // Rate limit delay between channels (skip after last)
    if (i < selected.length - 1) {
      updateProgress(i + 1, selected.length, 'Waiting (rate limit)...');
      await sleep(2500);
    }
  }

  // Download combined file if enabled
  if (combinedExportCb.checked && combinedMarkdown) {
    const now = new Date();
    const header = `# SlackSnap Combined Export\n*Exported: ${now.toLocaleString()}*\n`;
    try {
      await chrome.runtime.sendMessage({
        action: 'DOWNLOAD_FILE',
        data: {
          filename: generateFilename('combined'),
          content: header + combinedMarkdown,
          directory: config.downloadDirectory || 'slack-exports'
        }
      });
    } catch (e) {
      console.error('Failed to download combined file:', e);
    }
  }

  // Show summary
  updateProgress(selected.length, selected.length, 'Done!');
  showSummary(results);

  isExporting = false;

  // Re-enable checkboxes
  channelListEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    const channelId = cb.dataset.channelId;
    const ch = channels.find(c => c.channelId === channelId);
    if (ch && ch.enabled && ch.channelId) {
      cb.disabled = false;
    }
    // Tier checkboxes
    if (cb.dataset.tier && !cb.dataset.channelId) {
      cb.disabled = false;
    }
  });
  // Also re-enable tier-level checkboxes
  channelListEl.querySelectorAll('.tier-header input[type="checkbox"]').forEach(cb => {
    cb.disabled = false;
  });

  exportControls.style.display = 'block';
  updateExportButton();
}

// ── Progress & status helpers ──────────────────────────────────────

function updateProgress(current, total, label) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressText.textContent = label
    ? `${current}/${total} — ${label}`
    : `${current}/${total} channels exported`;
}

function setChannelStatus(channelId, status) {
  const el = document.getElementById(`status-${channelId}`);
  if (!el) return;
  el.className = `channel-status ${status}`;
  if (status === 'active') {
    el.innerHTML = '<span class="spinner"></span>';
  } else if (status === 'success') {
    el.textContent = '\u2713';
  } else if (status === 'error') {
    el.textContent = '\u2717';
  } else {
    el.textContent = '';
  }
}

function showSummary(results) {
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);
  const totalMessages = successes.reduce((sum, r) => sum + (r.count || 0), 0);

  let html = '';
  if (failures.length === 0) {
    html = `Exported ${successes.length} channel${successes.length !== 1 ? 's' : ''} (${totalMessages} messages)`;
    summarySection.className = 'summary-section';
  } else {
    html = `${successes.length} exported, ${failures.length} failed`;
    if (failures.length > 0) {
      html += '<br>' + failures.map(f => `${f.channel}: ${f.error}`).join('<br>');
    }
    summarySection.className = 'summary-section has-errors';
  }

  summarySection.innerHTML = html;
  summarySection.style.display = 'block';
}

// ── Quick-add current channel ──────────────────────────────────────

async function quickAddCurrentChannel() {
  if (!activeTab) return;
  quickAddBtn.disabled = true;
  quickAddBtn.textContent = 'Detecting...';

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      action: 'GET_CURRENT_CHANNEL'
    });

    if (response && response.channelId) {
      // Check if already exists
      const existing = channels.find(c => c.channelId === response.channelId);
      if (existing) {
        quickAddBtn.textContent = `Already added: ${existing.name}`;
        setTimeout(() => {
          quickAddBtn.textContent = '+ Add current channel';
          quickAddBtn.disabled = false;
        }, 2000);
        return;
      }

      const newChannel = {
        name: response.channelName || response.channelId,
        channelId: response.channelId,
        tier: 1,
        type: 'channel',
        enabled: true
      };

      channels.push(newChannel);
      await saveConfig({ channels });

      quickAddBtn.textContent = `Added: ${newChannel.name}`;
      renderChannels();
      updateExportButton();

      setTimeout(() => {
        quickAddBtn.textContent = '+ Add current channel';
        quickAddBtn.disabled = false;
      }, 2000);
    } else {
      quickAddBtn.textContent = 'Could not detect channel';
      setTimeout(() => {
        quickAddBtn.textContent = '+ Add current channel';
        quickAddBtn.disabled = false;
      }, 2000);
    }
  } catch (error) {
    console.error('Quick-add failed:', error);
    quickAddBtn.textContent = 'Error - try again';
    setTimeout(() => {
      quickAddBtn.textContent = '+ Add current channel';
      quickAddBtn.disabled = false;
    }, 2000);
  }
}

// ── Utility functions ──────────────────────────────────────────────

function formatLastExported(channelId) {
  const ts = lastExportTimestamps[channelId];
  if (!ts) return 'never';

  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function generateFilename(channelName) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}-${hh}${min}`;
  const cleanChannel = channelName.replace(/[^a-zA-Z0-9\-_]/g, '-').replace(/-+/g, '-').toLowerCase();

  const fmt = (config.fileNameFormat || 'YYYYMMDD-HHmm-{channel}.md');
  return fmt.replace('YYYYMMDD-HHmm', dateStr).replace('{channel}', cleanChannel);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Try to load personal channel config from channels.local.json.
 * Returns the parsed array if the file exists, or null to fall back to INITIAL_CHANNELS.
 */
async function loadLocalChannels() {
  try {
    const url = chrome.runtime.getURL('channels.local.json');
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      console.log(`Loaded ${data.length} channels from channels.local.json`);
      return data;
    }
    return null;
  } catch (e) {
    // File doesn't exist or isn't valid JSON — expected for most users
    return null;
  }
}
