async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(minSec, maxSec) {
    const ms = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
    return sleep(ms);
}

// SAFE text reader — uses .textContent (no layout reflow, instant)
function safeText(el) {
    if (!el) return "";
    return (el.textContent || "").trim();
}

// Find element by text using .textContent (safe, no reflow)
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
    console.log("[BOT] === SCRAPE VIEWERS START ===");
    try {
        // Step 1: Open the story
        const storyRing = document.querySelector("header canvas");
        if (!storyRing) return { error: "No active story found on this profile." };
        storyRing.click();
        console.log("[BOT] Story ring clicked. Waiting for story to load...");

        await humanDelay(3, 5);

        // Step 2: Find and click "Seen by X" or the eye icon at the bottom of the story
        // Instagram shows either "Seen by X" text or a viewers icon
        let clickedViewers = false;

        // Try 1: Look for "Seen by" text
        const seenBySpan = findByText("span", "seen by", false);
        if (seenBySpan) {
            console.log("[BOT] Found 'Seen by' text. Clicking...");
            const btn = seenBySpan.closest('button') || seenBySpan.closest('div[role="button"]');
            if (btn) btn.click(); else seenBySpan.click();
            clickedViewers = true;
        }

        // Try 2: Look for the eye/viewers icon (SVG with aria-label)
        if (!clickedViewers) {
            const eyeIcon = document.querySelector('svg[aria-label*="viewer" i], svg[aria-label*="Seen" i]');
            if (eyeIcon) {
                console.log("[BOT] Found viewers icon. Clicking...");
                const btn = eyeIcon.closest('button') || eyeIcon.closest('div[role="button"]') || eyeIcon.parentElement;
                if (btn) btn.click();
                clickedViewers = true;
            }
        }

        // Try 3: Look for any span that already says "Viewers" (dialog might already be open)
        if (!clickedViewers) {
            const viewersSpan = findByText("span", "viewers", false);
            if (viewersSpan) {
                console.log("[BOT] Found 'Viewers' text. Clicking...");
                const btn = viewersSpan.closest('button') || viewersSpan.closest('div[role="button"]');
                if (btn) btn.click(); else viewersSpan.click();
                clickedViewers = true;
            }
        }

        if (!clickedViewers) {
            return { error: "'Seen by / Viewers' button not found anywhere." };
        }

        await humanDelay(2, 3);

        // Step 3: Find the VIEWERS dialog — NOT the story overlay
        // There may be multiple div[role="dialog"] on the page.
        // The viewers dialog is the one that contains profile links (/username/) or
        // has "Viewers" as a title. We need the LAST/topmost dialog.
        console.log("[BOT] Looking for viewers dialog...");

        let viewersDialog = null;
        const allDialogs = document.querySelectorAll('div[role="dialog"]');
        console.log(`[BOT] Found ${allDialogs.length} dialog(s) on page.`);

        if (allDialogs.length === 0) {
            return { error: "No dialog found on page." };
        }

        // Strategy: check each dialog (last first) for viewer-like content
        for (let i = allDialogs.length - 1; i >= 0; i--) {
            const d = allDialogs[i];

            // Check if this dialog has "Viewers" title text
            const hasViewersTitle = findByTextInContainer(d, "span", "viewers");

            // Check if this dialog has profile links (hrefs like /username/)
            const profileLinks = d.querySelectorAll('a[href^="/"]');
            let profileLinkCount = 0;
            for (const link of profileLinks) {
                const href = link.getAttribute('href') || "";
                const parts = href.replace(/^\//, '').replace(/\/$/, '');
                if (parts && !parts.includes('/') && !parts.includes('?') && parts !== 'direct' && parts !== 'explore') {
                    profileLinkCount++;
                }
            }

            // Check if this dialog has profile pictures
            const profilePics = d.querySelectorAll('img[alt*="profile picture"]');

            console.log(`[BOT] Dialog ${i}: title=${hasViewersTitle ? 'YES' : 'NO'}, profileLinks=${profileLinkCount}, profilePics=${profilePics.length}`);

            if (hasViewersTitle || profileLinkCount >= 2 || profilePics.length >= 2) {
                viewersDialog = d;
                console.log(`[BOT] Selected dialog ${i} as the viewers dialog.`);
                break;
            }
        }

        // Fallback: just use the last dialog
        if (!viewersDialog) {
            viewersDialog = allDialogs[allDialogs.length - 1];
            console.log("[BOT] No dialog matched viewers criteria. Using last dialog as fallback.");
        }

        // Step 4: Collect usernames with multiple strategies
        function collectUsernames() {
            const viewers = new Set();

            // Strategy 1: Profile links inside the viewers dialog
            const links = viewersDialog.querySelectorAll("a[href]");
            for (const link of links) {
                const href = link.getAttribute('href') || "";
                if (href.startsWith('/') && !href.includes('/p/') && !href.includes('/reel/') && !href.includes('/stories/')) {
                    const un = href.replace(/^\//, '').replace(/\/$/, '');
                    if (un && !un.includes('/') && !un.includes('?') && un !== 'direct' && un !== 'explore' && un !== 'accounts') {
                        viewers.add(un);
                    }
                }
            }

            // Strategy 2: Profile picture alt text
            if (viewers.size === 0) {
                const imgs = viewersDialog.querySelectorAll('img[alt]');
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

            // Strategy 3: Look for username-like text in list items
            if (viewers.size === 0) {
                const items = viewersDialog.querySelectorAll('li, div[role="listitem"], div[role="row"]');
                for (const item of items) {
                    const spans = item.querySelectorAll('span');
                    for (const span of spans) {
                        const text = (span.textContent || "").trim();
                        // Username pattern: lowercase, numbers, underscores, periods, 1-30 chars
                        if (text && /^[a-z0-9._]{1,30}$/.test(text) && !text.includes(' ')) {
                            viewers.add(text);
                        }
                    }
                }
            }

            return viewers;
        }

        // Step 5: Scroll to load all viewers
        console.log("[BOT] Scrolling to load all viewers...");

        // Find the scrollable element inside the viewers dialog
        let scrollTarget = null;
        const scrollables = viewersDialog.querySelectorAll('div');
        for (const div of scrollables) {
            const style = window.getComputedStyle(div);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight) {
                scrollTarget = div;
            }
        }
        if (!scrollTarget) scrollTarget = viewersDialog;

        console.log(`[BOT] Scroll target found: ${scrollTarget === viewersDialog ? 'dialog itself' : 'inner div'}`);

        let lastCount = 0;
        let noChangeRuns = 0;

        for (let round = 0; round < 40; round++) {
            const current = collectUsernames();
            const count = current.size;

            if (count > lastCount) {
                console.log(`[BOT] Scroll round ${round}: ${count} viewers found (new!)`);
                lastCount = count;
                noChangeRuns = 0;
                // Scroll down
                scrollTarget.scrollTop = scrollTarget.scrollHeight;
                await sleep(1500);
            } else {
                noChangeRuns++;
                scrollTarget.scrollTop = scrollTarget.scrollHeight;
                await sleep(500);
                if (noChangeRuns >= 5) {
                    console.log(`[BOT] No new viewers for ${noChangeRuns} rounds. Done scrolling.`);
                    break;
                }
            }
        }

        // Final collection
        const finalViewers = collectUsernames();
        console.log(`[BOT] === SCRAPE COMPLETE: ${finalViewers.size} viewers collected ===`);

        // Close the viewers dialog by pressing Escape or clicking X
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            await sleep(500);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        } catch(e) {}

        return { success: true, viewers: Array.from(finalViewers) };
    } catch (e) {
        console.error("[BOT] scrapeViewers error:", e);
        return { error: e.toString() };
    }
}

