async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(minSec, maxSec) {
    const ms = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
    return sleep(ms);
}

// SAFE text reader — uses .textContent (instant, no layout reflow) instead of .innerText
// .innerText triggers synchronous layout computation which FREEZES the tab on large DOMs
function safeText(el) {
    if (!el) return "";
    return (el.textContent || "").trim();
}

// Find a button/element by its text WITHOUT using .innerText on every element
// Uses .textContent which is instant and non-blocking
function findByText(selector, text, exact = true) {
    const els = document.querySelectorAll(selector);
    const lowerText = text.toLowerCase();
    for (const el of els) {
        const t = (el.textContent || "").trim().toLowerCase();
        if (exact ? t === lowerText : t.includes(lowerText)) {
            return el;
        }
    }
    return null;
}

// Scrapes the story viewers
async function scrapeViewers() {
    console.log("[BOT] Attempting to open active story...");
    try {
        const storyRing = document.querySelector("header canvas");
        if (!storyRing) return { error: "No active story found on this profile." };
        storyRing.click();

        await humanDelay(2, 4);

        // Find "Seen by" OR "Viewers" using textContent (safe, no reflow)
        const seenBySpan = findByText("span", "seen by", false) || findByText("span", "viewers", false);
        if (!seenBySpan) return { error: "'Seen by / Viewers' button not found." };

        console.log("[BOT] Found viewer button text:", safeText(seenBySpan));

        // Click closest button
        const seenBtn = seenBySpan.closest('button') || seenBySpan.closest('div[role="button"]');
        if (seenBtn) seenBtn.click();
        else seenBySpan.click();

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
            const links = container.querySelectorAll("a");
            for (const link of links) {
                const href = link.getAttribute('href');
                if (href && href.startsWith('/') && !href.includes('/p/') && !href.includes('/reel/')) {
                    const un = href.replace(/^\//, '').replace(/\/$/, '');
                    if (un && !un.includes('/') && !un.includes('?') && un !== 'direct' && un !== 'explore') {
                        viewers.add(un);
                    }
                }
            }

            // Strategy 2: If no links found, look for profile pictures with alt text
            if (viewers.size === 0) {
                const imgs = container.querySelectorAll('img[alt]');
                for (const img of imgs) {
                    const alt = img.getAttribute('alt') || "";
                    if (alt.includes("profile picture")) {
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

                const allItems = dialog.querySelectorAll("a, li, div[role='listitem']");
                if (allItems.length > 0) {
                    allItems[allItems.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
                } else {
                    scrollable.scrollTop = scrollable.scrollHeight;
                }

                await sleep(1500);
            } else {
                attempts++;
                scrollable.scrollTop = scrollable.scrollHeight;
                await sleep(500);
            }
            if (attempts > 5) break;
        }

        const finalViewers = collectUsernames(dialog);
        console.log(`[BOT] Collected ${finalViewers.size} viewers total.`);

        return { success: true, viewers: Array.from(finalViewers) };
    } catch (e) {
        console.error("[BOT] scrapeViewers error:", e);
        return { error: e.toString() };
    }
}

// Types the message and triggers React/Lexical events
async function typeMessage(element, text) {
    if (!text || text.trim() === "") text = "Hey!";

    element.focus();
    await sleep(500);

    let target = element.querySelector('p') || element;
    target.focus();

    document.execCommand('insertText', false, text);

    target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function sendMessage(username, messageData, restrictedLocsStr) {
    console.log(`[BOT] === Starting DM flow for ${username} ===`);

    await humanDelay(3, 5);

    // Dismiss "Not Now" popup — using textContent (safe)
    try {
        const notNow = findByText('button', 'Not Now');
        if (notNow) { notNow.click(); console.log("[BOT] Dismissed 'Not Now' popup."); }
    } catch(e) {}

    // Find pencil icon for New Message
    console.log("[BOT] Looking for pencil icon...");
    const pencil = document.querySelector('svg[aria-label="New message"], svg[aria-label="New Message"]');
    if (!pencil) return { error: "Pencil icon not found." };

    const pencilBtnDiv = pencil.closest('div[role="button"]');
    if (pencilBtnDiv) pencilBtnDiv.click();
    else if (pencil.parentNode) pencil.parentNode.click();
    console.log("[BOT] Pencil clicked.");

    await humanDelay(2, 3);

    // Search their exact username
    console.log("[BOT] Looking for search input...");
    const searchInput = document.querySelector('input[placeholder="Search..."], input[name="queryBox"]');
    if (!searchInput) return { error: "Search input not found." };

    searchInput.focus();
    document.execCommand('insertText', false, username);
    console.log(`[BOT] Typed username: ${username}`);

    await humanDelay(3, 5);

    // Find matching user in search results and click — using textContent (safe)
    console.log("[BOT] Looking for user in search results...");
    const userResult = findByText('span', username);
    if (!userResult) return { error: `User "${username}" not found in search results.` };

    userResult.click();
    console.log("[BOT] Clicked on user result.");
    await humanDelay(1, 2);

    // Initiate Chat — look for Chat or Next button using textContent (safe)
    console.log("[BOT] Looking for Chat/Next button...");
    const chatBtn = findByText('div[role="button"]', 'Chat') || findByText('div[role="button"]', 'Next');
    if (chatBtn) {
        chatBtn.click();
        console.log("[BOT] Chat/Next button clicked.");
    } else {
        console.log("[BOT] No Chat/Next button found — conversation may have opened directly.");
    }

    await humanDelay(4, 6);

    // === LOCATION SCANNER ===
    // CRITICAL: We ONLY use .textContent (never .innerText) to avoid freezing the tab.
    // We ONLY read small specific elements, never any container that might hold chat messages.
    console.log("[BOT] Scanning for restricted locations...");

    const locs = (restrictedLocsStr || "").split(",").map(s => s.trim().toLowerCase()).filter(s => s);

    if (locs.length > 0) {
        let profileText = "";

        // Strategy: Find the profile card at the top of DM thread.
        // It typically contains the person's name/bio and a "View profile" link.
        // We ONLY read the card's direct text — never traverse into the chat messages.

        // Find "View profile" link — the profile card is always near it
        const viewProfileLink = findByText('a', 'View profile') || findByText('div[role="button"]', 'View profile');

        if (viewProfileLink) {
            // Walk up max 3 levels to find the card container, but cap text length
            let card = viewProfileLink;
            for (let i = 0; i < 3; i++) {
                if (card.parentElement) card = card.parentElement;
            }
            // Read textContent of small child elements only (not the whole card subtree)
            const children = card.querySelectorAll(':scope > *');
            for (const child of children) {
                const text = (child.textContent || "").trim();
                // Only read small text blocks — anything over 500 chars is likely chat content
                if (text.length > 0 && text.length < 500) {
                    profileText += " " + text.toLowerCase();
                }
            }
        }

        console.log(`[BOT] Profile text scanned: ${profileText.length} chars`);

        for (const loc of locs) {
            if (profileText.includes(loc)) {
                console.log(`[!] Skipped ${username}: Location match "${loc}"`);
                return { skipped: true, reason: `Mentioned Location: ${loc}` };
            }
        }
        console.log("[BOT] No restricted locations found. Proceeding.");
    }

    // === TYPE THE MESSAGE ===
    console.log("[BOT] Looking for message textbox...");
    const textboxes = document.querySelectorAll('div[contenteditable="true"], textarea, div[role="textbox"]');
    if (textboxes.length === 0) return { error: "Textbox not found on screen." };

    // Pick the visible textbox (DM input is usually the last visible one)
    let textbox = null;
    for (const tb of textboxes) {
        if (tb.offsetParent !== null) textbox = tb;
    }
    if (!textbox) textbox = textboxes[textboxes.length - 1];

    console.log("[BOT] Typing message...");
    await typeMessage(textbox, messageData);
    await humanDelay(2, 3);

    // === CLICK SEND ===
    // Find Send button using textContent (safe, no reflow)
    console.log("[BOT] Looking for Send button...");
    const sendBtn = findByText('div[role="button"]', 'Send');

    if (sendBtn) {
        sendBtn.click();
        console.log(`[BOT] Send button clicked for ${username}!`);
    } else {
        // Fallback: press Enter
        textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        console.log(`[BOT] Enter key dispatched for ${username}!`);
    }

    console.log(`[BOT] === DM flow complete for ${username} ===`);
    return { success: true };
}

// Wraps any async function with a timeout so the extension never gets permanently stuck
function withTimeout(asyncFn, timeoutMs, timeoutMsg) {
    return Promise.race([
        asyncFn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs))
    ]);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCRAPE_VIEWERS") {
        withTimeout(() => scrapeViewers(), 120000, "scrapeViewers timed out after 2 minutes")
            .then(sendResponse)
            .catch(err => sendResponse({ error: err.toString() }));
        return true;
    }

    if (request.action === "SEND_MESSAGE") {
        withTimeout(
            () => sendMessage(request.username, request.messageTemplate, request.restrictedLocs),
            90000,
            `sendMessage timed out for ${request.username}`
        )
            .then(sendResponse)
            .catch(err => sendResponse({ error: err.toString() }));
        return true;
    }
});
