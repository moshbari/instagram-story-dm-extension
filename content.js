async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(minSec, maxSec) {
    const ms = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
    return sleep(ms);
}

// Scrapes the story viewers
async function scrapeViewers() {
    console.log("[BOT] Attempting to open active story...");
    try {
        const storyRing = document.querySelector("header canvas");
        if (!storyRing) return { error: "No active story found on this profile." };
        storyRing.click();

        await humanDelay(2, 4);

        // Find "Seen by" OR "Viewers" (Instagram changed the text)
        const seenBySpan = Array.from(document.querySelectorAll("span")).find(el =>
            el.innerText && el.innerText.match(/Seen by|Viewers|viewers/i)
        );
        if (!seenBySpan) return { error: "'Seen by / Viewers' button not found." };

        console.log("[BOT] Found viewer button text:", seenBySpan.innerText);

        // Click closest button
        const seenBtn = seenBySpan.closest('button') || seenBySpan.closest('div[role="button"]');
        if (seenBtn) seenBtn.click();
        else seenBySpan.click(); // Fallback: click the span itself

        await humanDelay(2, 3);

        // Try multiple selectors for the dialog
        const dialog = document.querySelector('div[role="dialog"]')
            || document.querySelector('div[style*="position: fixed"]')
            || document.querySelector('div[class*="dialog"]');
        if (!dialog) return { error: "Viewers dialog didn't open." };

        console.log("[BOT] Dialog found. Collecting viewers...");

        // Find the scrollable container inside the dialog
        const scrollable = dialog.querySelector('div[style*="overflow"]')
            || dialog.querySelector('ul')?.parentElement
            || dialog;

        // Collect usernames using multiple strategies
        function collectUsernames(container) {
            const viewers = new Set();

            // Strategy 1: Links with href pointing to profiles
            const links = Array.from(container.querySelectorAll("a"));
            for (const link of links) {
                const href = link.getAttribute('href');
                if (href && href.startsWith('/') && !href.includes('/p/') && !href.includes('/reel/')) {
                    const un = href.replace(/^\//, '').replace(/\/$/, '');
                    if (un && !un.includes('/') && !un.includes('?') && un !== 'direct' && un !== 'explore') {
                        viewers.add(un);
                    }
                }
            }

            // Strategy 2: If no links found, look for username-style spans near avatar images
            if (viewers.size === 0) {
                const imgs = container.querySelectorAll('img[alt]');
                for (const img of imgs) {
                    const alt = img.getAttribute('alt');
                    // Instagram profile pics have alt text like "username's profile picture"
                    if (alt && alt.includes("profile picture")) {
                        const un = alt.split("'")[0].trim();
                        if (un && un.length > 0 && !un.includes(' ')) {
                            viewers.add(un);
                        }
                    }
                }
            }

            return viewers;
        }

        // Scroll loop to load all viewers
        let lastCount = 0;
        let attempts = 0;

        while (attempts < 35) {
            const currentViewers = collectUsernames(dialog);
            const currentCount = currentViewers.size;

            if (currentCount > lastCount) {
                lastCount = currentCount;
                attempts = 0;

                // Scroll the last element into view within the dialog
                const allItems = dialog.querySelectorAll("a, li, div[role='listitem']");
                if (allItems.length > 0) {
                    allItems[allItems.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
                } else {
                    // Fallback: scroll the scrollable container
                    scrollable.scrollTop = scrollable.scrollHeight;
                }

                await sleep(1500);
            } else {
                attempts++;
                // Try scrolling even if count didn't change
                scrollable.scrollTop = scrollable.scrollHeight;
                await sleep(500);
            }
            if (attempts > 5) break; // Reached bottom — gave a bit more patience
        }

        const finalViewers = collectUsernames(dialog);
        console.log(`[BOT] Collected ${finalViewers.size} viewers total.`);

        return { success: true, viewers: Array.from(finalViewers) };
    } catch (e) {
        console.error("[BOT] scrapeViewers error:", e);
        return { error: e.toString() };
    }
}

// Types the message instantly and triggers React/Lexical events
async function typeMessage(element, text) {
    if (!text || text.trim() === "") text = "Hey!"; // Fallback just in case
    
    element.focus();
    await sleep(500); // Wait for focus to settle
    
    // Deep focus into the precise paragraph Lexical uses if it's there
    let target = element.querySelector('p') || element;
    target.focus();
    
    // Paste the entire text at once. Native browser insertText correctly fires Lexical updates.
    document.execCommand('insertText', false, text);
    
    // Fire synthetic Input event to confidently enable the Send button
    target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function sendMessage(username, messageData, restrictedLocsStr) {
    console.log(`[BOT] Interacting with DM for ${username}`);
    
    await humanDelay(3, 5);
    
    // Dismiss "Not Now" popup for notifications, catching error safely
    try {
        const notNow = Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'Not Now');
        if (notNow) notNow.click();
    } catch(e) {}
    
    // Find pencil icon for New Message
    const pencil = document.querySelector('svg[aria-label="New message"], svg[aria-label="New Message"]');
    if (!pencil) return { error: "Pencil icon not found." };
    
    const pencilBtnDiv = pencil.closest('div[role="button"]');
    if (pencilBtnDiv) pencilBtnDiv.click();
    else if (pencil.parentNode) pencil.parentNode.click();
    
    await humanDelay(2, 3);
    
    // Search their exact username
    const searchInput = document.querySelector('input[placeholder="Search..."], input[name="queryBox"]');
    if (!searchInput) return { error: "Search input not found." };
    
    searchInput.focus();
    document.execCommand('insertText', false, username);
    
    await humanDelay(3, 5);
    
    // Find matching user and click
    const userResult = Array.from(document.querySelectorAll('span')).find(el => el.innerText === username);
    if (!userResult) return { error: "User not found in search." };
    
    userResult.click();
    await humanDelay(1, 2);
    
    // Initiate Chat
    const chatBtn = Array.from(document.querySelectorAll('div[role="button"]')).find(b => b.innerText === 'Chat');
    if (chatBtn) chatBtn.click();
    
    await humanDelay(4, 6);
    
    // Restricted Location Scanner — scan only the profile header area, NOT the full chat
    console.log("[BOT] Scanning for restricted locations...");

    // Look for the profile header area in the chat (contains name, username, bio snippet)
    // This avoids scanning the entire chat history which can cause scroll/layout issues
    const headerArea = document.querySelector('div[role="main"] header')
        || document.querySelector('div[role="banner"]')
        || null;

    // Also grab the "View profile" button area which often contains location info
    const profileSection = headerArea ? headerArea.parentElement : null;
    const scanTarget = profileSection || document.querySelector('div[role="main"]') || document.body;

    // Only scan a limited portion of text — the top profile area, not the full chat
    const pageText = scanTarget.innerText.substring(0, 2000).toLowerCase();
    const locs = restrictedLocsStr.split(",").map(s => s.trim().toLowerCase()).filter(s => s);

    for (const loc of locs) {
        if (pageText.includes(loc)) {
            console.log(`[!] Skipped: Contains ${loc}`);
            return { skipped: true, reason: `Mentioned Location: ${loc}` };
        }
    }

    // Note: No permanent chat history check — users can be messaged again on different days.
    // Duplicate prevention is handled daily in background.js (messaged_today list resets each day).
    
    // Typing the actual DM
    const textboxes = Array.from(document.querySelectorAll('div[contenteditable="true"], textarea, div[role="textbox"]'));
    if (textboxes.length === 0) return { error: "Textbox not found on screen." };
    
    // Filter visible textboxes and pick the last one (DM input usually at bottom)
    const visibleTextboxes = textboxes.filter(tb => tb.offsetParent !== null);
    const textbox = visibleTextboxes[visibleTextboxes.length - 1] || textboxes[textboxes.length - 1];
    
    console.log(`[BOT] Typing message...`);
    await typeMessage(textbox, messageData);
    await humanDelay(2, 3);
    
    // Find the Send button - Instagram's text can sometimes be inside nested spans so exact match is safer
    console.log("[BOT] Searching for Send button...");
    const sendBtn = Array.from(document.querySelectorAll('div[role="button"]')).find(b => b.innerText && b.innerText.trim() === 'Send');
    
    if (sendBtn) {
        sendBtn.click();
        console.log(`[BOT] Send button clicked for ${username}!`);
    } else {
        // Fallback: simulate pressing Enter just in case the button didn't spawn natively
        textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        console.log(`[BOT] Enter key dispatched for ${username}!`);
    }
    
    return { success: true };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCRAPE_VIEWERS") {
        scrapeViewers().then(sendResponse);
        return true;
    }
    
    if (request.action === "SEND_MESSAGE") {
        sendMessage(request.username, request.messageTemplate, request.restrictedLocs).then(sendResponse);
        return true;
    }
});