// Helper: find element by text within a specific container
function findByTextInContainer(container, selector, text) {
    const els = container.querySelectorAll(selector);
    const lowerText = text.toLowerCase();
    for (const el of els) {
        const t = (el.textContent || "").trim().toLowerCase();
        if (t.includes(lowerText)) return el;
    }
    return null;
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

    // Dismiss "Not Now" popup
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

    // Find matching user in search results and click
    console.log("[BOT] Looking for user in search results...");
    const userResult = findByText('span', username);
    if (!userResult) return { error: `User "${username}" not found in search results.` };

    userResult.click();
    console.log("[BOT] Clicked on user result.");
    await humanDelay(1, 2);

    // Initiate Chat
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
    console.log("[BOT] Scanning for restricted locations...");

    const locs = (restrictedLocsStr || "").split(",").map(s => s.trim().toLowerCase()).filter(s => s);

    if (locs.length > 0) {
        let profileText = "";

        // Find "View profile" link — the profile card is always near it
        const viewProfileLink = findByText('a', 'View profile') || findByText('div[role="button"]', 'View profile');

        if (viewProfileLink) {
            let card = viewProfileLink;
            for (let i = 0; i < 3; i++) {
                if (card.parentElement) card = card.parentElement;
            }
            // Read textContent of small child elements only
            const children = card.querySelectorAll(':scope > *');
            for (const child of children) {
                const text = (child.textContent || "").trim();
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

    let textbox = null;
    for (const tb of textboxes) {
        if (tb.offsetParent !== null) textbox = tb;
    }
    if (!textbox) textbox = textboxes[textboxes.length - 1];

    console.log("[BOT] Typing message...");
    await typeMessage(textbox, messageData);
    await humanDelay(2, 3);

    // === CLICK SEND ===
    console.log("[BOT] Looking for Send button...");
    const sendBtn = findByText('div[role="button"]', 'Send');

    if (sendBtn) {
        sendBtn.click();
        console.log(`[BOT] Send button clicked for ${username}!`);
    } else {
        textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        console.log(`[BOT] Enter key dispatched for ${username}!`);
    }

    console.log(`[BOT] === DM flow complete for ${username} ===`);
    return { success: true };
}

// Timeout wrapper
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
