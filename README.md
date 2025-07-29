# SlackSnap

A Chrome extension that exports Slack messages to markdown files. Does what it says on the tin, really.

I built this because I got tired of copy-pasting Slack conversations when I wanted to analyse them with Claude or other tools. If you're going to export chat data, you might as well do it properly.

## What it actually does

SlackSnap connects to Slack's API to grab messages from whatever channel you're viewing. It's quite clever about this, really:

1. **Smart user fetching** - Only grabs the users mentioned in your messages (not all 10,000+ people in your enterprise workspace)
2. **Proper text cleaning** - Properly formats any escaped characters
3. **Rate limit handling** - Plays nicely with Slack's API limits so you don't get blocked
4. **Configurable date ranges** - Export the last week, month, whatever you need (default 7 days)

The result is a clean markdown file with properly formatted conversations, including threaded replies if you want them.

## Installation

You'll need to load this as an unpacked extension since it's not in the Chrome Web Store.

1. **Get the code**

   ```bash
   git clone <repository-url>
   ```

2. **Load it into Chrome**
   - Open `chrome://extensions/`
   - Turn on 'Developer mode' (top-right toggle)
   - Click 'Load unpacked' and select the slacksnap folder
   - You should see the SlackSnap icon appear in your toolbar

The extension needs permissions for Slack domains, local storage (for your settings), and downloads (obviously). Nothing controversial there.

## How to use it

1. Open Slack in your browser
2. Navigate to the channel you want to export
3. Click the SlackSnap icon
4. Wait a few seconds (usually 5-15 depending on message volume)
5. Find your markdown file in `Downloads/slack-exports/` by default

That's it. No complicated setup, no account creation, no sending your data to random servers. Now you can drag that file into ChatGPT/Claude/etc for analysis or summarization, and go from there...

## Configuration options

Right-click the extension icon and select 'Options' to tweak things:

- **Download directory** - Where files get saved (defaults to `slack-exports`)
- **Filename format** - Template for file names (I quite like `YYYYMMDD-HHmm-{channel}.md`)
- **History window** - How many days back to export (default is 7 days, which covers most use cases)
- **Timestamps and threads** - Whether to include these (both enabled by default)

The filename template uses standard placeholders: `YYYY` for year, `MM` for month, `DD` for day, `HH` and `mm` for time, and `{channel}` for the channel name. Creates files like `20250729-1841-general.md`.

## What the output looks like

```markdown
# SlackSnap Export: general
*Exported: 29/7/2025, 18:41:33*

---

**John Doe** (Today 10:15 AM):
Quick update on the R&D documentation...

**Jane Smith** (Today 10:17 AM):
Cheers for putting this together. I'll review the stakeholder mapping.

**Thread Replies:**
  • **Mike Johnson**: Approval process looks sound to me.
  • **Sarah Wilson**: Agreed, let's get this finalised by EOD.
```

Clean, readable, and ready to paste into whatever analysis tool you're using.

## How it works under the hood

1. Analyses the messages first to find which users are actually mentioned
2. Only fetches those specific users
3. Handles rate limits gracefully with exponential backoff
4. Falls back to DOM scraping if the API approach fails

## When things go wrong

### Export fails completely

- Check you're actually on a Slack page (`*.slack.com`)
- Try refreshing the page first
- Open Chrome DevTools console for detailed error messages
- Use `window.slackSnapDebug.testAuth()` in the console to check authentication

### No messages found

- Make sure you're in the specific channel you want to export
- Check if there are messages in your configured date range (default is last 7 days)
- Try increasing the history window in settings

### Permission errors

- Reinstall (or at least refresh) the extension to refresh permissions
- Check Chrome's download settings allow files from Slack domains

Most issues come down to being on the wrong page or having restrictive corporate browser settings.

## Browser support

Works on Chrome and Edge (both use Chromium). Firefox and Safari use different extension APIs, so no luck there I'm afraid.

## Privacy and that sort of thing

Everything happens locally in your browser. No data gets sent anywhere except to Slack's own APIs (which you're already authenticated with). No analytics, no tracking, no phone-home behaviour.

The extension uses your existing Slack session, so there's no separate authentication step. Settings are stored in Chrome's sync storage, which means they'll follow you across devices if you're signed into Chrome.

## Limitations worth knowing about

- **Date range only** - Exports a configurable window (default 7 days), not your entire Slack history
- **Text content** - Images and files aren't included (though links to them are preserved)
- **No reactions** - Those emoji reactions don't make it into the export
- **Modern Slack only** - Requires the current web interface

The way I see it, these limitations cover 90% of use cases. If you need full historical exports, you probably want Slack's official export tools anyway.

## Development setup

No build process required, it's vanilla JavaScript. Clone the repo, load it as an unpacked extension, and you're sorted.

```text
slacksnap/
├── manifest.json              # Extension configuration
├── src/
│   ├── background.js         # Handles downloads
│   ├── content.js            # Main export logic
│   ├── config.js             # Settings management  
│   └── utils.js              # Text processing utilities
├── options.html              # Settings interface
├── options.js                # Settings logic
└── icons/                    # Extension icons
```

For debugging, these functions are available in the console on Slack pages:

```javascript
window.slackSnapDebug.testAuth()      // Check authentication
window.slackSnapDebug.testAPI()       // Test message extraction  
window.slackSnapDebug.testAPIExport() // Full export test
```

## Contributing

If you spot issues or want to add features, pull requests are welcome. Test thoroughly across different Slack workspaces though; enterprise setups can be quite different from smaller teams.

The most useful contributions would probably be:

1. Better emoji handling
2. Support for more file types in the output
3. Better handling of attachments

## Licence

MIT Licence. Use it however you like.

**Note**: This is an independent tool, not affiliated with Slack Technologies.
